import type { PrId } from './ids.js';

export type CheckConclusion =
  | 'failure'
  | 'timed_out'
  | 'cancelled'
  | 'action_required'
  | 'neutral'
  | 'success';

export interface CheckRun {
  name: string;
  jobName?: string;
  /** null ⇒ still running / queued */
  conclusion: CheckConclusion | null;
  completedAt: Date | null;
  runId: string;
}

/**
 * Normalized code-host view of a PR.
 *
 * Deviations from the design doc (documented in README §Deviations):
 * - `state`: needed to distinguish externally-merged from closed-unmerged —
 *   `listOpenPrs` excludes both, but reconcile must terminalize correctly.
 * - `behindBase`: MergeDecision includes 'update_branch'; the policy cannot
 *   emit it without knowing the head is behind the base.
 */
export interface PrSnapshot {
  id: PrId;
  repo: string;
  number: number;
  author: string;
  isDraft: boolean;
  labels: string[];
  state: 'open' | 'closed' | 'merged';
  /** GitHub's own verdict — the hard gate. */
  mergeable: 'mergeable' | 'conflicting' | 'unknown';
  behindBase: boolean;
  checks: CheckRun[];
  baseRef: string;
  headRef: string;
  headSha: string;
  /** staleness clock */
  lastActivityAt: Date;
}

export interface PollWindow {
  repos: string[];
}
