import { z } from 'zod';
import type { PrRecord } from '@shepherd/core';
import type { prRecords } from './schema.js';

/**
 * Zod at the DB trust boundary (§8): JSONB columns are validated on
 * deserialization. Dates inside JSONB round-trip as ISO strings.
 */
const isoDate = z.string().transform((s) => new Date(s));

export const endActionSchema = z.object({ kind: z.enum(['merge', 'notify_ready']) });

export const remediationStateSchema = z.object({
  lastDefId: z.string(),
  triggeredAt: isoDate,
  cooldownUntil: isoDate,
  attemptCount: z.number().int().nonnegative(),
});

export const escalationStateSchema = z.object({
  reason: z.string(),
  headSha: z.string(),
  at: isoDate,
});

const lifecycleStateSchema = z.enum([
  'tracked', 'evaluating', 'awaiting_checks', 'awaiting_remediation',
  'ready', 'merging', 'merged', 'escalated', 'abandoned', 'draft_paused',
]);

const enrollmentSchema = z.enum(['passive', 'triggered']);

type PrRow = typeof prRecords.$inferSelect;

export function rowToRecord(row: PrRow): PrRecord {
  return {
    id: row.id,
    repo: row.repo,
    number: row.number,
    author: row.author,
    enrollment: enrollmentSchema.parse(row.enrollment),
    matchedBy: row.matchedBy ?? undefined,
    campaignKey: row.campaignKey ?? undefined,
    campaignLabel: row.campaignLabel ?? undefined,
    priority: row.priority ?? undefined,
    endAction: row.endAction == null ? undefined : endActionSchema.parse(row.endAction),
    lifecycleState: lifecycleStateSchema.parse(row.lifecycleState),
    remediation: row.remediation == null ? null : remediationStateSchema.parse(row.remediation),
    escalation: row.escalation == null ? null : escalationStateSchema.parse(row.escalation),
    configOverrides: row.configOverrides == null ? undefined : (row.configOverrides as Record<string, unknown>),
    lastInteractionAt: row.lastInteractionAt,
    ingestedAt: row.ingestedAt,
    terminalAt: row.terminalAt,
    nextReconcileAt: row.nextReconcileAt,
  };
}

export function recordToRow(record: PrRecord): typeof prRecords.$inferInsert {
  return {
    id: record.id,
    repo: record.repo,
    number: record.number,
    author: record.author,
    enrollment: record.enrollment,
    matchedBy: record.matchedBy ?? null,
    campaignKey: record.campaignKey ?? null,
    campaignLabel: record.campaignLabel ?? null,
    priority: record.priority ?? null,
    endAction: record.endAction ?? null,
    lifecycleState: record.lifecycleState,
    remediation:
      record.remediation == null
        ? null
        : {
            ...record.remediation,
            triggeredAt: record.remediation.triggeredAt.toISOString(),
            cooldownUntil: record.remediation.cooldownUntil.toISOString(),
          },
    escalation:
      record.escalation == null
        ? null
        : { ...record.escalation, at: record.escalation.at.toISOString() },
    configOverrides: record.configOverrides ?? null,
    lastInteractionAt: record.lastInteractionAt,
    ingestedAt: record.ingestedAt,
    terminalAt: record.terminalAt,
    nextReconcileAt: record.nextReconcileAt,
  };
}
