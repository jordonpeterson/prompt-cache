import type {
  ClockPort,
  CodeHostPort,
  ConfigResolver,
  EffectiveConfig,
  LifecycleState,
  MergePolicy,
  PrRecord,
  PrRepository,
  PrSnapshot,
  RemediationEngine,
  RemediationServicePort,
  ResponseAction,
  ShepherdController,
  ShepherdNotifier,
  TickReport,
  TxStores,
  UnitOfWork,
} from '../contracts/index.js';
import { isTerminal, mergeKey, remediationKey, updateBranchKey } from '../contracts/index.js';

export interface CadenceSeconds {
  awaiting_remediation: number;
  awaiting_checks: number;
  evaluating: number;
  tracked: number;
  merging: number;
  ready: number;
  escalated: number;
  draft_paused: number;
}

export const DEFAULT_CADENCE: CadenceSeconds = {
  awaiting_remediation: 20,
  awaiting_checks: 30,
  evaluating: 30,
  tracked: 60,
  merging: 15,
  ready: 120,
  escalated: 3600,
  draft_paused: 4 * 3600,
};

export interface ControllerOptions {
  claimLimit: number;
  cadence: CadenceSeconds;
  /** ±10% jitter source; inject `() => 0.5` for zero jitter in tests. */
  random: () => number;
}

interface TickTrace {
  transitions: TickReport['transitions'];
  actions: TickReport['actions'];
  pendingAudits: Array<{ prId: string; from: string; to: string; reason: string }>;
}

function newTrace(): TickTrace {
  return { transitions: [], actions: [], pendingAudits: [] };
}

/**
 * The reconciliation loop (§1.1): level-triggered, idempotent, restart-safe.
 * Each tick re-derives the single next action from
 * (persisted state + latest GitHub snapshot). `reconcile` is the only place
 * lifecycle state mutates, and it performs at most ONE guarded side-effect
 * per PR per tick, committed atomically with its idempotency reservation.
 */
export class DefaultShepherdController implements ShepherdController {
  private readonly opts: ControllerOptions;

  constructor(
    private readonly deps: {
      codeHost: CodeHostPort;
      remediationService: RemediationServicePort;
      clock: ClockPort;
      uow: UnitOfWork;
      prs: PrRepository;
      resolver: ConfigResolver;
      engine: RemediationEngine;
      mergePolicy: MergePolicy;
      notifier: ShepherdNotifier;
    },
    opts?: Partial<ControllerOptions>,
  ) {
    this.opts = {
      claimLimit: opts?.claimLimit ?? 50,
      cadence: opts?.cadence ?? DEFAULT_CADENCE,
      random: opts?.random ?? (() => 0.5),
    };
  }

  async tick(now: Date): Promise<TickReport> {
    const claimed = await this.deps.prs.claimDueForReconcile(this.opts.claimLimit, now);
    const trace = newTrace();
    const errors: TickReport['errors'] = [];
    for (const record of claimed) {
      try {
        const snapshot = await this.deps.codeHost.getPr(record.id);
        if (snapshot === null) {
          await this.terminalize(record, 'abandoned', 'PR no longer exists on the code host', trace);
          continue;
        }
        await this.reconcileTraced(record, snapshot, trace);
      } catch (err) {
        errors.push({ prId: record.id, error: err instanceof Error ? err.message : String(err) });
        await this.backoffAfterError(record, err);
      }
    }
    return { claimed: claimed.length, transitions: trace.transitions, actions: trace.actions, errors };
  }

  async reconcile(record: PrRecord, snapshot: PrSnapshot): Promise<PrRecord> {
    return this.reconcileTraced(record, snapshot, newTrace());
  }

