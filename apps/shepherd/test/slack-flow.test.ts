/**
 * Slack-as-UI, end to end and hermetic: outbound messages carry buttons →
 * a (mock) click round-trips through the interaction handler → domain
 * commands → the reconcile loop acts. No real Slack anywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_ABANDON,
  ACTION_MERGE_NOW,
  ACTION_RETRY,
  FakeSlackGateway,
  SlackInteractionHandler,
  StaticSlackAuthz,
} from '@shepherd/adapter-slack';
import { DefaultDeliveryService, InMemoryDeliveryStore, StaticIdentityMap } from '@shepherd/delivery';
import { FakeNotifierTransport, buildWorld, makeSnapshot, type World } from '@shepherd/testkit';
import { DeliveryShepherdNotifier } from '../src/notifier.js';

const PR = 'github:acme/web#42';
const AUTHOR_SLACK = 'U_AUTHOR';
const ADMIN_CHANNEL = '#pr-shepherd';

function checks(spec: Record<string, 'failure' | 'success' | 'pending'>) {
  return Object.entries(spec).map(([name, c]) => ({
    name,
    jobName: name,
    conclusion: c === 'pending' ? null : c,
    completedAt: c === 'pending' ? null : new Date(0),
    runId: `${name}-run`,
  }));
}

/** The real notifier (templates + routing) over the fake transport. */
function realNotifier(world: World) {
  const transport = new FakeNotifierTransport();
  const delivery = new DefaultDeliveryService({ slack: transport }, new InMemoryDeliveryStore(), world.clock);
  const identity = new StaticIdentityMap(
    { octocat: { transport: 'slack', address: AUTHOR_SLACK } },
    { transport: 'slack', address: ADMIN_CHANNEL },
  );
  const notifier = new DeliveryShepherdNotifier(delivery, identity, { transport: 'slack', address: ADMIN_CHANNEL }, {
    quietSeconds: 60,
    hardCapSeconds: 300,
  });
  return { transport, notifier };
}

function uiHandler(world: World) {
  const gateway = new FakeSlackGateway();
  const authz = StaticSlackAuthz.fromIdentityMap(
    { octocat: { transport: 'slack', address: AUTHOR_SLACK } },
    [],
  );
  const handler = new SlackInteractionHandler({
    commands: world.commands,
    getRecord: (prId) => world.prs.get(prId),
    authz,
    gateway,
    enroll: async () => 'unused here',
    digest: async () => 'unused here',
  });
  return { gateway, handler };
}

/** Extract every action_id from a Block Kit message. */
function actionIds(blocks: unknown[]): string[] {
  return blocks
    .filter((b): b is { type: string; elements: Array<{ action_id: string }> } => (b as { type: string }).type === 'actions')
    .flatMap((b) => b.elements.map((e) => e.action_id));
}

async function seed(world: World, opts: { checks: ReturnType<typeof checks>; endAction?: 'merge' | 'notify_ready' }) {
  world.codeHost.setPr(
    makeSnapshot({ id: PR, repo: 'acme/web', number: 42, author: 'octocat', checks: opts.checks, lastActivityAt: world.clock.now() }),
  );
  const snap = (await world.codeHost.getPr(PR))!;
  await world.ingestion.ingest(snap, { source: 'slack', endAction: { kind: opts.endAction ?? 'notify_ready' } });
}

