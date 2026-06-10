import type { PrId } from './ids.js';
import type { PrRecord, TriggerEnvelope } from './record.js';
import type { PrSnapshot } from './snapshot.js';
import type { EffectiveConfig, ResponseAction } from './config.js';
import type { LifecycleState } from './lifecycle.js';

export interface IngestionService {
  /** Enrollment: label/author = passive; trigger = +end-action +campaign metadata. */
  ingest(snapshot: PrSnapshot, trigger?: TriggerEnvelope): Promise<PrRecord>;
}

export type RemediationDecision =
  | { kind: 'noop' }
  | { kind: 'response'; defId: string; action: ResponseAction }
  /** DEFAULT case — never silently dropped. */
  | { kind: 'escalate'; reason: string };

/**
 * ONE def-level decision per tick. Async because Phase-2 matching may fetch
 * job logs through the LogSource port (README §Deviations — the doc shows a
 * sync signature but mandates log fetching in §7.4).
 */
export interface RemediationEngine {
  evaluate(record: PrRecord, snapshot: PrSnapshot, cfg: EffectiveConfig): Promise<RemediationDecision>;
}

export type MergeDecision =
  | { action: 'merge' }
  | { action: 'update_branch' }
  | { action: 'notify_ready' }
  | { action: 'wait' };

export interface MergePolicy {
  decide(record: PrRecord, s: PrSnapshot, cfg: EffectiveConfig): MergeDecision;
}

export interface TickAction {
  prId: PrId;
  kind: string;
  detail?: Record<string, unknown>;
}

export interface TickReport {
  claimed: number;
  transitions: Array<{ prId: PrId; from: LifecycleState; to: LifecycleState }>;
  actions: TickAction[];
  errors: Array<{ prId: PrId; error: string }>;
}

export interface ShepherdController {
  /** claim batch → reconcile each → persist */
  tick(now: Date): Promise<TickReport>;
  /** Only place that mutates lifecycle state. */
  reconcile(record: PrRecord, snapshot: PrSnapshot): Promise<PrRecord>;
}
