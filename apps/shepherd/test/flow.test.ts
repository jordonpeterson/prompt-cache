/**
 * Full-wiring flow test: the HTTP trigger API and the reconcile loop sharing
 * one (fake) world — enroll over HTTP, drive ticks, watch status converge.
 * This is the closest hermetic stand-in for "the integration" end to end.
 */
import { describe, expect, it } from 'vitest';
import { buildWorld, makeSnapshot } from '@shepherd/testkit';
import { buildServer } from '../src/server.js';

const PR_ID = 'github:acme/web#42';
const PR_PATH = encodeURIComponent(PR_ID);

function checks(spec: Record<string, 'failure' | 'success' | 'pending'>) {
  return Object.entries(spec).map(([name, c]) => ({
    name,
    jobName: name,
    conclusion: c === 'pending' ? null : c,
    completedAt: c === 'pending' ? null : new Date(0),
    runId: `${name}-run`,
  }));
}

function makeStack() {
  const world = buildWorld();
  const app = buildServer({
    codeHost: world.codeHost,
    ingestion: world.ingestion,
    prs: world.prs,
    audit: world.audit,
    now: () => world.clock.now(),
  });
  return { world, app };
}

describe('trigger → remediate → merge, observed through the API', () => {
  it('walks the full lifecycle', async () => {
    const { world, app } = makeStack();
    world.codeHost.setPr(
      makeSnapshot({
        id: PR_ID, repo: 'acme/web', number: 42,
        checks: checks({ lint: 'failure' }),
        lastActivityAt: world.clock.now(),
      }),
    );

    // Enroll via HTTP with an explicit merge end-action.
    const trigger = await app.inject({
      method: 'POST',
      url: '/triggers/pr',
      payload: { repo: 'acme/web', number: 42, campaignKey: 'lint-cleanup', endAction: { kind: 'merge' } },
    });
    expect(trigger.statusCode).toBe(202);

    // Tick 1: the failing lint check fires the autofix.
    await world.controller.tick(world.clock.now());
    let status = (await app.inject({ method: 'GET', url: `/prs/${PR_PATH}/status` })).json();
    expect(status.state).toBe('awaiting_remediation');
    expect(status.remediation).toMatchObject({ lastDefId: 'eslint-autofix', attemptCount: 1 });
    expect(world.remediationService.triggers).toHaveLength(1);

    // The fix lands; cooldown elapses; CI re-runs.
    world.codeHost.mutatePr(PR_ID, { headSha: 'fixed-1', checks: checks({ lint: 'pending' }) });
    world.clock.advanceSeconds(130);
    await world.controller.tick(world.clock.now());
    status = (await app.inject({ method: 'GET', url: `/prs/${PR_PATH}/status` })).json();
    expect(status.state).toBe('awaiting_checks');

    // CI goes green → merged; status is terminal and the audit trail is complete.
    world.codeHost.mutatePr(PR_ID, { checks: checks({ lint: 'success' }) });
    world.clock.advanceSeconds(31);
    await world.controller.tick(world.clock.now());
    status = (await app.inject({ method: 'GET', url: `/prs/${PR_PATH}/status` })).json();
    expect(status.state).toBe('merged');
    expect(world.codeHost.merges).toHaveLength(1);
    expect(world.notifier.events).toContainEqual({ kind: 'merged', prId: PR_ID });
  });

  it('manual abandon mid-remediation stops the loop for good', async () => {
    const { world, app } = makeStack();
    world.codeHost.setPr(
      makeSnapshot({
        id: PR_ID, repo: 'acme/web', number: 42,
        checks: checks({ lint: 'failure' }),
        lastActivityAt: world.clock.now(),
      }),
    );
    await app.inject({ method: 'POST', url: '/triggers/pr', payload: { repo: 'acme/web', number: 42 } });
    await world.controller.tick(world.clock.now());
    expect(world.remediationService.triggers).toHaveLength(1);

    const abandon = await app.inject({
      method: 'POST',
      url: `/prs/${PR_PATH}/abandon`,
      payload: { reason: 'superseded by #43' },
    });
    expect(abandon.statusCode).toBe(200);

    // Even with the cooldown expired and lint still failing, the loop never touches it again.
    world.clock.advanceSeconds(300);
    const report = await world.controller.tick(world.clock.now());
    expect(report.claimed).toBe(0);
    expect(world.remediationService.triggers).toHaveLength(1);
    expect((await world.prs.get(PR_ID))!.lifecycleState).toBe('abandoned');
  });

  it('re-triggering an already-tracked PR upgrades it without disturbing the loop state', async () => {
    const { world, app } = makeStack();
    world.codeHost.setPr(
      makeSnapshot({
        id: PR_ID, repo: 'acme/web', number: 42,
        labels: ['auto-shepherd'],
        checks: checks({ lint: 'pending' }),
        lastActivityAt: world.clock.now(),
      }),
    );
    // Passively enrolled first (label sweep)...
    const snap = (await world.codeHost.getPr(PR_ID))!;
    await world.ingestion.ingest(snap, { source: 'label', campaignLabel: 'auto-shepherd' });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR_ID))!.lifecycleState).toBe('awaiting_checks');

    // ...then explicitly triggered with a campaign.
    const res = await app.inject({
      method: 'POST',
      url: '/triggers/pr',
      payload: { repo: 'acme/web', number: 42, campaignKey: 'push', endAction: { kind: 'merge' } },
    });
    expect(res.statusCode).toBe(202);
    const record = (await world.prs.get(PR_ID))!;
    expect(record.enrollment).toBe('triggered');
    expect(record.lifecycleState).toBe('awaiting_checks'); // lifecycle untouched

    // The end action takes effect on the next green tick.
    world.codeHost.mutatePr(PR_ID, { checks: checks({ lint: 'success' }) });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR_ID))!.lifecycleState).toBe('merged');
  });
});
