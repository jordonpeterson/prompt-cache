/**
 * The one non-hermetic suite (§13): real PrRepository against Postgres via
 * Testcontainers — catches schema/SQL drift. Run with: npm run test:pg
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrRecord } from '@shepherd/core';

const enabled = process.env['PG_TESTS'] === '1';

describe.runIf(enabled)('persistence against real Postgres', () => {
  let container: import('@testcontainers/postgresql').StartedPostgreSqlContainer;
  let pool: import('pg').Pool;
  let db: import('../src/repositories.js').Db;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { applyMigrations } = await import('../src/migrate.js');
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    db = drizzle(pool) as import('../src/repositories.js').Db;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  function record(id: string, patch: Partial<PrRecord> = {}): PrRecord {
    const now = new Date('2026-01-01T00:00:00Z');
    return {
      id, repo: 'acme/web', number: 1, author: 'octocat', enrollment: 'triggered',
      endAction: { kind: 'merge' }, lifecycleState: 'evaluating',
      remediation: {
        lastDefId: 'eslint-autofix',
        triggeredAt: now,
        cooldownUntil: new Date(now.getTime() + 120_000),
        attemptCount: 1,
      },
      escalation: null, lastInteractionAt: now, ingestedAt: now,
      terminalAt: null, nextReconcileAt: now,
      ...patch,
    };
  }

  it('round-trips a record incl. JSONB fields with dates intact', async () => {
    const { DrizzlePrRepository } = await import('../src/repositories.js');
    const repo = new DrizzlePrRepository(db);
    const original = record('github:acme/web#1');
    await repo.upsert(original);
    const loaded = await repo.get('github:acme/web#1');
    expect(loaded).not.toBeNull();
    expect(loaded!.remediation!.cooldownUntil).toBeInstanceOf(Date);
    expect(loaded!.remediation!.cooldownUntil.toISOString()).toBe(original.remediation!.cooldownUntil.toISOString());
    expect(loaded!.endAction).toEqual({ kind: 'merge' });

    await repo.upsert({ ...original, lifecycleState: 'merged', terminalAt: new Date() });
    expect((await repo.get('github:acme/web#1'))!.lifecycleState).toBe('merged');
  });

  it('claimDueForReconcile claims due rows, applies the lease, and skips terminal', async () => {
    const { DrizzlePrRepository } = await import('../src/repositories.js');
    const repo = new DrizzlePrRepository(db, 60);
    const now = new Date('2026-01-02T00:00:00Z');
    await repo.upsert(record('github:acme/web#10', { nextReconcileAt: new Date(now.getTime() - 1000) }));
    await repo.upsert(record('github:acme/web#11', { nextReconcileAt: new Date(now.getTime() + 60_000) }));
    await repo.upsert(
      record('github:acme/web#12', {
        nextReconcileAt: new Date(now.getTime() - 1000),
        lifecycleState: 'merged',
        terminalAt: now,
      }),
    );

    const claimed = await repo.claimDueForReconcile(10, now);
    expect(claimed.map((r) => r.id)).toEqual(['github:acme/web#10']);
    // The lease means an immediate re-claim sees nothing.
    expect(await repo.claimDueForReconcile(10, now)).toHaveLength(0);
  });

  it('idempotency reservation commits atomically with the record write', async () => {
    const { DrizzleUnitOfWork, DrizzleIdempotencyStore } = await import('../src/repositories.js');
    const uow = new DrizzleUnitOfWork(db);

    await expect(
      uow.run(async (tx) => {
        expect(await tx.idempotency.reserve('atomic-key')).toBe(true);
        await tx.prs.upsert(record('github:acme/web#20', { lifecycleState: 'merging' }));
        throw new Error('boom — roll it all back');
      }),
    ).rejects.toThrow('boom');

    // Both the reservation and the record write rolled back together.
    expect(await new DrizzleIdempotencyStore(db).reserve('atomic-key')).toBe(true);
    const { DrizzlePrRepository } = await import('../src/repositories.js');
    expect(await new DrizzlePrRepository(db).get('github:acme/web#20')).toBeNull();
  });

  it('delivery store round-trips buffers and sent-keys', async () => {
    const { DrizzleDeliveryStore } = await import('../src/delivery-store.js');
    const store = new DrizzleDeliveryStore(db);
    const now = new Date('2026-01-03T00:00:00Z');
    await store.putBuffer({
      key: 'k1',
      items: [{ destinations: [{ transport: 'slack', address: 'U1' }], payload: { text: 'hello' } }],
      firstAt: now,
      quietUntil: new Date(now.getTime() + 60_000),
      hardCapAt: new Date(now.getTime() + 300_000),
    });
    expect(await store.listDueBuffers(now)).toHaveLength(0);
    expect(await store.listDueBuffers(new Date(now.getTime() + 61_000))).toHaveLength(1);
    await store.deleteBuffer('k1');
    expect(await store.getBuffer('k1')).toBeNull();

    expect(await store.wasSent('d1')).toBe(false);
    await store.markSent('d1', now);
    expect(await store.wasSent('d1')).toBe(true);
  });
});

describe.runIf(!enabled)('persistence (skipped)', () => {
  it('set PG_TESTS=1 to run the Testcontainers suite', () => {
    expect(true).toBe(true);
  });
});
