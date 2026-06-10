import type { CheckConclusion } from './snapshot.js';
import type { PrId } from './ids.js';

export type RemediationClass = 'mechanical' | 'conflict';

/**
 * Declarative DATA — only selects; cannot act (§7.1).
 * Phase 1 (check/job/conclusion) is cheap and I/O-free. Phase 2 (logPattern)
 * is only evaluated if Phase 1 matched AND a logPattern is declared.
 * Patterns SELECT, they do not parse/extract.
 *
 * `signal` is an extension to the doc's predicate: a merge conflict is not a
 * check, but conflict-class defs must be able to match it (README §Deviations).
 */
export interface MatchPredicate {
  /** What this predicate inspects. Default: 'checks'. */
  signal?: 'checks' | 'conflict';
  /** exact or glob, e.g. "lint" / "build:*" */
  check?: string;
  /** CI job name (exact or glob) */
  job?: string;
  /** e.g. ['failure','timed_out']; default ['failure','timed_out'] */
  conclusion?: CheckConclusion[];
  /** Prefer literal/substring; regex allowed but size+time bounded (ReDoS guard). */
  logPattern?: string;
}

export type ResponseAction =
  | { kind: 'retry_checks' }
  | { kind: 'update_branch' }
  /** task = vocabulary shared with the remediation service */
  | { kind: 'external'; task: string };

export interface RemediationDef {
  /** OUR identity — e.g. "eslint-autofix"; referenced by config, precedence, reports. */
  id: string;
  description: string;
  /** Safety tier; behavior-changing work never gets a def. */
  class: RemediationClass;
  match: MatchPredicate;
  /** Points at a CODE-registered action; config can NEVER invent one. */
  response: ResponseAction;
  /** Precedence in the case statement (lower = evaluated first). */
  priority: number;
  /** Max-wait-for-effect — the `c` of fire-and-wait (§6). */
  cooldownSeconds: number;
  /** Bounded retries → escalate on cap. */
  maxAttempts: number;
}

export type ConfigLayer = 'default' | 'org' | 'user' | 'pr';

/** Most-specific-wins fields (§10 rule 1). Each layer stores only its overrides. */
export interface Preferences {
  /** Def ids enabled for remediation. */
  enabledRemediations?: string[];
  /** Per-def tuning of cooldown/attempts — params, never behavior. */
  remediationOverrides?: Record<string, { cooldownSeconds?: number; maxAttempts?: number }>;
  /** What to do when a PR goes green and no end-action was stamped. */
  endActionDefault?: 'merge' | 'notify_ready';
  /** Keep heads up to date with base via update-branch. */
  keepBranchUpToDate?: boolean;
  notifyQuietSeconds?: number;
  notifyHardCapSeconds?: number;
  /** Inactivity horizon before the PR is escalated as stale. */
  staleEscalateAfterDays?: number;
}

/** Org-locked / most-restrictive-wins fields (§10 rule 2). */
export interface Guardrails {
  /** Hard-disable a remediation class regardless of lower layers. */
  disabledRemediationClasses?: RemediationClass[];
  /** Once false at any layer, false. */
  autoMergeAllowed?: boolean;
}

export interface ConfigLayerInput {
  layer: ConfigLayer;
  preferences?: Preferences;
  guardrails?: Guardrails;
}

/** A def with layer overrides already applied. */
export type ResolvedRemediationDef = RemediationDef;

export interface EffectiveConfig {
  /** Enabled defs, overrides applied, sorted by priority asc. */
  remediations: ResolvedRemediationDef[];
  guardrails: {
    disabledRemediationClasses: RemediationClass[];
    autoMergeAllowed: boolean;
  };
  endActionDefault: 'merge' | 'notify_ready';
  keepBranchUpToDate: boolean;
  notifications: { quietSeconds: number; hardCapSeconds: number };
  staleness: { escalateAfterDays: number };
}

export interface ConfigProvenance {
  [field: string]: { value: unknown; source: ConfigLayer };
}

/**
 * Cascade + two merge rules (§10). `perPr` is the most-specific layer, derived
 * from the PR record (trigger-time overrides) and passed in by the caller —
 * resolution itself is pure/sync (README §Deviations).
 */
export interface ConfigResolver {
  resolve(prId: PrId, perPr?: Preferences): EffectiveConfig;
  /** Provenance, per-PR: value + source layer per field. */
  explain(prId: PrId, perPr?: Preferences): ConfigProvenance;
}