  private async reconcileTraced(record: PrRecord, snapshot: PrSnapshot, trace: TickTrace): Promise<PrRecord> {
    const now = this.deps.clock.now();
    let r: PrRecord = { ...record };
    if (isTerminal(r.lifecycleState)) return r;

    // ── Externally resolved? ──────────────────────────────────────────────
    if (snapshot.state === 'merged') return this.terminalize(r, 'merged', 'merged on the code host', trace);
    if (snapshot.state === 'closed') return this.terminalize(r, 'abandoned', 'closed without merge', trace);

    // ── Draft gate ────────────────────────────────────────────────────────
    if (snapshot.isDraft) {
      if (r.lifecycleState !== 'draft_paused') r = this.transition(r, 'draft_paused', 'PR is a draft', trace);
      return this.persist(this.schedule(r, now), trace, []);
    }
    if (r.lifecycleState === 'draft_paused') {
      r = this.transition(r, 'evaluating', 'draft published', trace);
    }

    const cfg = this.deps.resolver.resolve(r.id, r.configOverrides);

    // ── Escalated: paused but observed; a new head means a human acted ────
    if (r.lifecycleState === 'escalated') {
      if (r.escalation && snapshot.headSha !== r.escalation.headSha) {
        // Human intervention resets the remediation attempt counters.
        r = { ...r, escalation: null, remediation: null };
        r = this.transition(r, 'evaluating', 'new commits since escalation — resuming', trace);
      } else {
        return this.persist(this.schedule(r, now), trace, []);
      }
    }

    // ── Staleness ─────────────────────────────────────────────────────────
    const staleMs = cfg.staleness.escalateAfterDays * 24 * 3600 * 1000;
    if (now.getTime() - snapshot.lastActivityAt.getTime() >= staleMs) {
      return this.escalate(r, snapshot, `stale: no activity for ${cfg.staleness.escalateAfterDays}+ days`, trace);
    }

    // ── Fire-and-wait cooldown (§6): during `c`, do nothing about this fix ─
    const inFlight = r.remediation;
    if (inFlight && inFlight.cooldownUntil.getTime() > now.getTime()) {
      if (r.lifecycleState !== 'awaiting_remediation') {
        r = this.transition(r, 'awaiting_remediation', 'remediation in flight', trace);
      }
      const wakeAt = Math.min(
        inFlight.cooldownUntil.getTime(),
        now.getTime() + this.opts.cadence.awaiting_remediation * 1000,
      );
      return this.persist({ ...r, nextReconcileAt: new Date(wakeAt) }, trace, []);
    }

    // ── Remediation engine: one def-level decision per tick ───────────────
    const decision = await this.deps.engine.evaluate(r, snapshot, cfg);
    if (decision.kind === 'escalate') return this.escalate(r, snapshot, decision.reason, trace);
    if (decision.kind === 'response') return this.applyResponse(r, snapshot, cfg, decision.defId, decision.action, trace);

    // ── Green path: merge policy ──────────────────────────────────────────
    if (snapshot.checks.some((c) => c.conclusion === null)) {
      if (r.lifecycleState !== 'awaiting_checks') r = this.transition(r, 'awaiting_checks', 'CI running', trace);
      return this.persist(this.schedule(r, now), trace, []);
    }

    const verdict = this.deps.mergePolicy.decide(r, snapshot, cfg);
    switch (verdict.action) {
      case 'merge':
        return this.applyMerge(r, snapshot, trace);
      case 'update_branch':
        return this.applyUpdateBranch(r, snapshot, trace);
      case 'notify_ready': {
        if (r.lifecycleState !== 'ready') {
          r = this.transition(r, 'ready', 'all gates green; awaiting human', trace);
          r = await this.persist(this.schedule(r, now), trace, [
            { prId: r.id, type: 'ready_to_merge', payload: { headSha: snapshot.headSha }, at: now },
          ]);
          await this.deps.notifier.prReady(r);
          return r;
        }
        return this.persist(this.schedule(r, now), trace, []);
      }
      case 'wait': {
        if (r.lifecycleState === 'tracked') r = this.transition(r, 'evaluating', 'first evaluation', trace);
        return this.persist(this.schedule(r, now), trace, []);
      }
    }
  }

  // ── Actions (each is the tick's single guarded side-effect) ─────────────

