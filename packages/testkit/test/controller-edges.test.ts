import { describe, expect, it } from 'vitest';
import { mergeKey, type ConfigLayerInput, type RemediationDef } from '@shepherd/core';
import { buildWorld, makeSnapshot, TEST_CATALOG } from '../src/world.js';

const PR = 'github:acme/web#42';

function checks(spec: Record<string, 'failure' | 'success' | 'timed_out' | 'pending'>) {
  return Object.entries(spec).map(([name, c]) => ({
    name,
    jobName: name,
    conclusion: c === 'pending' ? null : c,
    completedAt: c === 'pending' ? null : new Date(0),
    runId: `${name}-run`,
  }));
}

async function setup(
  world: ReturnType<typeof buildWorld>,
  opts: {
    id?: string;
    checks?: ReturnType<typeof checks>;
    endAction?: 'merge' | 'notify_ready';
    overrides?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
  } = {},
) {
  const id = opts.id ?? PR;
  const number = Number(id.split('#')[1]);
  world.codeHost.setPr(
    makeSnapshot({
      id, repo: 'acme/web', number,
      checks: opts.checks ?? [],
      lastActivityAt: world.clock.now(),
      ...(opts.snapshot as object),
    }),
  );
  const snap = (await world.codeHost.getPr(id))!;
  await world.ingestion.ingest(snap, {
    source: 'api',
    endAction: { kind: opts.endAction ?? 'merge' },
    overrides: opts.overrides,
  });
}

describe('scheduling (§11 tiered cadence)', () => {
  it('awaiting_checks wakes on the ~30s tier with zero jitter when random()=0.5', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'pending' }) });
    const t0 = world.clock.now().getTime();
    await world.controller.tick(world.clock.now());
    const record = (await world.prs.get(PR))!;
    expect(record.nextReconcileAt.getTime() - t0).toBe(30_000);
  });

  it('applies ±10% jitter from the injected randomness source', async () => {
    const world = buildWorld({ controller: { random: () => 1 } }); // max jitter: +10%
    await setup(world, { checks: checks({ lint: 'pending' }) });
    const t0 = world.clock.now().getTime();
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.nextReconcileAt.getTime() - t0).toBe(33_000);
  });

  it('awaiting_remediation wakes at min(cooldownUntil, cadence tier)', async () => {
    const world = buildWorld(); // eslint-autofix cooldown 120s, tier 20s
    await setup(world, { checks: checks({ lint: 'failure' }) });
    const t0 = world.clock.now().getTime();
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.nextReconcileAt.getTime() - t0).toBe(20_000);

    // 110s in: the remaining cooldown (10s) is shorter than the tier.
    world.clock.advanceSeconds(110);
    await world.controller.tick(world.clock.now());
    const record = (await world.prs.get(PR))!;
    expect(record.nextReconcileAt.getTime()).toBe(t0 + 120_000);
  });

  it('escalated PRs back off to the slow tier', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ 'unmatched-check': 'failure' }) });
    const t0 = world.clock.now().getTime();
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('escalated');
    expect((await world.prs.get(PR))!.nextReconcileAt.getTime() - t0).toBe(3_600_000);
  });
});

describe('claiming', () => {
  it('honors the claim limit and catches up on later ticks', async () => {
    const world = buildWorld({ controller: { claimLimit: 1 } });
    await setup(world, { id: 'github:acme/web#1', checks: checks({ lint: 'success' }) });
    await setup(world, { id: 'github:acme/web#2', checks: checks({ lint: 'success' }) });

    const first = await world.controller.tick(world.clock.now());
    expect(first.claimed).toBe(1);
    const second = await world.controller.tick(world.clock.now());
    expect(second.claimed).toBe(1);
    expect(world.codeHost.merges).toHaveLength(2);
  });

  it('reconciles many PRs independently in one tick', async () => {
    const world = buildWorld();
    await setup(world, { id: 'github:acme/web#1', checks: checks({ lint: 'success' }) });
    await setup(world, { id: 'github:acme/web#2', checks: checks({ lint: 'failure' }) });
    await setup(world, { id: 'github:acme/web#3', checks: checks({ 'unmatched-check': 'failure' }) });

    const report = await world.controller.tick(world.clock.now());
    expect(report.claimed).toBe(3);
    expect((await world.prs.get('github:acme/web#1'))!.lifecycleState).toBe('merged');
    expect((await world.prs.get('github:acme/web#2'))!.lifecycleState).toBe('awaiting_remediation');
    expect((await world.prs.get('github:acme/web#3'))!.lifecycleState).toBe('escalated');
  });

  it('a PR that vanishes from the host terminalizes as abandoned', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'pending' }) });
    await world.controller.tick(world.clock.now());
    world.codeHost.removePr(PR);
    world.clock.advanceSeconds(60);
    await world.controller.tick(world.clock.now());
    const record = (await world.prs.get(PR))!;
    expect(record.lifecycleState).toBe('abandoned');
    expect(record.terminalAt).not.toBeNull();
  });
});

