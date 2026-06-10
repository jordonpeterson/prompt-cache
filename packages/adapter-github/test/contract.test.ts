/**
 * Contract test (§13 layer 3): the same observable behavior is asserted
 * against the real GitHub API when credentials are provided. Keeps the
 * testkit fake honest. Read-only by design.
 *
 * Run with: GITHUB_CONTRACT=1 GITHUB_TOKEN=... GITHUB_CONTRACT_REPO=owner/repo \
 *           GITHUB_CONTRACT_PR=123 vitest run packages/adapter-github
 */
import { describe, expect, it } from 'vitest';
import { makePrId } from '@shepherd/core';
import { GitHubCodeHost, createOctokit } from '../src/codehost.js';

const enabled =
  process.env['GITHUB_CONTRACT'] === '1' &&
  !!process.env['GITHUB_TOKEN'] &&
  !!process.env['GITHUB_CONTRACT_REPO'] &&
  !!process.env['GITHUB_CONTRACT_PR'];

describe.runIf(enabled)('GitHubCodeHost against the real API', () => {
  const repo = process.env['GITHUB_CONTRACT_REPO']!;
  const prNumber = Number(process.env['GITHUB_CONTRACT_PR']!);
  const host = new GitHubCodeHost(createOctokit({ token: process.env['GITHUB_TOKEN'] }));

  it('getPr returns a normalized snapshot for a known PR', async () => {
    const snapshot = await host.getPr(makePrId('github', repo, prNumber));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.repo).toBe(repo);
    expect(snapshot!.number).toBe(prNumber);
    expect(snapshot!.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(['open', 'closed', 'merged']).toContain(snapshot!.state);
    expect(['mergeable', 'conflicting', 'unknown']).toContain(snapshot!.mergeable);
  });

  it('getPr returns null for a nonexistent PR (matching the fake)', async () => {
    expect(await host.getPr(makePrId('github', repo, 99_999_999))).toBeNull();
  });

  it('listOpenPrs yields only open PRs and tolerates a second (ETag-cached) sweep', async () => {
    for (let sweep = 0; sweep < 2; sweep++) {
      for await (const snapshot of host.listOpenPrs({ repos: [repo] })) {
        expect(snapshot.state).toBe('open');
      }
    }
  });
});

describe.runIf(!enabled)('GitHubCodeHost contract (skipped)', () => {
  it('set GITHUB_CONTRACT=1 + GITHUB_TOKEN + GITHUB_CONTRACT_REPO/PR to run', () => {
    expect(true).toBe(true);
  });
});
