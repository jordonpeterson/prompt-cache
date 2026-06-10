import type { PrId } from './ids.js';
import type { EndAction, PrRecord } from './record.js';

export type CommandResult =
  | { ok: true; record: PrRecord }
  | { ok: false; reason: 'not_found' | 'already_terminal' };

/**
 * Human-initiated commands, single-sourced for every driving adapter (HTTP
 * API, Slack interactivity). Deliberately thin: a command may terminalize
 * (abandon — the only manual hard-terminal), nudge timing (reconcileNow), or
 * set human-owned intent (end action). It must NEVER mutate lifecycle state
 * otherwise — the reconcile loop stays the only writer.
 */
export interface PrCommands {
  abandon(prId: PrId, opts: { reason: string; actor: string }): Promise<CommandResult>;
  /** Sets next_reconcile_at = now; the loop derives whatever happens next. */
  reconcileNow(prId: PrId, opts: { actor: string }): Promise<CommandResult>;
  setEndAction(prId: PrId, endAction: EndAction, opts: { actor: string }): Promise<CommandResult>;
}
