import type { IdemKey, PrId } from './ids.js';
import type { PollWindow, PrSnapshot } from './snapshot.js';

export type MergeOutcome =
  | { result: 'merged' }
  | { result: 'failed'; reason: string };

export interface CodeHostPort {
  /** ETag/conditional requests handled internally by the adapter. */
  listOpenPrs(window: PollWindow): AsyncIterable<PrSnapshot>;
  getPr(id: PrId): Promise<PrSnapshot | null>;
  updateBranch(id: PrId, idem: IdemKey): Promise<void>;
  /** GitHub-gated; idempotent. */
  merge(id: PrId, idem: IdemKey): Promise<MergeOutcome>;
  postComment(id: PrId, body: string): Promise<void>;
  /** Re-run failed check runs. Extension to the doc's port — needed by the
   * 'retry_checks' response kind (README §Deviations). */
  retryChecks(id: PrId, runIds: string[], idem: IdemKey): Promise<void>;
  /** Phase-2 matching only; bounded size. */
  getJobLogs(id: PrId, runId: string): Promise<string>;
}

/** The subset of CodeHostPort the remediation engine needs for Phase-2 matching. */
export type LogSource = Pick<CodeHostPort, 'getJobLogs'>;

export interface RemediationTrigger {
  /** rem:{prId}:{headSha}:{defId}:{attempt} — SERVER MUST DEDUPE on this. */
  idempotencyKey: IdemKey;
  /** What to run, e.g. "eslint-autofix" — vocabulary shared with the service. */
  task: string;
  /** headSha: base + no-op-if-moved. */
  target: { repo: string; prNumber: number; headRef: string; headSha: string };
  /** Optional scope hint; logs stay OUT (server fetches its own). */
  context?: { failingJobs?: string[] };
}

/** NO completion poll — fire-and-wait (§6). Sync ack only; never polled after. */
export interface RemediationServicePort {
  trigger(req: RemediationTrigger): Promise<{ result: 'accepted' | 'declined'; reason?: string }>;
}

/** Injected everywhere; no Date.now() in core. */
export interface ClockPort {
  now(): Date;
}
