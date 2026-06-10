import type { EffectiveConfig, MergeDecision, MergePolicy, PrRecord, PrSnapshot } from '../contracts/index.js';

/**
 * The green path. Failing checks and conflicts are the remediation engine's
 * problem; this policy only ever sees a PR the engine had no work for.
 * GitHub's own `mergeable` verdict is the hard gate.
 */
export class DefaultMergePolicy implements MergePolicy {
  decide(record: PrRecord, s: PrSnapshot, cfg: EffectiveConfig): MergeDecision {
    if (s.mergeable === 'conflicting') return { action: 'wait' }; // engine territory
    if (s.checks.some((c) => c.conclusion === null)) return { action: 'wait' };
    const allGreen = s.checks.every((c) => c.conclusion === 'success' || c.conclusion === 'neutral');
    if (!allGreen) return { action: 'wait' }; // failing — engine territory

    if (s.behindBase && cfg.keepBranchUpToDate) return { action: 'update_branch' };
    if (s.mergeable !== 'mergeable') return { action: 'wait' }; // 'unknown': GitHub still computing

    const endAction = record.endAction?.kind ?? cfg.endActionDefault;
    if (endAction === 'merge' && cfg.guardrails.autoMergeAllowed) return { action: 'merge' };
    return { action: 'notify_ready' };
  }
}