  private async applyResponse(
    r: PrRecord,
    snapshot: PrSnapshot,
    cfg: EffectiveConfig,
    defId: string,
    action: ResponseAction,
    trace: TickTrace,
  ): Promise<PrRecord> {
    const now = this.deps.clock.now();
    const def = cfg.remediations.find((d) => d.id === defId);
    if (!def) return this.escalate(r, snapshot, `engine selected unknown def '${defId}'`, trace);

    const priorAttempts = r.remediation?.lastDefId === defId ? r.remediation.attemptCount : 0;
    const attemptNo = priorAttempts + 1;
    const key = remediationKey(r.id, snapshot.headSha, defId, attemptNo);

    return this.deps.uow.run(async (tx) => {
      if (!(await tx.idempotency.reserve(key))) {
        // Already fired for this head+attempt (concurrent worker / replays).
        return this.persistTx(tx, this.schedule(r, now), trace);
      }

      let declinedReason: string | null = null;
      if (action.kind === 'external') {
        const failingJobs = snapshot.checks
          .filter((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out')
          .map((c) => c.jobName ?? c.name);
        const ack = await this.deps.remediationService.trigger({
          idempotencyKey: key,
          task: action.task,
          target: { repo: r.repo, prNumber: r.number, headRef: snapshot.headRef, headSha: snapshot.headSha },
          context: failingJobs.length ? { failingJobs } : undefined,
        });
        if (ack.result === 'declined') declinedReason = ack.reason ?? 'remediation service declined';
      } else if (action.kind === 'retry_checks') {
        const runIds = snapshot.checks.filter((c) => c.conclusion !== null && c.conclusion !== 'success').map((c) => c.runId);
        await this.deps.codeHost.retryChecks(r.id, runIds, key);
      } else {
        await this.deps.codeHost.updateBranch(r.id, key);
      }

      if (declinedReason !== null) {
        // Hard decline escalates immediately instead of burning `c` (§6).
        const next = this.transition(r, 'escalated', `'${defId}' declined: ${declinedReason}`, trace);
        const escalated: PrRecord = {
          ...next,
          escalation: { reason: declinedReason, headSha: snapshot.headSha, at: now },
        };
        await tx.audit.record({ prId: r.id, type: 'escalated', payload: { reason: declinedReason, defId }, at: now });
        const persisted = await this.persistTx(tx, this.schedule(escalated, now), trace);
        trace.actions.push({ prId: r.id, kind: 'remediation_declined', detail: { defId, reason: declinedReason } });
        await this.deps.notifier.prEscalated(persisted, declinedReason);
        return persisted;
      }

      const fired: PrRecord = {
        ...this.transition(r, 'awaiting_remediation', `'${defId}' triggered (attempt ${attemptNo})`, trace),
        remediation: {
          lastDefId: defId,
          triggeredAt: now,
          cooldownUntil: new Date(now.getTime() + def.cooldownSeconds * 1000),
          attemptCount: attemptNo,
        },
        lastInteractionAt: now,
      };
      await tx.audit.record({
        prId: r.id, type: 'remediation_triggered',
        payload: { defId, attempt: attemptNo, key, response: action.kind }, at: now,
      });
      trace.actions.push({ prId: r.id, kind: 'remediation_triggered', detail: { defId, attempt: attemptNo } });
      const wakeAt = Math.min(fired.remediation!.cooldownUntil.getTime(), now.getTime() + this.opts.cadence.awaiting_remediation * 1000);
      return this.persistTx(tx, { ...fired, nextReconcileAt: new Date(wakeAt) }, trace);
    });
  }

  private async applyMerge(r: PrRecord, snapshot: PrSnapshot, trace: TickTrace): Promise<PrRecord> {
    const now = this.deps.clock.now();
    const key = mergeKey(r.id, snapshot.headSha);
    return this.deps.uow.run(async (tx) => {
      if (!(await tx.idempotency.reserve(key))) {
        // A previous attempt committed; wait for the host to reflect it.
        const next = r.lifecycleState === 'merging' ? r : this.transition(r, 'merging', 'merge already in flight', trace);
        return this.persistTx(tx, this.schedule(next, now), trace);
      }
      const outcome = await this.deps.codeHost.merge(r.id, key);
      if (outcome.result === 'merged') {
        const merged: PrRecord = {
          ...this.transition(r, 'merged', 'merged by shepherd', trace),
          terminalAt: now,
          lastInteractionAt: now,
        };
        await tx.audit.record({ prId: r.id, type: 'terminal', payload: { state: 'merged', key }, at: now });
        trace.actions.push({ prId: r.id, kind: 'merged' });
        const persisted = await this.persistTx(tx, merged, trace);
        await this.deps.notifier.prMerged(persisted);
        return persisted;
      }
      const reason = `merge failed: ${outcome.reason}`;
      const next: PrRecord = {
        ...this.transition(r, 'escalated', reason, trace),
        escalation: { reason, headSha: snapshot.headSha, at: now },
      };
      await tx.audit.record({ prId: r.id, type: 'escalated', payload: { reason }, at: now });
      trace.actions.push({ prId: r.id, kind: 'merge_failed', detail: { reason: outcome.reason } });
      const persisted = await this.persistTx(tx, this.schedule(next, now), trace);
      await this.deps.notifier.prEscalated(persisted, reason);
      return persisted;
    });
  }

  private async applyUpdateBranch(r: PrRecord, snapshot: PrSnapshot, trace: TickTrace): Promise<PrRecord> {
    const now = this.deps.clock.now();
    const key = updateBranchKey(r.id, snapshot.headSha);
    return this.deps.uow.run(async (tx) => {
      if (!(await tx.idempotency.reserve(key))) {
        return this.persistTx(tx, this.schedule(r, now), trace);
      }
      await this.deps.codeHost.updateBranch(r.id, key);
      await tx.audit.record({ prId: r.id, type: 'branch_updated', payload: { key }, at: now });
      trace.actions.push({ prId: r.id, kind: 'update_branch' });
      const next = r.lifecycleState === 'evaluating' ? r : this.transition(r, 'evaluating', 'updating branch from base', trace);
      return this.persistTx(tx, { ...this.schedule(next, now), lastInteractionAt: now }, trace);
    });
  }

  private async escalate(r: PrRecord, snapshot: PrSnapshot, reason: string, trace: TickTrace): Promise<PrRecord> {
    const now = this.deps.clock.now();
    const next: PrRecord = {
      ...this.transition(r, 'escalated', reason, trace),
      escalation: { reason, headSha: snapshot.headSha, at: now },
    };
    const persisted = await this.persist(this.schedule(next, now), trace, [
      { prId: r.id, type: 'escalated', payload: { reason }, at: now },
    ]);
    trace.actions.push({ prId: r.id, kind: 'escalated', detail: { reason } });
    await this.deps.notifier.prEscalated(persisted, reason);
    return persisted;
  }

  private async terminalize(
    r: PrRecord,
    state: 'merged' | 'abandoned',
    reason: string,
    trace: TickTrace,
  ): Promise<PrRecord> {
    const now = this.deps.clock.now();
    const next: PrRecord = { ...this.transition(r, state, reason, trace), terminalAt: now };
    return this.persist(next, trace, [
      { prId: r.id, type: 'terminal', payload: { state, reason }, at: now },
    ]);
  }

  // ── Plumbing ─────────────────────────────────────────────────────────────

  private transition(r: PrRecord, to: LifecycleState, reason: string, trace: TickTrace): PrRecord {
    if (r.lifecycleState === to) return r;
    trace.transitions.push({ prId: r.id, from: r.lifecycleState, to });
    trace.pendingAudits.push({ prId: r.id, from: r.lifecycleState, to, reason });
    return { ...r, lifecycleState: to };
  }

  private schedule(r: PrRecord, now: Date): PrRecord {
    if (r.terminalAt) return r;
    const base = this.opts.cadence[r.lifecycleState as keyof CadenceSeconds] ?? this.opts.cadence.evaluating;
    const jitter = base * 0.2 * (this.opts.random() - 0.5); // ±10%
    return { ...r, nextReconcileAt: new Date(now.getTime() + (base + jitter) * 1000) };
  }

  /** Commit record + audit events in one unit of work. */
  private async persist(r: PrRecord, trace: TickTrace, events: Parameters<TxStores['audit']['record']>[0][]): Promise<PrRecord> {
    return this.deps.uow.run(async (tx) => {
      for (const e of events) await tx.audit.record(e);
      return this.persistTx(tx, r, trace);
    });
  }

  private async persistTx(tx: TxStores, r: PrRecord, trace: TickTrace): Promise<PrRecord> {
    const now = this.deps.clock.now();
    for (const t of trace.pendingAudits.splice(0)) {
      await tx.audit.record({
        prId: t.prId, type: 'state_transition',
        payload: { from: t.from, to: t.to, reason: t.reason }, at: now,
      });
    }
    await tx.prs.upsert(r);
    return r;
  }

  private async backoffAfterError(record: PrRecord, err: unknown): Promise<void> {
    const now = this.deps.clock.now();
    try {
      await this.deps.uow.run(async (tx) => {
        await tx.audit.record({
          prId: record.id, type: 'reconcile_error',
          payload: { error: err instanceof Error ? err.message : String(err) }, at: now,
        });
        await tx.prs.upsert({ ...record, nextReconcileAt: new Date(now.getTime() + 60_000) });
      });
    } catch {
      // Audit of the failure itself failed; the lease expiry will retry the PR.
    }
  }
}