describe('guardrails and overrides through the full loop', () => {
  it('org autoMergeAllowed=false turns an end-action merge into notify_ready', async () => {
    const layers: ConfigLayerInput[] = [
      { layer: 'default', preferences: { enabledRemediations: [], endActionDefault: 'merge' } },
      { layer: 'org', guardrails: { autoMergeAllowed: false } },
    ];
    const world = buildWorld({ layers });
    await setup(world, { checks: checks({ lint: 'success' }), endAction: 'merge' });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('ready');
    expect(world.codeHost.merges).toHaveLength(0);
    expect(world.notifier.events).toContainEqual({ kind: 'ready', prId: PR });
  });

  it('an org-disabled conflict class escalates conflicts instead of remediating', async () => {
    const layers: ConfigLayerInput[] = [
      { layer: 'default', preferences: { enabledRemediations: ['conflict-rebase'], endActionDefault: 'merge' } },
      { layer: 'org', guardrails: { disabledRemediationClasses: ['conflict'] } },
    ];
    const world = buildWorld({ layers });
    await setup(world, { snapshot: { mergeable: 'conflicting' } });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('escalated');
    expect(world.remediationService.triggers).toHaveLength(0);
  });

  it('per-PR trigger-time overrides reach the resolver (tighter staleness)', async () => {
    const world = buildWorld();
    await setup(world, {
      checks: checks({ lint: 'pending' }),
      overrides: { staleEscalateAfterDays: 1 },
    });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('awaiting_checks');

    world.clock.advanceSeconds(2 * 24 * 3600); // 2 days: stale under the override, fresh under the 30d default
    const record = (await world.prs.get(PR))!;
    await world.prs.upsert({ ...record, nextReconcileAt: world.clock.now() });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('escalated');
    expect((await world.prs.get(PR))!.escalation!.reason).toContain('stale');
  });
});

describe('idempotency replay paths', () => {
  it('a pre-reserved merge key suppresses the merge call (crash-after-commit replay)', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }) });
    await world.idempotency.reserve(mergeKey(PR, 'abc123'));
    await world.controller.tick(world.clock.now());
    expect(world.codeHost.merges).toHaveLength(0);
    expect((await world.prs.get(PR))!.lifecycleState).toBe('merging');
  });

  it('a new head sha legitimately re-arms the merge key', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }) });
    await world.idempotency.reserve(mergeKey(PR, 'abc123'));
    await world.controller.tick(world.clock.now());
    world.codeHost.mutatePr(PR, { headSha: 'def456' });
    world.clock.advanceSeconds(60);
    await world.controller.tick(world.clock.now());
    expect(world.codeHost.merges).toHaveLength(1);
    expect(world.codeHost.merges[0]!.idem).toBe(mergeKey(PR, 'def456'));
  });

  it('update-branch is guarded per head: same head never updates twice', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }), snapshot: { behindBase: true } });
    await world.controller.tick(world.clock.now());
    expect(world.codeHost.branchUpdates).toHaveLength(1);

    // Pretend the host was slow to reflect it: still behind, same head.
    world.codeHost.mutatePr(PR, { behindBase: true });
    world.clock.advanceSeconds(60);
    await world.controller.tick(world.clock.now());
    expect(world.codeHost.branchUpdates).toHaveLength(1);
  });
});

