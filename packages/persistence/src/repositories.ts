import { asc, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  AuditEvent,
  AuditLog,
  IdemKey,
  IdempotencyStore,
  PrId,
  PrRecord,
  PrRepository,
  TxStores,
  UnitOfWork,
} from '@shepherd/core';
import { auditEvents, idempotencyKeys, prRecords } from './schema.js';
import { recordToRow, rowToRecord } from './rows.js';

export type Db = NodePgDatabase<Record<string, never>>;

export class DrizzlePrRepository implements PrRepository {
  constructor(
    private readonly db: Db,
    private readonly leaseSeconds = 60,
  ) {}

  async upsert(record: PrRecord): Promise<void> {
    const row = recordToRow(record);
    await this.db.insert(prRecords).values(row).onConflictDoUpdate({ target: prRecords.id, set: row });
  }

  async get(id: PrId): Promise<PrRecord | null> {
    const rows = await this.db.select().from(prRecords).where(eq(prRecords.id, id)).limit(1);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  /**
   * Lease-based claim: bump next_reconcile_at by a short lease inside the
   * locking statement so N workers can run concurrently (SKIP LOCKED) without
   * holding row locks for the duration of the reconcile.
   */
  async claimDueForReconcile(limit: number, now: Date): Promise<PrRecord[]> {
    const lease = new Date(now.getTime() + this.leaseSeconds * 1000);
    const rows = await this.db.execute(sql`
      UPDATE ${prRecords} SET next_reconcile_at = ${lease.toISOString()}
      WHERE id IN (
        SELECT id FROM ${prRecords}
        WHERE next_reconcile_at <= ${now.toISOString()} AND terminal_at IS NULL
        ORDER BY next_reconcile_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    return rows.rows.map((raw) => rowToRecord(mapRawRow(raw as Record<string, unknown>)));
  }

  async listActive(): Promise<PrRecord[]> {
    const rows = await this.db
      .select()
      .from(prRecords)
      .where(isNull(prRecords.terminalAt))
      .orderBy(asc(prRecords.ingestedAt));
    return rows.map(rowToRecord);
  }
}

/** Raw `RETURNING *` rows come back snake_case; map them onto the drizzle shape. */
function mapRawRow(raw: Record<string, unknown>): typeof prRecords.$inferSelect {
  const date = (v: unknown) => (v == null ? null : new Date(v as string));
  return {
    id: raw['id'] as string,
    repo: raw['repo'] as string,
    number: raw['number'] as number,
    author: raw['author'] as string,
    enrollment: raw['enrollment'] as string,
    matchedBy: (raw['matched_by'] as string | null) ?? null,
    campaignKey: (raw['campaign_key'] as string | null) ?? null,
    campaignLabel: (raw['campaign_label'] as string | null) ?? null,
    priority: (raw['priority'] as number | null) ?? null,
    endAction: raw['end_action'] ?? null,
    lifecycleState: raw['lifecycle_state'] as string,
    remediation: raw['remediation'] ?? null,
    escalation: raw['escalation'] ?? null,
    configOverrides: raw['config_overrides'] ?? null,
    lastInteractionAt: date(raw['last_interaction_at'])!,
    ingestedAt: date(raw['ingested_at'])!,
    terminalAt: date(raw['terminal_at']),
    nextReconcileAt: date(raw['next_reconcile_at'])!,
  };
}

export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Db) {}

  async reserve(key: IdemKey): Promise<boolean> {
    const res = await this.db.insert(idempotencyKeys).values({ key }).onConflictDoNothing();
    return (res.rowCount ?? 0) > 0;
  }
}

export class DrizzleAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}

  async record(event: AuditEvent): Promise<void> {
    await this.db.insert(auditEvents).values({
      prId: event.prId,
      type: event.type,
      payload: event.payload,
      at: event.at,
    });
  }

  async list(prId?: PrId): Promise<AuditEvent[]> {
    const rows = prId
      ? await this.db.select().from(auditEvents).where(eq(auditEvents.prId, prId)).orderBy(asc(auditEvents.id))
      : await this.db.select().from(auditEvents).orderBy(asc(auditEvents.id));
    return rows.map((r) => ({
      prId: r.prId,
      type: r.type,
      payload: r.payload as Record<string, unknown>,
      at: r.at,
    }));
  }
}

/**
 * Postgres unit of work: the idempotency reservation and the record upsert
 * commit atomically (§8). The guarded side-effect runs between them inside
 * `fn`; see contracts/repositories.ts for the crash-safety argument.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Db) {}

  async run<T>(fn: (tx: TxStores) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const stores: TxStores = {
        prs: new DrizzlePrRepository(tx as unknown as Db),
        idempotency: new DrizzleIdempotencyStore(tx as unknown as Db),
        audit: new DrizzleAuditLog(tx as unknown as Db),
      };
      return fn(stores);
    });
  }
}
