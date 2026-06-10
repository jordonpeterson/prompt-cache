import { describe, expect, it } from 'vitest';
import { buildWorld, makeSnapshot } from '../src/world.js';

const PR = 'github:acme/web#42';

async function setup(world: ReturnType<typeof buildWorld>) {
  world.codeHost.setPr(
    makeSnapshot({
      id: PR, repo: 'acme/web', number: 42,
      // CI still running, so ticks park it in awaiting_checks instead of merging.
      checks: [{ name: 'lint', jobName: 'lint', conclusion: null, completedAt: null, runId: 'lint-run' }],
      lastActivityAt: world.clock.now(),
    }),
  );
  const snap = (await world.codeHost.getPr(PR))!;
  await world.ingestion.ingest(snap, { source: 'api' });
}

describe('PrCommands.abandon', () => {
  it('terminalizes with an audited actor and reason', async () => {
    const world = buildWorld();
    await setup(world);
    const result = await world.commands.abandon(PR, { reason: 'superseded by #43', actor: 'slack:U_AUTHOR' });
    expect(result.ok).toBe(true);
    const record = (await world.prs.get(PR))!;
    expect(record.lifecycleState).toBe('abandoned');
    expect(record.terminalAt).toEqual(world.clock.now());
    const terminal = (await world.audit.list(PR)).find((e) => e.type === 'terminal');
    expect(terminal!.payload).toEqual({ state: 'abandoned', reason: 'superseded by #43', by: 'slack:U_AUTHOR' });
  });

  it('rejects unknown PRs and already-terminal PRs distinctly', async () => {
    const world = buildWorld();
    expect(await world.commands.abandon('github:acme/web#999', { reason: 'x', actor: 'a' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    await setup(world);
    await world.commands.abandon(PR, { reason: 'first', actor: 'a' });
    expect(await world.commands.abandon(PR, { reason: 'second', actor: 'a' })).toEqual({
      ok: false,
      reason: 'already_terminal',
    });
    // Only the first abandon audited a terminal event.
    expect((await world.audit.list(PR)).filter((e) => e.type === 'terminal')).toHaveLength(1);
  });

  it('an abandoned PR is never claimed by the loop again', async () => {
    const world = buildWorld();
    await setup(world);
    await world.commands.abandon(PR, { reason: 'done with it', actor: 'a' });
    world.clock.advanceSeconds(3600);
    const report = await world.controller.tick(world.clock.now());
    expect(report.claimed).toBe(0);
  });
});

describe('PrCommands.reconcileNow', () => {
  it('makes the PR immediately due without touching lifecycle state', async () => {
    const world = buildWorld();
    await setup(world);
    await world.controller.tick(world.clock.now()); // schedules it into the future
    const before = (await world.prs.get(PR))!;
    expect(before.nextReconcileAt.getTime()).toBeGreaterThan(world.clock.now().getTime());

    const result = await world.commands.reconcileNow(PR, { actor: 'slack:U_AUTHOR' });
    expect(result.ok).toBe(true);
    const after = (await world.prs.get(PR))!;
    expect(after.nextReconcileAt).toEqual(world.clock.now());
    expect(after.lifecycleState).toBe(before.lifecycleState); // command nudges timing only
    expect((await world.audit.list(PR)).some((e) => e.type === 'reconcile_requested')).toBe(true);
  });
});

describe('PrCommands.setEndAction', () => {
  it('records human intent that the next reconcile acts on', async () => {
    const world = buildWorld();
    await setup(world);
    const result = await world.commands.setEndAction(PR, { kind: 'merge' }, { actor: 'slack:U_ADMIN' });
    expect(result.ok).toBe(true);
    expect((await world.prs.get(PR))!.endAction).toEqual({ kind: 'merge' });
    const event = (await world.audit.list(PR)).find((e) => e.type === 'end_action_set');
    expect(event!.payload).toEqual({ endAction: 'merge', by: 'slack:U_ADMIN' });
  });

  it('refuses on terminal records', async () => {
    const world = buildWorld();
    await setup(world);
    await world.commands.abandon(PR, { reason: 'x', actor: 'a' });
    expect((await world.commands.setEndAction(PR, { kind: 'merge' }, { actor: 'a' })).ok).toBe(false);
  });
});
