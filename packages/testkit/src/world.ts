import {
  CascadeConfigResolver,
  DefaultIngestionService,
  DefaultMergePolicy,
  DefaultRemediationEngine,
  DefaultShepherdController,
  type ConfigLayerInput,
  type ControllerOptions,
  type PrSnapshot,
  type RemediationDef,
} from '@shepherd/core';
import type { Destination, NotifierTransport, SlackBlocks } from '@shepherd/delivery';
import {
  FakeClock,
  FakeCodeHost,
  FakeRemediationService,
  InMemoryAuditLog,
  InMemoryIdempotencyStore,
  InMemoryPrRepository,
  InMemoryUnitOfWork,
  RecordingNotifier,
} from './fakes.js';

export class FakeNotifierTransport implements NotifierTransport {
  readonly sends: Array<{ dest: Destination; payload: SlackBlocks }> = [];

  async send(dest: Destination, payload: SlackBlocks): Promise<void> {
    this.sends.push(structuredClone({ dest, payload }));
  }
}

export const TEST_CATALOG: RemediationDef[] = [
  {
    id: 'conflict-rebase',
    description: 'Resolve a merge conflict by rebasing onto base (declines if non-trivial)',
    class: 'conflict',
    match: { signal: 'conflict' },
    response: { kind: 'external', task: 'conflict-rebase' },
    priority: 10, // conflict is tightest-leash: attack it first
    cooldownSeconds: 300,
    maxAttempts: 1,
  },
  {
    id: 'eslint-autofix',
    description: 'Run eslint --fix and push the result',
    class: 'mechanical',
    match: { check: 'lint*', conclusion: ['failure'] },
    response: { kind: 'external', task: 'eslint-autofix' },
    priority: 20,
    cooldownSeconds: 120,
    maxAttempts: 2,
  },
  {
    id: 'retry-flaky',
    description: 'Re-run checks that died of environment, not code',
    class: 'mechanical',
    match: { check: '*', conclusion: ['timed_out', 'cancelled'] },
    response: { kind: 'retry_checks' },
    priority: 30,
    cooldownSeconds: 60,
    maxAttempts: 2,
  },
];

export const TEST_LAYERS: ConfigLayerInput[] = [
  {
    layer: 'default',
    preferences: {
      enabledRemediations: ['conflict-rebase', 'eslint-autofix', 'retry-flaky'],
      endActionDefault: 'merge',
      keepBranchUpToDate: true,
      staleEscalateAfterDays: 30,
    },
  },
];

export interface WorldOptions {
  catalog?: RemediationDef[];
  layers?: ConfigLayerInput[];
  controller?: Partial<ControllerOptions>;
  startAt?: Date;
}

/** Fully wired hermetic shepherd: all fakes, injected clock, manual tick. */
export function buildWorld(opts: WorldOptions = {}) {
  const clock = new FakeClock(opts.startAt);
  const codeHost = new FakeCodeHost();
  const remediationService = new FakeRemediationService();
  const prs = new InMemoryPrRepository();
  const idempotency = new InMemoryIdempotencyStore();
  const audit = new InMemoryAuditLog();
  const uow = new InMemoryUnitOfWork({ prs, idempotency, audit });
  const notifier = new RecordingNotifier();
  const resolver = new CascadeConfigResolver(opts.catalog ?? TEST_CATALOG, opts.layers ?? TEST_LAYERS);
  const engine = new DefaultRemediationEngine(codeHost);
  const mergePolicy = new DefaultMergePolicy();
  const ingestion = new DefaultIngestionService(prs, audit, clock);
  const controller = new DefaultShepherdController(
    { codeHost, remediationService, clock, uow, prs, resolver, engine, mergePolicy, notifier },
    opts.controller,
  );
  return {
    clock, codeHost, remediationService, prs, idempotency, audit, uow,
    notifier, resolver, engine, mergePolicy, ingestion, controller,
  };
}

export type World = ReturnType<typeof buildWorld>;

export function makeSnapshot(patch: Partial<PrSnapshot> & Pick<PrSnapshot, 'id' | 'repo' | 'number'>): PrSnapshot {
  return {
    author: 'octocat',
    isDraft: false,
    labels: [],
    state: 'open',
    mergeable: 'mergeable',
    behindBase: false,
    checks: [],
    baseRef: 'main',
    headRef: 'feature',
    headSha: 'abc123',
    lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    ...patch,
  };
}
