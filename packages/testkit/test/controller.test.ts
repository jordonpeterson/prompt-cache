import { describe, expect, it } from 'vitest';
import { DefaultShepherdController } from '@shepherd/core';
import { buildWorld, makeSnapshot, type World } from '../src/world.js';

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
  world: World,
  opts: { checks?: ReturnType<typeof checks>; endAction?: 'merge' | 'notify_ready'; snapshot?: Record<string, unknown> } = {},
) {
  world.codeHost.setPr(
    makeSnapshot({
      id: PR, repo: 'acme/web', number: 42,
      checks: opts.checks ?? [],
      lastActivityAt: world.clock.now(),
      ...(opts.snapshot as object),
    }),
  );
  const snap = (await world.codeHost.getPr(PR))!;
  await world.ingestion.ingest(snap, { source: 'api', endAction: { kind: opts.endAction ?? 'merge' } });
}

async function tick(world: World, advanceSeconds = 0) {
  if (advanceSeconds) world.clock.advanceSeconds(advanceSeconds);
  return world.controller.tick(world.clock.now());
}

async function state(world: World) {
  return (await world.prs.get(PR))!.lifecycleState;
}

describe('happy path', () => {
  it('merges a green triggered PR and is idempotent across further ticks', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }) });
    await tick(world);
    expect(await state(world)).toBe('merged');
    expect(world.codeHost.merges).toHaveLength(1);
    expect(world.notifier.events).toContainEqual({ kind: 'merged', prId: PR });

    await tick(world, 3600);
    expect(world.codeHost.merges).toHaveLength(1); // terminal records are never reclaimed
    const terminal = (await world.audit.list(PR)).filter((e) => e.type === 'terminal');
    expect(terminal).toHaveLength(1); // nothing exits silently — exactly once
  });

  it('waits in awaiting_checks while CI runs', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'pending' }) });
    await tick(world);
    expect(await state(world)).toBe('awaiting_checks');
    expect(world.codeHost.merges).toHaveLength(0);
  });
});

describe('fire-and-wait remediation (§6)', () => {
  it('fires once, waits out c without polling, then proceeds when the fix lands', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'failure' }) });

    await tick(world);
    expect(await state(world)).toBe('awaiting_remediation');
    expect(world.remediationService.triggers).toHaveLength(1);
    expect(world.remediationService.triggers[0]!.task).toBe('eslint-autofix');
    expect(world.remediationService.triggers[0]!.idempotencyKey).toBe(`rem:${PR}:abc123:eslint-autofix:1`);

    // During c (cooldown 120s): re-ticks do nothing about this remediation.
    await tick(world, 20);
    await tick(world, 20);
    expect(world.remediationService.triggers).toHaveLength(1);
    expect(await state(world)).toBe('awaiting_remediation');

    // Fix lands: new head, CI re-running → falls into normal awaiting_checks.
    world.codeHost.mutatePr(PR, { headSha: 'def456', checks: checks({ lint: 'pending' }) });
    await tick(world, 90); // past cooldownUntil
    expect(await state(world)).toBe('awaiting_checks');

    world.codeHost.mutatePr(PR, { checks: checks({ lint: 'success' }) });
    await tick(world, 30);
    expect(await state(world)).toBe('merged');
  });

  it('re-triggers after c while attempts remain, then escalates at the cap', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'failure' }) });

    await tick(world); // attempt 1
    await tick(world, 130); // past c, same head, still failing → attempt 2
    expect(world.remediationService.triggers).toHaveLength(2);
    expect(world.remediationService.triggers[1]!.idempotencyKey).toBe(`rem:${PR}:abc123:eslint-autofix:2`);

    await tick(world, 130); // maxAttempts=2 exhausted → escalate
    expect(await state(world)).toBe('escalated');
    expect(world.remediationService.triggers).toHaveLength(2);
    const record = (await world.prs.get(PR))!;
    expect(record.escalation!.reason).toContain('exhausted');
    expect(world.notifier.events.some((e) => e.kind === 'escalated')).toBe(true);
  });

  it('a hard decline escalates immediately instead of burning c', async () => {
    const world = buildWorld();
    world.remediationService.declineTasks.set('conflict-rebase', 'conflict too gnarly to guess');
    await setup(world, { snapshot: { mergeable: 'conflicting' } });
    await tick(world);
    expect(await state(world)).toBe('escalated');
    const record = (await world.prs.get(PR))!;
    expect(record.escalation!.reason).toContain('gnarly');
  });

  it('restart inside c does not re-fire (state + reservation committed atomically)', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'failure' }) });
    await tick(world);
    expect(world.remediationService.triggers).toHaveLength(1);

    // "Restart": new controller over the same persisted stores, PR forced due.
    const controller2 = new DefaultShepherdController(
      {
        codeHost: world.codeHost, remediationService: world.remediationService,
        clock: world.clock, uow: world.uow, prs: world.prs, resolver: world.resolver,
        engine: world.engine, mergePolicy: world.mergePolicy, notifier: world.notifier,
      },
      { random: () => 0.5 },
    );
    const record = (await world.prs.get(PR))!;
    await world.prs.upsert({ ...record, nextReconcileAt: world.clock.now() });
    await controller2.tick(world.clock.now());
    expect(world.remediationService.triggers).toHaveLength(1);
    expect(await state(world)).toBe('awaiting_remediation');
  });

  it('one action per tick: conflict outranks failing lint; only one trigger fires', async () => {
    const world = buildWorld();
    await setup(world, {
      checks: checks({ lint: 'failure' }),
      snapshot: { mergeable: 'conflicting' },
    });
    await tick(world);
    expect(world.remediationService.triggers).toHaveLength(1);
    expect(world.remediationService.triggers[0]!.task).toBe('conflict-rebase');
  });

  it('retry_checks responses go through the code host, not the task server', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ e2e: 'timed_out' }) });
    await tick(world);
    expect(world.codeHost.checkRetries).toHaveLength(1);
    expect(world.remediationService.triggers).toHaveLength(0);
    expect(await state(world)).toBe('awaiting_remediation'); // cooldown applies uniformly
  });
});

