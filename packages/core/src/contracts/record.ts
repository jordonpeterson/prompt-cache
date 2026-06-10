import type { PrId } from './ids.js';
import type { LifecycleState } from './lifecycle.js';

export type Enrollment = 'passive' | 'triggered';

export type EndAction = { kind: 'merge' } | { kind: 'notify_ready' };

/** Carried by the trigger API / Slack UI; stamps campaign metadata onto the record. */
export interface TriggerEnvelope {
  source: 'api' | 'slack' | 'label' | 'author';
  campaignKey?: string;
  campaignLabel?: string;
  priority?: number;
  endAction?: EndAction;
  /** Per-PR preference overrides, stamped at trigger time (§10). */
  overrides?: Record<string, unknown>;
}

export interface RemediationState {
  lastDefId: string;
  triggeredAt: Date;
  /** triggeredAt + cooldownSeconds — the fire-and-wait timer (§6). */
  cooldownUntil: Date;
  attemptCount: number;
}

export interface EscalationState {
  reason: string;
  /** Head at escalation time; a new head ⇒ human acted ⇒ may resume. */
  headSha: string;
  at: Date;
}

export interface PrRecord {
  id: PrId;
  repo: string;
  number: number;
  author: string;
  enrollment: Enrollment;
  /** Which enrollment rule matched (label name, author rule, 'api'). */
  matchedBy?: string;
  campaignKey?: string;
  campaignLabel?: string;
  priority?: number;
  /** Triggered enrollment only. */
  endAction?: EndAction;
  lifecycleState: LifecycleState;
  remediation: RemediationState | null;
  escalation: EscalationState | null;
  /** Per-PR preference overrides (most-specific layer of the cascade). */
  configOverrides?: Record<string, unknown>;
  lastInteractionAt: Date;
  ingestedAt: Date;
  terminalAt: Date | null;
  /** Tiered polling key (§11). */
  nextReconcileAt: Date;
}
