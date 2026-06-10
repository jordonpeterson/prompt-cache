import type {
  EffectiveConfig,
  LogSource,
  PrRecord,
  PrSnapshot,
  RemediationDecision,
  RemediationEngine,
  ResolvedRemediationDef,
} from '../contracts/index.js';
import { DEFAULT_FAILING_CONCLUSIONS, DEFAULT_LOG_LIMITS, logPatternHits, phase1Matches, type LogPatternLimits } from './matcher.js';

/**
 * Two-phase, priority-ordered resolution (§7.4):
 * - Evaluates enabled defs in priority order against current signals
 *   (failing checks, merge conflict).
 * - Phase 1 is the structured predicate, no I/O; Phase 2 fetches logs once
 *   per run only when a matched def declares a logPattern.
 * - Returns ONE def-level decision per tick: N checks matching one def
 *   collapse into a single trigger (§7.5).
 * - Unmatched signals hit the default case → escalate. Nothing is silently
 *   dropped.
 */
export class DefaultRemediationEngine implements RemediationEngine {
  constructor(
    private readonly logs: LogSource,
    private readonly limits: LogPatternLimits = DEFAULT_LOG_LIMITS,
  ) {}

  async evaluate(record: PrRecord, snapshot: PrSnapshot, cfg: EffectiveConfig): Promise<RemediationDecision> {
    const conflict = snapshot.mergeable === 'conflicting';
    const failing = snapshot.checks.filter(
      (c) => c.conclusion !== null && DEFAULT_FAILING_CONCLUSIONS.includes(c.conclusion),
    );
    if (!conflict && failing.length === 0) return { kind: 'noop' };

    const logCache = new Map<string, string>();
    for (const def of cfg.remediations) {
      // Guardrail classes were already filtered by the resolver; re-check
      // defensively so a hand-built config can't sneak one through.
      if (cfg.guardrails.disabledRemediationClasses.includes(def.class)) continue;

      const signal = def.match.signal ?? 'checks';
      let matched = false;
      if (signal === 'conflict') {
        matched = conflict;
      } else {
        const phase1 = phase1Matches(def.match, snapshot.checks);
        if (phase1.length > 0) {
          matched = def.match.logPattern
            ? await this.phase2(def, snapshot, phase1.map((r) => r.runId), logCache)
            : true;
        }
      }
      if (!matched) continue;

      const attempts = record.remediation?.lastDefId === def.id ? record.remediation.attemptCount : 0;
      if (attempts >= def.maxAttempts) {
        return {
          kind: 'escalate',
          reason: `remediation '${def.id}' exhausted ${def.maxAttempts} attempt(s) without effect`,
        };
      }
      return { kind: 'response', defId: def.id, action: def.response };
    }

    const what = conflict
      ? 'merge conflict'
      : `failing check(s): ${failing.map((c) => c.name).join(', ')}`;
    return { kind: 'escalate', reason: `no remediation matched ${what}` };
  }

  private async phase2(
    def: ResolvedRemediationDef,
    snapshot: PrSnapshot,
    runIds: string[],
    cache: Map<string, string>,
  ): Promise<boolean> {
    for (const runId of runIds) {
      let log = cache.get(runId);
      if (log === undefined) {
        log = await this.logs.getJobLogs(snapshot.id, runId);
        cache.set(runId, log);
      }
      if (logPatternHits(def.match.logPattern!, log, this.limits)) return true;
    }
    return false;
  }
}