describe('lifecycle edges', () => {
  it('pauses drafts and resumes on publish', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }), snapshot: { isDraft: true } });
    await tick(world);
    expect(await state(world)).toBe('draft_paused');
    expect(world.codeHost.merges).toHaveLength(0);

    world.codeHost.mutatePr(PR, { isDraft: false });
    await tick(world, 4 * 3600 + 60);
    expect(await state(world)).toBe('merged');
  });

  it('escalated PRs resume when a human pushes a new head', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ 'security-scan': 'failure' }) });
    await tick(world);
    expect(await state(world)).toBe('escalated'); // unmatched signal → default case

    await tick(world, 3700);
    expect(await state(world)).toBe('escalated'); // still paused, still observed

    world.codeHost.mutatePr(PR, {
      headSha: 'human-fix',
      checks: checks({ 'security-scan': 'success' }),
      lastActivityAt: world.clock.now(),
    });
    await tick(world, 3700);
    expect(await state(world)).toBe('merged');
  });

  it('escalates stale PRs', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'pending' }) });
    await tick(world);
    world.clock.advanceSeconds(31 * 24 * 3600);
    const record = (await world.prs.get(PR))!;
    await world.prs.upsert({ ...record, nextReconcileAt: world.clock.now() });
    await tick(world);
    expect(await state(world)).toBe('escalated');
    expect((await world.prs.get(PR))!.escalation!.reason).toContain('stale');
  });

  it('terminalizes externally-closed PRs as abandoned, with audit', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'pending' }) });
    await tick(world);
    world.codeHost.mutatePr(PR, { state: 'closed' });
    await tick(world, 60);
    const record = (await world.prs.get(PR))!;
    expect(record.lifecycleState).toBe('abandoned');
    expect(record.terminalAt).not.toBeNull();
    expect((await world.audit.list(PR)).some((e) => e.type === 'terminal')).toBe(true);
  });

  it('terminalizes externally-merged PRs as merged without calling merge', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'pending' }) });
    await tick(world);
    world.codeHost.mutatePr(PR, { state: 'merged' });
    await tick(world, 60);
    expect(await state(world)).toBe('merged');
    expect(world.codeHost.merges).toHaveLength(0);
  });

  it('updates the branch when green but behind, then merges', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }), snapshot: { behindBase: true } });
    await tick(world);
    expect(world.codeHost.branchUpdates).toHaveLength(1);
    expect(world.codeHost.merges).toHaveLength(0);
    await tick(world, 60);
    expect(await state(world)).toBe('merged');
  });

  it('notify_ready end-action notifies once and never merges', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }), endAction: 'notify_ready' });
    await tick(world);
    expect(await state(world)).toBe('ready');
    await tick(world, 180);
    await tick(world, 180);
    expect(world.codeHost.merges).toHaveLength(0);
    expect(world.notifier.events.filter((e) => e.kind === 'ready')).toHaveLength(1);
  });

  it('a failed merge escalates with the host reason', async () => {
    const world = buildWorld();
    world.codeHost.mergeFailure = 'branch protection: 2 approvals required';
    await setup(world, { checks: checks({ lint: 'success' }) });
    await tick(world);
    expect(await state(world)).toBe('escalated');
    expect((await world.prs.get(PR))!.escalation!.reason).toContain('branch protection');
  });
});

describe('tick reporting', () => {
  it('reports claims, transitions, and actions', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'failure' }) });
    const report = await tick(world);
    expect(report.claimed).toBe(1);
    expect(report.actions).toContainEqual(
      expect.objectContaining({ prId: PR, kind: 'remediation_triggered' }),
    );
    expect(report.transitions.some((t) => t.to === 'awaiting_remediation')).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('isolates per-PR errors and backs the PR off', async () => {
    const world = buildWorld();
    await setup(world, { checks: checks({ lint: 'success' }) });
    const original = world.codeHost.getPr.bind(world.codeHost);
    let calls = 0;
    world.codeHost.getPr = async (id) => {
      calls++;
      if (calls === 1) throw new Error('rate limited');
      return original(id);
    };
    const report = await tick(world);
    expect(report.errors).toHaveLength(1);
    expect((await world.audit.list(PR)).some((e) => e.type === 'reconcile_error')).toBe(true);
    await tick(world, 61);
    expect(await state(world)).toBe('merged'); // self-healed next due tick
  });
});
