export type LifecycleState =
  | 'tracked'
  | 'evaluating'
  /** observing CI */
  | 'awaiting_checks'
  /** DISPLAY-only label: fix triggered, waiting out the cooldown timer (no polling) */
  | 'awaiting_remediation'
  | 'ready'
  | 'merging'
  /** TERMINAL */
  | 'merged'
  /** flagged; autonomous actions paused; still observed; may resume */
  | 'escalated'
  /** TERMINAL (flagged) */
  | 'abandoned'
  /** dormant, visible */
  | 'draft_paused';

export const TERMINAL_STATES: ReadonlySet<LifecycleState> = new Set(['merged', 'abandoned']);

export function isTerminal(state: LifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}
