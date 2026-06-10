import type {
  AuditEvent,
  AuditLog,
  ClockPort,
  CodeHostPort,
  IdemKey,
  IdempotencyStore,
  MergeOutcome,
  PollWindow,
  PrId,
  PrRecord,
  PrRepository,
  PrSnapshot,
  RemediationServicePort,
  RemediationTrigger,
  ShepherdNotifier,
  TxStores,
  UnitOfWork,
} from '@shepherd/core';

export class FakeClock implements ClockPort {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00Z')) {
    this.current = start;
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  advanceSeconds(s: number): void {
    this.advance(s * 1000);
  }
  set(date: Date): void {
    this.current = new Date(date);
  }
}

/**
 * In-memory code host. Tests mutate the world via the setters; the fake
 * records every outbound call so scenarios can assert on side-effects.
 */
export class FakeCodeHost implements CodeHostPort {
  private snapshots = new Map<PrId, PrSnapshot>();
  private logs = new Map<string, string>(); // `${prId}:${runId}` → log text
  readonly merges: Array<{ id: PrId; idem: IdemKey }> = [];
  readonly branchUpdates: Array<{ id: PrId; idem: IdemKey }> = [];
  readonly comments: Array<{ id: PrId; body: string }> = [];
  readonly checkRetries: Array<{ id: PrId; runIds: string[]; idem: IdemKey }> = [];
  /** Set to simulate the host rejecting a merge (e.g. branch protection). */
  mergeFailure: string | null = null;

  setPr(snapshot: PrSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot);
  }
  mutatePr(id: PrId, patch: Partial<PrSnapshot>): void {
    const existing = this.snapshots.get(id);
    if (!existing) throw new Error(`FakeCodeHost: unknown PR ${id}`);
    this.snapshots.set(id, { ...existing, ...patch });
  }
  setJobLog(id: PrId, runId: string, log: string): void {
    this.logs.set(`${id}:${runId}`, log);
  }
  removePr(id: PrId): void {
    this.snapshots.delete(id);
  }

  async *listOpenPrs(_window: PollWindow): AsyncIterable<PrSnapshot> {
    for (const s of this.snapshots.values()) {
      if (s.state === 'open') yield structuredClone(s);
    }
  }
  async getPr(id: PrId): Promise<PrSnapshot | null> {
    const s = this.snapshots.get(id);
    return s ? structuredClone(s) : null;
  }
  async updateBranch(id: PrId, idem: IdemKey): Promise<void> {
    this.branchUpdates.push({ id, idem });
    this.mutatePr(id, { behindBase: false });
  }
  async merge(id: PrId, idem: IdemKey): Promise<MergeOutcome> {
    this.merges.push({ id, idem });
    if (this.mergeFailure) return { result: 'failed', reason: this.mergeFailure };
    this.mutatePr(id, { state: 'merged' });
    return { result: 'merged' };
  }
  async postComment(id: PrId, body: string): Promise<void> {
    this.comments.push({ id, body });
  }
  async retryChecks(id: PrId, runIds: string[], idem: IdemKey): Promise<void> {
    this.checkRetries.push({ id, runIds, idem });
  }
  async getJobLogs(id: PrId, runId: string): Promise<string> {
    return this.logs.get(`${id}:${runId}`) ?? '';
  }
}

/**
 * Honors the §6 HARD REQUIREMENT: dedupes on idempotencyKey — the same key is
 * acknowledged but never recorded as a second run.
 */
export class FakeRemediationService implements RemediationServicePort {
  readonly triggers: RemediationTrigger[] = [];
  private seenKeys = new Set<string>();
  /** task → reason; tasks listed here are declined. */
  declineTasks = new Map<string, string>();

  async trigger(req: RemediationTrigger): Promise<{ result: 'accepted' | 'declined'; reason?: string }> {
    const declineReason = this.declineTasks.get(req.task);
    if (declineReason !== undefined) return { result: 'declined', reason: declineReason };
    if (this.seenKeys.has(req.idempotencyKey)) return { result: 'accepted' }; // dedupe: ack, no second run
    this.seenKeys.add(req.idempotencyKey);
    this.triggers.push(structuredClone(req));
    return { result: 'accepted' };
  }
}

export class InMemoryPrRepository implements PrRepository {
  private records = new Map<PrId, PrRecord>();
  /** Lease applied by claim so concurrent workers don't double-process. */
  leaseSeconds = 60;

  async upsert(record: PrRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }
  async get(id: PrId): Promise<PrRecord | null> {
    const r = this.records.get(id);
    return r ? structuredClone(r) : null;
  }
  async claimDueForReconcile(limit: number, now: Date): Promise<PrRecord[]> {
    const due = [...this.records.values()]
      .filter((r) => r.terminalAt === null && r.nextReconcileAt.getTime() <= now.getTime())
      .sort((a, b) => a.nextReconcileAt.getTime() - b.nextReconcileAt.getTime())
      .slice(0, limit);
    for (const r of due) {
      r.nextReconcileAt = new Date(now.getTime() + this.leaseSeconds * 1000);
    }
    return due.map((r) => structuredClone(r));
  }
  async listActive(): Promise<PrRecord[]> {
    return [...this.records.values()].filter((r) => r.terminalAt === null).map((r) => structuredClone(r));
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly keys = new Set<IdemKey>();

  async reserve(key: IdemKey): Promise<boolean> {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
}

export class InMemoryAuditLog implements AuditLog {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
  async list(prId?: PrId): Promise<AuditEvent[]> {
    return this.events.filter((e) => !prId || e.prId === prId).map((e) => structuredClone(e));
  }
}

/** In-memory "transaction": same stores, sequential — atomic enough for tests. */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly stores: TxStores) {}

  async run<T>(fn: (tx: TxStores) => Promise<T>): Promise<T> {
    return fn(this.stores);
  }
}

export class RecordingNotifier implements ShepherdNotifier {
  readonly events: Array<{ kind: 'escalated' | 'ready' | 'merged'; prId: PrId; reason?: string }> = [];

  async prEscalated(record: PrRecord, reason: string): Promise<void> {
    this.events.push({ kind: 'escalated', prId: record.id, reason });
  }
  async prReady(record: PrRecord): Promise<void> {
    this.events.push({ kind: 'ready', prId: record.id });
  }
  async prMerged(record: PrRecord): Promise<void> {
    this.events.push({ kind: 'merged', prId: record.id });
  }
}