describe('outbound messages carry the UI', () => {
  it('escalation messages include retry + abandon buttons and reach author AND admins', async () => {
    const world = buildWorld();
    const { transport, notifier } = realNotifier(world);
    await seed(world, { checks: checks({ 'unmatched-check': 'failure' }) });
    const record = (await world.prs.get(PR))!;
    await notifier.prEscalated(
      { ...record, escalation: { reason: 'no remediation matched', headSha: 'abc123', at: world.clock.now() } },
      'no remediation matched',
    );

    expect(transport.sends.map((s) => s.dest.address).sort()).toEqual([ADMIN_CHANNEL, AUTHOR_SLACK]);
    for (const send of transport.sends) {
      expect(actionIds(send.payload.blocks!)).toEqual([ACTION_RETRY, ACTION_ABANDON]);
    }
  });

  it('ready messages carry the merge button and send immediately (not debounced)', async () => {
    const world = buildWorld();
    const { transport, notifier } = realNotifier(world);
    await seed(world, { checks: checks({ lint: 'success' }) });
    await notifier.prReady((await world.prs.get(PR))!);

    expect(transport.sends).toHaveLength(1); // no flushDue needed — interactivity wants immediacy
    expect(transport.sends[0]!.dest.address).toBe(AUTHOR_SLACK);
    expect(actionIds(transport.sends[0]!.payload.blocks!)).toEqual([ACTION_MERGE_NOW]);
  });
});

describe('click → command → loop, end to end', () => {
  it('escalated PR: abandon button → modal → submit → loop never touches it again', async () => {
    const world = buildWorld();
    const { gateway, handler } = uiHandler(world);
    await seed(world, { checks: checks({ 'unmatched-check': 'failure' }) });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('escalated');

    // Click "Abandon…" (payload shaped exactly like Slack's block_actions).
    await handler.onBlockAction({
      type: 'block_actions',
      user: { id: AUTHOR_SLACK, username: 'jordon' },
      trigger_id: 'trig-1',
      channel: { id: 'C0PRSHEP', name: 'pr-shepherd' },
      actions: [{ type: 'button', action_id: ACTION_ABANDON, value: PR, action_ts: '1.2' }],
    });
    expect(gateway.openedViews).toHaveLength(1);

    // Submit the confirmation modal.
    const view = gateway.openedViews[0]!.view as { callback_id: string; private_metadata: string };
    await handler.onViewSubmission({
      type: 'view_submission',
      user: { id: AUTHOR_SLACK },
      view: {
        callback_id: view.callback_id,
        private_metadata: view.private_metadata,
        state: { values: { reason: { reason: { value: 'review died, reopening later' } } } },
      },
    });

    const record = (await world.prs.get(PR))!;
    expect(record.lifecycleState).toBe('abandoned');
    world.clock.advanceSeconds(7200);
    expect((await world.controller.tick(world.clock.now())).claimed).toBe(0);
  });

  it('ready PR: merge-now click flips the end action and the next tick merges', async () => {
    const world = buildWorld();
    const { handler } = uiHandler(world);
    await seed(world, { checks: checks({ lint: 'success' }), endAction: 'notify_ready' });
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('ready');
    expect(world.codeHost.merges).toHaveLength(0);

    await handler.onBlockAction({
      type: 'block_actions',
      user: { id: AUTHOR_SLACK },
      trigger_id: 'trig-2',
      channel: { id: 'C0PRSHEP' },
      actions: [{ type: 'button', action_id: ACTION_MERGE_NOW, value: PR }],
    });
    await world.controller.tick(world.clock.now()); // due immediately thanks to reconcileNow
    expect((await world.prs.get(PR))!.lifecycleState).toBe('merged');
    expect(world.codeHost.merges).toHaveLength(1);
  });

  it('an unauthorized click changes nothing anywhere', async () => {
    const world = buildWorld();
    const { gateway, handler } = uiHandler(world);
    await seed(world, { checks: checks({ lint: 'success' }), endAction: 'notify_ready' });
    await world.controller.tick(world.clock.now());

    await handler.onBlockAction({
      type: 'block_actions',
      user: { id: 'U_RANDO' },
      trigger_id: 'trig-3',
      channel: { id: 'C0PRSHEP' },
      actions: [{ type: 'button', action_id: ACTION_MERGE_NOW, value: PR }],
    });
    world.clock.advanceSeconds(300);
    await world.controller.tick(world.clock.now());
    expect((await world.prs.get(PR))!.lifecycleState).toBe('ready'); // still just ready
    expect(world.codeHost.merges).toHaveLength(0);
    expect(gateway.ephemerals[0]!.text).toContain('Only octocat');
  });
});
