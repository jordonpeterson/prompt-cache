import type { CheckConclusion, CheckRun, MatchPredicate } from '../contracts/index.js';

export const DEFAULT_FAILING_CONCLUSIONS: CheckConclusion[] = ['failure', 'timed_out'];

/** Exact-or-glob: `*` is the only metacharacter; everything else is literal. */
export function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '*' ? '.*' : `\\${ch}`));
  return new RegExp(`^${escaped}$`).test(value);
}

/** Phase 1 — cheap, structured, no I/O. Returns the check runs the predicate selects. */
export function phase1Matches(predicate: MatchPredicate, checks: CheckRun[]): CheckRun[] {
  const conclusions = predicate.conclusion ?? DEFAULT_FAILING_CONCLUSIONS;
  return checks.filter((run) => {
    if (run.conclusion === null) return false;
    if (!conclusions.includes(run.conclusion)) return false;
    if (predicate.check && !globMatch(predicate.check, run.name)) return false;
    if (predicate.job && !globMatch(predicate.job, run.jobName ?? '')) return false;
    return true;
  });
}

export interface LogPatternLimits {
  /** Logs are truncated to this many bytes before matching (ReDoS/size guard). */
  maxLogBytes: number;
  maxPatternLength: number;
}

export const DEFAULT_LOG_LIMITS: LogPatternLimits = {
  maxLogBytes: 256 * 1024,
  maxPatternLength: 512,
};

const REGEX_META = /[\\^$.|?*+()[\]{}]/;

/**
 * Phase 2 — patterns SELECT, they do not parse/extract. Literal substrings are
 * preferred and detected automatically (no regex metacharacters); regex is
 * allowed but size-bounded. Invalid regex ⇒ no match (fails closed into the
 * escalate default rather than acting on a bad rule).
 */
export function logPatternHits(pattern: string, log: string, limits: LogPatternLimits = DEFAULT_LOG_LIMITS): boolean {
  if (pattern.length > limits.maxPatternLength) return false;
  const bounded = log.length > limits.maxLogBytes ? log.slice(-limits.maxLogBytes) : log;
  if (!REGEX_META.test(pattern)) return bounded.includes(pattern);
  try {
    return new RegExp(pattern).test(bounded);
  } catch {
    return false;
  }
}
