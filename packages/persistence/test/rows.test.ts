/**
 * Pure mapping tests for the DB trust boundary: PrRecord ⇄ row, including
 * Zod validation of JSONB on the way out. Runs without Postgres; pg.test.ts
 * re-verifies the same mapping against the real wire types.
 */
import { describe, expect, it } from 'vitest';
import type { PrRecord } from '@shepherd/core';
import { recordToRow, rowToRecord } from '../src/rows.js';

const NOW = new Date('2026-01-05T00:00:00Z');

function fullRecord(): PrRecord {
  return {
    id: 'github:acme/web#42',
    repo: 'acme/web',
    number: 42,
    author: 'octocat',
    enrollment: 'triggered',
    matchedBy: 'api',
    campaignKey: 'q2-cleanup',
    campaignLabel: 'auto-shepherd',
    priority: 1,
    endAction: { kind: 'merge' },
    lifecycleState: 'awaiting_remediation',
    remediation: {
      lastDefId: 'eslint-autofix',
      triggeredAt: NOW,
      cooldownUntil: new Date(NOW.getTime() + 300_000),
      attemptCount: 2,
    },
    escalation: { reason: 'previous escalation', headSha: 'abc', at: NOW },
    configOverrides: { staleEscalateAfterDays: 7 },
    lastInteractionAt: NOW,
    ingestedAt: NOW,
    terminalAt: null,
    nextReconcileAt: new Date(NOW.getTime() + 20_000),
  };
}

function minimalRecord(): PrRecord {
  return {
    id: 'github:acme/web#1',
    repo: 'acme/web',
    number: 1,
    author: 'octocat',
    enrollment: 'passive',
    lifecycleState: 'tracked',
    remediation: null,
    escalation: null,
    lastInteractionAt: NOW,
    ingestedAt: NOW,
    terminalAt: null,
    nextReconcileAt: NOW,
  };
}

describe('record ⇄ row round-trip', () => {
  it('round-trips a fully populated record, dates in JSONB included', () => {
    const original = fullRecord();
    const row = recordToRow(original);
    // JSONB dates serialize as ISO strings...
    expect((row.remediation as { triggeredAt: string }).triggeredAt).toBe(NOW.toISOString());
    // ...and deserialize back into Dates.
    const restored = rowToRecord(row as Parameters<typeof rowToRecord>[0]);
    expect(restored).toEqual(original);
    expect(restored.remediation!.cooldownUntil).toBeInstanceOf(Date);
    expect(restored.escalation!.at).toBeInstanceOf(Date);
  });

  it('round-trips a minimal record (all optionals absent)', () => {
    const original = minimalRecord();
    const restored = rowToRecord(recordToRow(original) as Parameters<typeof rowToRecord>[0]);
    expect(restored).toEqual(original);
    expect(restored.matchedBy).toBeUndefined();
    expect(restored.endAction).toBeUndefined();
    expect(restored.remediation).toBeNull();
  });
});

describe('Zod rejects corrupt JSONB instead of propagating junk into core', () => {
  const base = recordToRow(fullRecord()) as Parameters<typeof rowToRecord>[0];

  it('corrupt remediation blob', () => {
    expect(() => rowToRecord({ ...base, remediation: { lastDefId: 42 } })).toThrow();
    expect(() => rowToRecord({ ...base, remediation: { lastDefId: 'x', triggeredAt: 'not-a-real-field-set' } })).toThrow();
  });

  it('negative attempt counts', () => {
    const remediation = { ...(base.remediation as Record<string, unknown>), attemptCount: -1 };
    expect(() => rowToRecord({ ...base, remediation })).toThrow();
  });

  it('unknown lifecycle state', () => {
    expect(() => rowToRecord({ ...base, lifecycleState: 'levitating' })).toThrow();
  });

  it('unknown enrollment', () => {
    expect(() => rowToRecord({ ...base, enrollment: 'conscripted' })).toThrow();
  });

  it('invented end-action kind (matcher/response split holds at the DB too)', () => {
    expect(() => rowToRecord({ ...base, endAction: { kind: 'self_destruct' } })).toThrow();
  });
});
