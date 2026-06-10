/**
 * Hermetic adapter tests: GitHubCodeHost against a stubbed Octokit. These
 * verify the wire→domain mapping (the trust boundary) without any network;
 * contract.test.ts re-checks a subset against the real API when enabled.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { GitHubCodeHost } from '../src/codehost.js';

const SHA = 'a'.repeat(40);

function pullFixture(patch: Record<string, unknown> = {}) {
  return {
    number: 42,
    state: 'open',
    merged: false,
    merged_at: null,
    draft: false,
    labels: [{ name: 'auto-shepherd', color: 'red' }],
    user: { login: 'octocat', id: 1 },
    mergeable: true,
    mergeable_state: 'clean',
    base: { ref: 'main', repo: { full_name: 'acme/web' } },
    head: { ref: 'feature', sha: SHA },
    updated_at: '2026-01-05T12:00:00Z',
    title: 'unknown fields pass through forward-compatibly',
    ...patch,
  };
}

function checksFixture(runs: Array<Record<string, unknown>> = []) {
  return { total_count: runs.length, check_runs: runs };
}

interface StubConfig {
  pull?: Record<string, unknown> | (() => Record<string, unknown>);
  pullError?: { status: number; message?: string };
  checks?: Record<string, unknown>;
  mergeError?: { status: number; message?: string };
  list?: Array<{ data: unknown[]; etag?: string } | { status304: true }>;
  jobLogs?: string | { status: number };
}

function stubOctokit(cfg: StubConfig = {}) {
  let listCall = 0;
  const calls = {
    listHeaders: [] as Array<Record<string, string>>,
    merge: vi.fn(async () => ({ data: { merged: true } })),
    updateBranch: vi.fn(async () => ({ data: {} })),
    createComment: vi.fn(async () => ({ data: {} })),
    rerequestRun: vi.fn(async () => ({ data: {} })),
  };
  const octokit = {
    request: async (route: string, params: Record<string, unknown>) => {
      if (route.includes('/pulls')) {
        const step = cfg.list?.[listCall++] ?? { data: [] };
        calls.listHeaders.push((params['headers'] as Record<string, string>) ?? {});
        if ('status304' in step) throw Object.assign(new Error('Not Modified'), { status: 304 });
        return { data: step.data, headers: { etag: step.etag } };
      }
      if (route.includes('/logs')) {
        if (typeof cfg.jobLogs === 'object' && cfg.jobLogs !== null && 'status' in cfg.jobLogs) {
          throw Object.assign(new Error('no logs'), { status: cfg.jobLogs.status });
        }
        return { data: cfg.jobLogs ?? '' };
      }
      throw new Error(`unexpected route: ${route}`);
    },
    pulls: {
      get: vi.fn(async () => {
        if (cfg.pullError) throw Object.assign(new Error(cfg.pullError.message ?? 'err'), { status: cfg.pullError.status });
        const pull = typeof cfg.pull === 'function' ? cfg.pull() : (cfg.pull ?? pullFixture());
        return { data: pull };
      }),
      merge: vi.fn(async () => {
        if (cfg.mergeError) throw Object.assign(new Error(cfg.mergeError.message ?? 'err'), { status: cfg.mergeError.status });
        return { data: { merged: true } };
      }),
      updateBranch: calls.updateBranch,
    },
    checks: {
      listForRef: vi.fn(async () => ({ data: cfg.checks ?? checksFixture() })),
      rerequestRun: calls.rerequestRun,
    },
    issues: { createComment: calls.createComment },
  };
  return { octokit: octokit as unknown as Octokit, calls, raw: octokit };
}

const PR = 'github:acme/web#42';

describe('getPr — snapshot mapping', () => {
  it('maps an open PR with checks onto the normalized snapshot', async () => {
    const { octokit } = stubOctokit({
      checks: checksFixture([
        { id: 101, name: 'lint', conclusion: 'failure', completed_at: '2026-01-05T11:00:00Z', app: { slug: 'gha' } },
        { id: 102, name: 'e2e', conclusion: null, completed_at: null },
        { id: 103, name: 'optional', conclusion: 'skipped', completed_at: '2026-01-05T11:00:00Z' },
      ]),
    });
    const snapshot = await new GitHubCodeHost(octokit).getPr(PR);
    expect(snapshot).toMatchObject({
      id: PR,
      repo: 'acme/web',
      number: 42,
      author: 'octocat',
      isDraft: false,
      labels: ['auto-shepherd'],
      state: 'open',
      mergeable: 'mergeable',
      behindBase: false,
      baseRef: 'main',
      headRef: 'feature',
      headSha: SHA,
    });
    expect(snapshot!.lastActivityAt.toISOString()).toBe('2026-01-05T12:00:00.000Z');
    expect(snapshot!.checks).toEqual([
      { name: 'lint', jobName: 'lint', conclusion: 'failure', completedAt: new Date('2026-01-05T11:00:00Z'), runId: '101' },
      { name: 'e2e', jobName: 'e2e', conclusion: null, completedAt: null, runId: '102' },
      // GitHub-only conclusions collapse to neutral
      { name: 'optional', jobName: 'optional', conclusion: 'neutral', completedAt: new Date('2026-01-05T11:00:00Z'), runId: '103' },
    ]);
  });

  it.each([
    [{ mergeable: true }, 'mergeable'],
    [{ mergeable: false }, 'conflicting'],
    [{ mergeable: null }, 'unknown'],
  ] as const)("maps GitHub's verdict %j → %s", async (patch, expected) => {
    const { octokit } = stubOctokit({ pull: pullFixture(patch) });
    expect((await new GitHubCodeHost(octokit).getPr(PR))!.mergeable).toBe(expected);
  });

  it("maps mergeable_state 'behind' → behindBase", async () => {
    const { octokit } = stubOctokit({ pull: pullFixture({ mergeable_state: 'behind' }) });
    expect((await new GitHubCodeHost(octokit).getPr(PR))!.behindBase).toBe(true);
  });

  it('distinguishes externally-merged from closed-unmerged', async () => {
    const merged = stubOctokit({
      pull: pullFixture({ state: 'closed', merged: true, merged_at: '2026-01-05T13:00:00Z' }),
    });
    expect((await new GitHubCodeHost(merged.octokit).getPr(PR))!.state).toBe('merged');

    const closed = stubOctokit({ pull: pullFixture({ state: 'closed' }) });
    expect((await new GitHubCodeHost(closed.octokit).getPr(PR))!.state).toBe('closed');
  });

  it('maps drafts and a null user', async () => {
    const { octokit } = stubOctokit({ pull: pullFixture({ draft: true, user: null }) });
    const snapshot = await new GitHubCodeHost(octokit).getPr(PR);
    expect(snapshot!.isDraft).toBe(true);
    expect(snapshot!.author).toBe('unknown');
  });

  it('returns null on 404 (PR gone)', async () => {
    const { octokit } = stubOctokit({ pullError: { status: 404 } });
    expect(await new GitHubCodeHost(octokit).getPr(PR)).toBeNull();
  });

  it('propagates non-404 errors (rate limits must hit the loop backoff)', async () => {
    const { octokit } = stubOctokit({ pullError: { status: 403, message: 'API rate limit exceeded' } });
    await expect(new GitHubCodeHost(octokit).getPr(PR)).rejects.toThrow(/rate limit/);
  });

  it('rejects malformed wire payloads at the boundary instead of propagating junk', async () => {
    const { octokit } = stubOctokit({ pull: { number: 'forty-two' } });
    await expect(new GitHubCodeHost(octokit).getPr(PR)).rejects.toThrow();
  });

  it('rejects non-github PrIds', async () => {
    const { octokit } = stubOctokit();
    await expect(new GitHubCodeHost(octokit).getPr('gitlab:acme/web#1')).rejects.toThrow(/not a github PrId/);
  });
});

describe('listOpenPrs — ETag conditional requests', () => {
  it('sends If-None-Match on the second sweep and replays the cache on 304', async () => {
    const { octokit, calls } = stubOctokit({
      list: [{ data: [{ number: 42, title: 'x' }], etag: 'W/"abc"' }, { status304: true }],
    });
    const host = new GitHubCodeHost(octokit);

    const first = [];
    for await (const s of host.listOpenPrs({ repos: ['acme/web'] })) first.push(s);
    expect(first.map((s) => s.number)).toEqual([42]);

    const second = [];
    for await (const s of host.listOpenPrs({ repos: ['acme/web'] })) second.push(s);
    expect(second.map((s) => s.number)).toEqual([42]); // replayed from cache

    expect(calls.listHeaders[0]).toEqual({});
    expect(calls.listHeaders[1]).toEqual({ 'if-none-match': 'W/"abc"' });
  });

  it('filters out PRs that closed between the list and the detail fetch', async () => {
    const { octokit } = stubOctokit({
      list: [{ data: [{ number: 42 }], etag: 'W/"x"' }],
      pull: pullFixture({ state: 'closed' }),
    });
    const seen = [];
    for await (const s of new GitHubCodeHost(octokit).listOpenPrs({ repos: ['acme/web'] })) seen.push(s);
    expect(seen).toEqual([]);
  });
});

describe('merge — idempotent against the host', () => {
  it('merges and reports merged', async () => {
    const { octokit } = stubOctokit();
    expect(await new GitHubCodeHost(octokit).merge(PR, 'merge:k')).toEqual({ result: 'merged' });
  });

  it('treats 405-but-already-merged as success (replayed merge)', async () => {
    const { octokit } = stubOctokit({
      mergeError: { status: 405, message: 'Pull Request is not mergeable' },
      pull: pullFixture({ state: 'closed', merged: true, merged_at: '2026-01-05T13:00:00Z' }),
    });
    expect(await new GitHubCodeHost(octokit).merge(PR, 'merge:k')).toEqual({ result: 'merged' });
  });

  it('surfaces a real 405 as a failed outcome with the host reason', async () => {
    const { octokit } = stubOctokit({
      mergeError: { status: 405, message: 'required status checks have not passed' },
    });
    const outcome = await new GitHubCodeHost(octokit).merge(PR, 'merge:k');
    expect(outcome).toEqual({ result: 'failed', reason: 'required status checks have not passed' });
  });

  it('propagates unexpected merge errors', async () => {
    const { octokit } = stubOctokit({ mergeError: { status: 500, message: 'boom' } });
    await expect(new GitHubCodeHost(octokit).merge(PR, 'merge:k')).rejects.toThrow('boom');
  });
});

describe('retryChecks', () => {
  it('re-requests each run and tolerates not-re-runnable checks', async () => {
    const { octokit, calls } = stubOctokit();
    calls.rerequestRun
      .mockRejectedValueOnce(Object.assign(new Error('cannot rerequest'), { status: 422 }))
      .mockResolvedValue({ data: {} });
    await new GitHubCodeHost(octokit).retryChecks(PR, ['101', '102'], 'rem:k');
    expect(calls.rerequestRun).toHaveBeenCalledTimes(2);
  });

  it('propagates unexpected rerequest errors', async () => {
    const { octokit, calls } = stubOctokit();
    calls.rerequestRun.mockRejectedValue(Object.assign(new Error('server fire'), { status: 500 }));
    await expect(new GitHubCodeHost(octokit).retryChecks(PR, ['101'], 'rem:k')).rejects.toThrow('server fire');
  });
});

describe('getJobLogs', () => {
  it('returns the log tail bounded to maxLogBytes', async () => {
    const { octokit } = stubOctokit({ jobLogs: 'HEAD-' + 'x'.repeat(100) + '-TAIL' });
    const host = new GitHubCodeHost(octokit, 9);
    expect(await host.getJobLogs(PR, '101')).toBe('xxxx-TAIL');
  });

  it('returns empty for non-Actions checks instead of failing the match', async () => {
    const { octokit } = stubOctokit({ jobLogs: { status: 404 } });
    expect(await new GitHubCodeHost(octokit).getJobLogs(PR, '999')).toBe('');
  });
});

describe('writes carry the right coordinates', () => {
  it('updateBranch and postComment target owner/repo/number from the PrId', async () => {
    const { octokit, calls } = stubOctokit();
    const host = new GitHubCodeHost(octokit);
    await host.updateBranch(PR, 'ub:k');
    await host.postComment(PR, 'hello');
    expect(calls.updateBranch).toHaveBeenCalledWith({ owner: 'acme', repo: 'web', pull_number: 42 });
    expect(calls.createComment).toHaveBeenCalledWith({ owner: 'acme', repo: 'web', issue_number: 42, body: 'hello' });
  });
});
