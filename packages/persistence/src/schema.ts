import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const prRecords = pgTable(
  'pr_records',
  {
    id: text('id').primaryKey(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    author: text('author').notNull(),
    enrollment: text('enrollment').notNull(),
    matchedBy: text('matched_by'),
    campaignKey: text('campaign_key'),
    campaignLabel: text('campaign_label'),
    priority: integer('priority'),
    endAction: jsonb('end_action'),
    lifecycleState: text('lifecycle_state').notNull(),
    remediation: jsonb('remediation'),
    escalation: jsonb('escalation'),
    configOverrides: jsonb('config_overrides'),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    nextReconcileAt: timestamp('next_reconcile_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('pr_records_due_idx').on(t.nextReconcileAt)],
);

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    prId: text('pr_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [index('audit_events_pr_idx').on(t.prId)],
);

export const configSnapshots = pgTable('config_snapshots', {
  prId: text('pr_id').primaryKey(),
  effective: jsonb('effective').notNull(),
  provenance: jsonb('provenance').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
});

// ── owned by the delivery package ──────────────────────────────────────────

export const deliveryBuffer = pgTable('delivery_buffer', {
  key: text('key').primaryKey(),
  items: jsonb('items').notNull(),
  firstAt: timestamp('first_at', { withTimezone: true }).notNull(),
  quietUntil: timestamp('quiet_until', { withTimezone: true }).notNull(),
  hardCapAt: timestamp('hard_cap_at', { withTimezone: true }).notNull(),
});

export const deliverySent = pgTable('delivery_sent', {
  dedupKey: text('dedup_key').primaryKey(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
});
