import type { IdemKey, PrId } from './ids.js';
import type { PrRecord } from './record.js';

export interface PrRepository {
  upsert(record: PrRecord): Promise<void>;
  get(id: PrId): Promise<PrRecord | null>;
  /**
   * Lease-based claim: SELECT ... FOR UPDATE SKIP LOCKED, bumping
   * next_reconcile_at by a short lease so concurrent workers don't collide.
   */
  claimDueForReconcile(limit: number, now: Date): Promise<PrRecord[]>;
  /** Non-terminal records — report/digest input. */
  listActive(): Promise<PrRecord[]>;
}

export interface IdempotencyStore {
  /** false ⇒ already done/in-flight; committed in the SAME txn as the transition. */
  reserve(key: IdemKey): Promise<boolean>;
}

export interface AuditEvent {
  prId: PrId | null;
  type: string;
  payload: Record<string, unknown>;
  at: Date;
}

/** "Nothing exits silently" — every terminal transition lands here. */
export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
  list(prId?: PrId): Promise<AuditEvent[]>;
}

export interface TxStores {
  prs: PrRepository;
  idempotency: IdempotencyStore;
  audit: AuditLog;
}

/**
 * Unit of work: the idempotency reservation and the state transition commit
 * atomically (§8). The guarded side-effect runs inside `run` between the
 * reservation and the commit; a crash before commit re-runs next tick with the
 * same deterministic key and the downstream dedupes.
 */
export interface UnitOfWork {
  run<T>(fn: (tx: TxStores) => Promise<T>): Promise<T>;
}
