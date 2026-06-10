import { describe, expect, it } from 'vitest';
import { DefaultReportService, type PrRecord } from '@shepherd/core';
import { InMemoryPrRepository } from '../src/fakes.js';

function record(patch: Partial<PrRecord> & Pick<PrRecord, 'id' | 'number' | 'lifecycleState'>): PrRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    repo: 'acme/web', author: 'octocat', enrollment: 'passive',
    remediation: null, escalation: null,
    lastInteractionAt: now, ingestedAt: now, terminalAt: null, nextReconcileAt: now,
    ...patch,
  };
}

describe('DefaultReportService', () => {
  it('orders the digest by triage tier, then priority, then age', async () => {
    const prs = new InMemoryPrRepository();
    const now = new Date('2026-01-10T00:00:00Z');
    await prs.upsert(record({ id: 'p1', number: 1, lifecycleState: 'awaiting_checks' }));
    await prs.upsert(
      record({
        id: 'p2', number: 2, lifecycleState: 'escalated',
        escalation: { reason: 'no remediation matched', headSha: 'x', at: now },
      }),
    );
    await prs.upsert(record({ id: 'p3', number: 3, lifecycleState: 'ready' }));
    await prs.upsert(record({ id: 'p4', number: 4, lifecycleState: 'ready', priority: 1 }));
    await prs.upsert(record({ id: 'p5', number: 5, lifecycleState: 'merged', terminalAt: now })); // excluded

    const service = new DefaultReportService(prs, () => ({ transport: 'slack', address: 'U1' }));
    const digest = await service.buildDailyDigest('user-1', now);

    const order = [...digest.payload.text.matchAll(/#(\d)/g)].map((m) => m[1]);
    expect(order).toEqual(['2', '4', '3', '1']); // escalated > ready(prio 1) > ready > awaiting_checks
    expect(digest.payload.text).toContain('no remediation matched');
    expect(digest.payload.text).not.toContain('#5');
    expect(digest.dedupKey).toBe('digest:user-1:2026-01-10');
  });

  it('handles the empty case', async () => {
    const service = new DefaultReportService(new InMemoryPrRepository(), () => ({ transport: 'slack', address: 'U1' }));
    const digest = await service.buildDailyDigest('user-1', new Date());
    expect(digest.payload.text).toContain('nothing in flight');
  });
});
