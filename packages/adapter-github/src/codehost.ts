import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { z } from 'zod';
import type {
  CheckConclusion,
  CheckRun,
  CodeHostPort,
  IdemKey,
  MergeOutcome,
  PollWindow,
  PrId,
  PrSnapshot,
} from '@shepherd/core';
import { makePrId } from '@shepherd/core';

/**
 * Zod at the wire (§8): third-party payloads parse forward-compatibly —
 * unknown fields pass through, we validate only what we consume.
 */
const pullSchema = z
  .object({
    number: z.number(),
    state: z.enum(['open', 'closed']),
    merged: z.boolean().optional(),
    merged_at: z.string().nullable().optional(),
    draft: z.boolean().optional(),
    labels: z.array(z.object({ name: z.string() }).passthrough()),
    user: z.object({ login: z.string() }).passthrough().nullable(),
    mergeable: z.boolean().nullable().optional(),
    mergeable_state: z.string().optional(),
    base: z.object({ ref: z.string() }).passthrough(),
    head: z.object({ ref: z.string(), sha: z.string() }).passthrough(),
    updated_at: z.string(),
  })
  .passthrough();

const checkRunsSchema = z
  .object({
    check_runs: z.array(
      z
        .object({
          id: z.number(),
          name: z.string(),
          conclusion: z.string().nullable(),
          completed_at: z.string().nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const listItemSchema = z.object({ number: z.number() }).passthrough();

const CONCLUSION_MAP: Record<string, CheckConclusion> = {
  failure: 'failure',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
  action_required: 'action_required',
  neutral: 'neutral',
  success: 'success',
  skipped: 'neutral',
  stale: 'neutral',
};

export interface GitHubAuthConfig {
  /** Personal/installation token — local dev. */
  token?: string;
  /** GitHub App (preferred): per-installation tokens, higher limits (§12). */
  app?: { appId: string; privateKey: string; installationId: number };
}

export function createOctokit(auth: GitHubAuthConfig): Octokit {
  if (auth.app) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: auth.app.appId,
        privateKey: auth.app.privateKey,
        installationId: auth.app.installationId,
      },
    });
  }
  return new Octokit({ auth: auth.token });
}

interface ListCache {
  etag: string;
  numbers: number[];
}

export class GitHubCodeHost implements CodeHostPort {
  private listCache = new Map<string, ListCache>();

  constructor(
    private readonly octokit: Octokit,
    private readonly maxLogBytes = 256 * 1024,
  ) {}

  private split(id: PrId): { owner: string; repo: string; number: number } {
    const m = /^github:([^/]+)\/([^#]+)#(\d+)$/.exec(id);
    if (!m) throw new Error(`not a github PrId: ${id}`);
    return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
  }

  /**
   * ETag conditional requests on the cheap list call (304s are free, §12);
   * full snapshots are then fetched per PR. A 304 replays the cached PR
   * numbers so the sweep still sees a stable set without burning quota.
   */
  async *listOpenPrs(window: PollWindow): AsyncIterable<PrSnapshot> {
    for (const fullRepo of window.repos) {
      const [owner, repo] = fullRepo.split('/') as [string, string];
      const cached = this.listCache.get(fullRepo);
      let numbers: number[];
      try {
        const res = await this.octokit.request('GET /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          state: 'open',
          per_page: 100,
          headers: cached ? { 'if-none-match': cached.etag } : {},
        });
        numbers = z.array(listItemSchema).parse(res.data).map((p) => p.number);
        const etag = res.headers.etag;
        if (etag) this.listCache.set(fullRepo, { etag, numbers });
      } catch (err) {
        if (isStatus(err, 304) && cached) numbers = cached.numbers;
        else throw err;
      }
      for (const number of numbers) {
        const snapshot = await this.getPr(makePrId('github', fullRepo, number));
        if (snapshot && snapshot.state === 'open') yield snapshot;
      }
    }
  }

  async getPr(id: PrId): Promise<PrSnapshot | null> {
    const { owner, repo, number } = this.split(id);
    let data: unknown;
    try {
      ({ data } = await this.octokit.pulls.get({ owner, repo, pull_number: number }));
    } catch (err) {
      if (isStatus(err, 404)) return null;
      throw err;
    }
    const pull = pullSchema.parse(data);
    const checks = await this.getChecks(owner, repo, pull.head.sha);
    const merged = pull.merged === true || pull.merged_at != null;
    return {
      id,
      repo: `${owner}/${repo}`,
      number,
      author: pull.user?.login ?? 'unknown',
      isDraft: pull.draft ?? false,
      labels: pull.labels.map((l) => l.name),
      state: merged ? 'merged' : pull.state === 'closed' ? 'closed' : 'open',
      mergeable:
        pull.mergeable === true ? 'mergeable' : pull.mergeable === false ? 'conflicting' : 'unknown',
      behindBase: pull.mergeable_state === 'behind',
      checks,
      baseRef: pull.base.ref,
      headRef: pull.head.ref,
      headSha: pull.head.sha,
      lastActivityAt: new Date(pull.updated_at),
    };
  }

  private async getChecks(owner: string, repo: string, ref: string): Promise<CheckRun[]> {
    const { data } = await this.octokit.checks.listForRef({ owner, repo, ref, per_page: 100 });
    const parsed = checkRunsSchema.parse(data);
    return parsed.check_runs.map((run) => ({
      name: run.name,
      jobName: run.name,
      conclusion: run.conclusion == null ? null : (CONCLUSION_MAP[run.conclusion] ?? 'neutral'),
      completedAt: run.completed_at ? new Date(run.completed_at) : null,
      runId: String(run.id),
    }));
  }

  async updateBranch(id: PrId, _idem: IdemKey): Promise<void> {
    const { owner, repo, number } = this.split(id);
    await this.octokit.pulls.updateBranch({ owner, repo, pull_number: number });
  }

  /** Idempotent: an already-merged PR reports success instead of erroring. */
  async merge(id: PrId, _idem: IdemKey): Promise<MergeOutcome> {
    const { owner, repo, number } = this.split(id);
    try {
      await this.octokit.pulls.merge({ owner, repo, pull_number: number });
      return { result: 'merged' };
    } catch (err) {
      if (isStatus(err, 405) || isStatus(err, 409)) {
        const current = await this.getPr(id);
        if (current?.state === 'merged') return { result: 'merged' };
        return { result: 'failed', reason: errMessage(err) };
      }
      throw err;
    }
  }

  async postComment(id: PrId, body: string): Promise<void> {
    const { owner, repo, number } = this.split(id);
    await this.octokit.issues.createComment({ owner, repo, issue_number: number, body });
  }

  async retryChecks(id: PrId, runIds: string[], _idem: IdemKey): Promise<void> {
    const { owner, repo } = this.split(id);
    for (const runId of runIds) {
      try {
        await this.octokit.checks.rerequestRun({ owner, repo, check_run_id: Number(runId) });
      } catch (err) {
        if (!isStatus(err, 403) && !isStatus(err, 422)) throw err; // not re-runnable — skip
      }
    }
  }

  /** Best-effort: Actions check-run ids double as job ids; non-Actions checks yield ''. */
  async getJobLogs(id: PrId, runId: string): Promise<string> {
    const { owner, repo } = this.split(id);
    try {
      const res = await this.octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
        owner,
        repo,
        job_id: Number(runId),
      });
      const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      return text.length > this.maxLogBytes ? text.slice(-this.maxLogBytes) : text;
    } catch {
      return '';
    }
  }
}

function isStatus(err: unknown, status: number): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === status;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