describe('remediation response kinds and attempt accounting', () => {
  it('an update_branch response def goes through the code host with a cooldown', async () => {
    const catalog: RemediationDef[] = [
      {
        id: 'rebase-stale',
        description: 'update the branch when conflicting (host-side rebase)',
        class: 'mechanical',
        match: { signal: 'conflict' },
        response: { kind: 'update_branch' },
        priority: 5,
        cooldownSeconds: 60,
        maxAttempts: 1,
      },
    ];
    const layers: ConfigLayerInput[] = [
      { layer: 'default', preferences: { enabledRemediations: ['rebase-stale'], endActionDefault: 'merge' } },
    ];
    const world = buildWorld({ catalog, layers });
    await setup(world, { snapshot: { mergeable: 'conflicting' } });
    await world.controller.tick(world.clock.now());

    expect(world.codeHost.branchUpdates).toHaveLength(1);
    expect(world.remediationService.triggers).toHaveLength(0);
    expect((await world.prs.get(PR))!.lifecycleState).toBe('awaiting_remediation');
  });

  it('human intervention after escalation resets attempt accounting', async () => {
    const world = buildWorld(); // eslint-autofix: maxAttempts 2
    await setup(world, { checks: checks({ lint: 'failure' }) });
    await world.controller.tick(world.clock.now());
    world.clock.advanceSeconds(130);
    await world.controller.tick(world.clock.now());
    world.clock.advanceSeconds(130);
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('escalated');
    expect(world.remediationService.triggers).toHaveLength(2);

    // Human pushes; lint fails again — the loop gets a fresh budget.
    world.codeHost.mutatePr(PR, { headSha: 'human-1', checks: checks({ lint: 'failure' }), lastActivityAt: world.clock.now() });
    world.clock.advanceSeconds(3700);
    await world.controller.tick(world.clock.now());
    expect(world.remediationService.triggers).toHaveLength(3);
    expect(world.remediationService.triggers[2]!.idempotencyKey).toBe(`rem:${PR}:human-1:eslint-autofix:1`);
  });

  it('switching defs mid-PR restarts the attempt count for the new def', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'failure' }) });
    await world.controller.tick(world.clock.now()); // eslint-autofix attempt 1

    // Lint recovers but e2e times out → different def (retry-flaky).
    world.codeHost.mutatePr(PR, { checks: checks({ lint: 'success', e2e: 'timed_out' }) });
    world.clock.advanceSeconds(130);
    await world.controller.tick(world.clock.now());
    expect(world.codeHost.checkRetries).toHaveLength(1);
    expect(world.codeHost.checkRetries[0]!.idem).toBe(`rem:${PR}:abc123:retry-flaky:1`);
    expect((await world.prs.get(PR))!.remediation).toMatchObject({ lastDefId: 'retry-flaky', attemptCount: 1 });
  });

  it('the external trigger carries the failing jobs as scope hints, never logs', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ 'lint-a': 'failure', 'lint-b': 'failure' }) });
    await world.controller.tick(world.clock.now());
    const trigger = world.remediationService.triggers[0]!;
    expect(trigger.context).toEqual({ failingJobs: ['lint-a', 'lint-b'] });
    expect(JSON.stringify(trigger)).not.toContain('logs');
    expect(trigger.target).toEqual({ repo: 'acme/web', prNumber: 42, headRef: 'feature', headSha: 'abc123' });
  });
});

describe('audit completeness — nothing exits silently', () => {
  it('every lifecycle transition writes a state_transition event', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'failure' }) });
    await world.controller.tick(world.clock.now());
    world.codeHost.mutatePr(PR, { headSha: 'def456', checks: checks({ lint: 'success' }) });
    world.clock.advanceSeconds(130);
    await world.controller.tick(world.clock.now());

    const transitions = (await world.audit.list(PR))
      .filter((e) => e.type === 'state_transition')
      .map((e) => `${e.payload['from']}→${e.payload['to']}`);
    expect(transitions).toEqual(['tracked→awaiting_remediation', 'awaiting_remediation→merged']);
    const terminal = (await world.audit.list(PR)).filter((e) => e.type === 'terminal');
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.payload['state']).toBe('merged');
  });
});
