import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  makePrId,
  type AuditLog,
  type CodeHostPort,
  type IngestionService,
  type PrRepository,
} from '@shepherd/core';

/**
 * Published HTTP (§12): we author this contract, so inbound bodies parse
 * strictly. (Third-party webhooks — phase 2 — would parse with passthrough.)
 */
const triggerBodySchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  number: z.number().int().positive(),
  campaignKey: z.string().optional(),
  campaignLabel: z.string().optional(),
  priority: z.number().int().optional(),
  endAction: z.object({ kind: z.enum(['merge', 'notify_ready']) }).optional(),
  overrides: z.record(z.unknown()).optional(),
});

const abandonBodySchema = z.object({ reason: z.string().min(1) });

export interface ServerDeps {
  codeHost: CodeHostPort;
  ingestion: IngestionService;
  prs: PrRepository;
  audit: AuditLog;
  now: () => Date;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', async () => ({ ok: true }));

  /** Trigger enrollment: +end-action +campaign metadata (§5.3). */
  app.post('/triggers/pr', async (req, reply) => {
    const parsed = triggerBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;
    const prId = makePrId('github', body.repo, body.number);
    const snapshot = await deps.codeHost.getPr(prId);
    if (!snapshot) return reply.status(404).send({ error: `PR not found: ${prId}` });
    const record = await deps.ingestion.ingest(snapshot, {
      source: 'api',
      campaignKey: body.campaignKey,
      campaignLabel: body.campaignLabel,
      priority: body.priority,
      endAction: body.endAction,
      overrides: body.overrides,
    });
    return reply.status(202).send({ prId: record.id, state: record.lifecycleState });
  });

  app.get('/prs/:prId/status', async (req, reply) => {
    const { prId } = req.params as { prId: string };
    const record = await deps.prs.get(decodeURIComponent(prId));
    if (!record) return reply.status(404).send({ error: 'not tracked' });
    return {
      prId: record.id,
      state: record.lifecycleState,
      enrollment: record.enrollment,
      remediation: record.remediation,
      escalation: record.escalation,
      nextReconcileAt: record.nextReconcileAt,
    };
  });

  /**
   * Manual hard-terminal (§15): 'abandoned' is the only state a human sets
   * directly — the Slack close-confirmation modal will land here too.
   */
  app.post('/prs/:prId/abandon', async (req, reply) => {
    const parsed = abandonBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { prId } = req.params as { prId: string };
    const record = await deps.prs.get(decodeURIComponent(prId));
    if (!record) return reply.status(404).send({ error: 'not tracked' });
    if (record.terminalAt) return reply.status(409).send({ error: `already terminal: ${record.lifecycleState}` });
    const now = deps.now();
    await deps.prs.upsert({ ...record, lifecycleState: 'abandoned', terminalAt: now });
    await deps.audit.record({
      prId: record.id,
      type: 'terminal',
      payload: { state: 'abandoned', reason: parsed.data.reason, by: 'manual' },
      at: now,
    });
    return { prId: record.id, state: 'abandoned' };
  });

  return app;
}
