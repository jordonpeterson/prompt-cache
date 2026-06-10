import type { ClockPort, CommandResult, EndAction, PrCommands, PrId, UnitOfWork } from '../contracts/index.js';

export class DefaultPrCommands implements PrCommands {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: ClockPort,
  ) {}

  async abandon(prId: PrId, opts: { reason: string; actor: string }): Promise<CommandResult> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const record = await tx.prs.get(prId);
      if (!record) return { ok: false, reason: 'not_found' };
      if (record.terminalAt) return { ok: false, reason: 'already_terminal' };
      const next = { ...record, lifecycleState: 'abandoned' as const, terminalAt: now };
      await tx.prs.upsert(next);
      await tx.audit.record({
        prId,
        type: 'terminal',
        payload: { state: 'abandoned', reason: opts.reason, by: opts.actor },
        at: now,
      });
      return { ok: true, record: next };
    });
  }

  async reconcileNow(prId: PrId, opts: { actor: string }): Promise<CommandResult> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const record = await tx.prs.get(prId);
      if (!record) return { ok: false, reason: 'not_found' };
      if (record.terminalAt) return { ok: false, reason: 'already_terminal' };
      const next = { ...record, nextReconcileAt: now };
      await tx.prs.upsert(next);
      await tx.audit.record({
        prId,
        type: 'reconcile_requested',
        payload: { by: opts.actor },
        at: now,
      });
      return { ok: true, record: next };
    });
  }

  async setEndAction(prId: PrId, endAction: EndAction, opts: { actor: string }): Promise<CommandResult> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const record = await tx.prs.get(prId);
      if (!record) return { ok: false, reason: 'not_found' };
      if (record.terminalAt) return { ok: false, reason: 'already_terminal' };
      const next = { ...record, endAction };
      await tx.prs.upsert(next);
      await tx.audit.record({
        prId,
        type: 'end_action_set',
        payload: { endAction: endAction.kind, by: opts.actor },
        at: now,
      });
      return { ok: true, record: next };
    });
  }
}
