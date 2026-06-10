import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  CascadeConfigResolver,
  DefaultIngestionService,
  DefaultMergePolicy,
  DefaultRemediationEngine,
  DefaultReportService,
  DefaultShepherdController,
  EnrollmentScanner,
  type ClockPort,
  type CodeHostPort,
  type RemediationServicePort,
} from '@shepherd/core';
import {
  DefaultDeliveryService,
  InMemoryDeliveryStore,
  ListBotFilter,
  StaticIdentityMap,
  type Destination,
  type NotifierTransport,
  type SlackBlocks,
} from '@shepherd/delivery';
import {
  DrizzleAuditLog,
  DrizzleDeliveryStore,
  DrizzleIdempotencyStore,
  DrizzlePrRepository,
  DrizzleUnitOfWork,
  applyMigrations,
  type Db,
} from '@shepherd/persistence';
import { GitHubCodeHost, createOctokit } from '@shepherd/adapter-github';
import { SlackNotifierTransport } from '@shepherd/adapter-slack';
import { HttpRemediationService, singleServerRouter } from '@shepherd/adapter-remediation';
import {
  FakeCodeHost,
  FakeRemediationService,
  InMemoryAuditLog,
  InMemoryIdempotencyStore,
  InMemoryPrRepository,
  InMemoryUnitOfWork,
} from '@shepherd/testkit';
import { shepherdConfigSchema, type ShepherdConfig } from './config-schema.js';
import { DeliveryShepherdNotifier } from './notifier.js';
import { buildServer } from './server.js';

const log = pino({ name: 'shepherd' });

/** Dev transport when no Slack token is configured. */
class ConsoleTransport implements NotifierTransport {
  async send(dest: Destination, payload: SlackBlocks): Promise<void> {
    log.info({ dest, text: payload.text }, 'notification (console transport)');
  }
}

/** Surfaces missing configuration as an escalation instead of a silent stall. */
class UnconfiguredRemediationService implements RemediationServicePort {
  async trigger(): Promise<{ result: 'declined'; reason: string }> {
    return { result: 'declined', reason: 'no remediation service configured (set REMEDIATION_ENDPOINT/REMEDIATION_TOKEN)' };
  }
}

function loadConfig(): ShepherdConfig {
  const path =
    process.env['SHEPHERD_CONFIG'] ??
    join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'shepherd.json');
  return shepherdConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const fakeMode = process.env['FAKE_ADAPTERS'] === '1';
  const clock: ClockPort = { now: () => new Date() };

  // ── Driven adapters ───────────────────────────────────────────────────────
  let codeHost: CodeHostPort;
  let remediationService: RemediationServicePort;
  if (fakeMode) {
    log.warn('FAKE_ADAPTERS=1 — running hermetically with in-memory fakes');
    codeHost = new FakeCodeHost();
    remediationService = new FakeRemediationService();
  } else {
    const appAuth =
      process.env['GITHUB_APP_ID'] && process.env['GITHUB_APP_PRIVATE_KEY'] && process.env['GITHUB_APP_INSTALLATION_ID']
        ? {
            appId: process.env['GITHUB_APP_ID'],
            privateKey: process.env['GITHUB_APP_PRIVATE_KEY'].replace(/\\n/g, '\n'),
            installationId: Number(process.env['GITHUB_APP_INSTALLATION_ID']),
          }
        : undefined;
    codeHost = new GitHubCodeHost(createOctokit({ token: process.env['GITHUB_TOKEN'], app: appAuth }));
    remediationService =
      process.env['REMEDIATION_ENDPOINT'] && process.env['REMEDIATION_TOKEN']
        ? new HttpRemediationService(
            singleServerRouter({
              endpoint: process.env['REMEDIATION_ENDPOINT'],
              credential: process.env['REMEDIATION_TOKEN'],
            }),
          )
        : new UnconfiguredRemediationService();
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  const databaseUrl = process.env['DATABASE_URL'];
  let prs, idempotency, audit, uow, deliveryStore;
  if (!fakeMode && databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await applyMigrations(pool);
    const db = drizzle(pool) as Db;
    prs = new DrizzlePrRepository(db);
    idempotency = new DrizzleIdempotencyStore(db);
    audit = new DrizzleAuditLog(db);
    uow = new DrizzleUnitOfWork(db);
    deliveryStore = new DrizzleDeliveryStore(db);
  } else {
    if (!fakeMode) log.warn('DATABASE_URL not set — using in-memory persistence (state lost on restart)');
    prs = new InMemoryPrRepository();
    idempotency = new InMemoryIdempotencyStore();
    audit = new InMemoryAuditLog();
    uow = new InMemoryUnitOfWork({ prs, idempotency, audit });
    deliveryStore = new InMemoryDeliveryStore();
  }

  // ── Delivery ──────────────────────────────────────────────────────────────
  const slackToken = process.env['SLACK_BOT_TOKEN'];
  const transport: NotifierTransport =
    !fakeMode && slackToken ? SlackNotifierTransport.fromToken(slackToken) : new ConsoleTransport();
  const delivery = new DefaultDeliveryService(
    { slack: transport },
    deliveryStore,
    clock,
    new ListBotFilter(cfg.botDenyList),
  );
  const identity = new StaticIdentityMap(cfg.identity.map, cfg.identity.fallback);

  // ── Core wiring ───────────────────────────────────────────────────────────
  const resolver = new CascadeConfigResolver(cfg.catalog, cfg.layers);
  const defaults = resolver.resolve('config:defaults');
  const notifier = new DeliveryShepherdNotifier(delivery, identity, cfg.adminDestination, {
    quietSeconds: defaults.notifications.quietSeconds,
    hardCapSeconds: defaults.notifications.hardCapSeconds,
  });
  const engine = new DefaultRemediationEngine(codeHost);
  const mergePolicy = new DefaultMergePolicy();
  const ingestion = new DefaultIngestionService(prs, audit, clock);
  const scanner = new EnrollmentScanner(codeHost, ingestion, cfg.enrollment);
  const controller = new DefaultShepherdController(
    { codeHost, remediationService, clock, uow, prs, resolver, engine, mergePolicy, notifier },
    { claimLimit: cfg.scheduler.claimLimit, random: Math.random },
  );
  const reports = new DefaultReportService(prs, (userId) => identity.resolve(userId));
  void reports; // daily digest cron is wired by the operator (see README)

  // ── HTTP trigger API ──────────────────────────────────────────────────────
  const server = buildServer({ codeHost, ingestion, prs, audit, now: () => clock.now() });
  const port = Number(process.env['PORT'] ?? 3000);
  await server.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'trigger API listening');

  // ── Scheduler: cheap wakes; per-PR cadence lives in next_reconcile_at (§11)
  const timers = [
    setInterval(async () => {
      try {
        const report = await controller.tick(clock.now());
        if (report.claimed > 0) log.info({ report }, 'tick');
      } catch (err) {
        log.error({ err }, 'tick failed');
      }
    }, cfg.scheduler.tickIntervalMs),
    setInterval(async () => {
      try {
        await scanner.scan({ repos: cfg.repos });
      } catch (err) {
        log.error({ err }, 'enrollment scan failed');
      }
    }, cfg.scheduler.scanIntervalMs),
    setInterval(async () => {
      try {
        await delivery.flushDue(clock.now());
      } catch (err) {
        log.error({ err }, 'delivery flush failed');
      }
    }, cfg.scheduler.flushIntervalMs),
  ];

  const shutdown = async () => {
    log.info('shutting down');
    for (const t of timers) clearInterval(t);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err }, 'fatal');
  process.exit(1);
});
