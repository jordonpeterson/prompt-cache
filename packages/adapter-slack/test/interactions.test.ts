import { describe, expect, it, vi } from 'vitest';
import { buildWorld, makeSnapshot } from '@shepherd/testkit';
import { ACTION_ABANDON, ACTION_MERGE_NOW, ACTION_RETRY, VIEW_ABANDON_CONFIRM } from '../src/actions.js';
import { StaticSlackAuthz } from '../src/authz.js';
import { FakeSlackGateway } from '../src/gateway.js';
import { SlackInteractionHandler, type SlashResponse } from '../src/interactions.js';
import { CHANNEL, blockActionsPayload, slashCommandPayload, viewSubmissionPayload } from './fixtures.js';

const PR = 'github:acme/web#42';
const AUTHOR_SLACK = 'U_AUTHOR';
const ADMIN_SLACK = 'U_ADMIN';
const STRANGER_SLACK = 'U_STRANGER';

async function setup(opts: { seedPr?: boolean } = { seedPr: true }) {
  const world = buildWorld();
  if (opts.seedPr !== false) {
    world.codeHost.setPr(
      makeSnapshot({ id: PR, repo: 'acme/web', number: 42, author: 'octocat', lastActivityAt: world.clock.now() }),
    );
    const snap = (await world.codeHost.getPr(PR))!;
    await world.ingestion.ingest(snap, { source: 'api', endAction: { kind: 'notify_ready' } });
  }
  const gateway = new FakeSlackGateway();
  const authz = StaticSlackAuthz.fromIdentityMap(
    { octocat: { transport: 'slack', address: AUTHOR_SLACK } },
    [ADMIN_SLACK],
  );
  const enroll = vi.fn(async (repo: string, number: number) => `tracking ${repo}#${number}`);
  const digest = vi.fn(async () => 'your digest: nothing in flight');
  const handler = new SlackInteractionHandler({
    commands: world.commands,
    getRecord: (prId) => world.prs.get(prId),
    authz,
    gateway,
    enroll,
    digest,
  });
  return { world, gateway, handler, enroll, digest };
}

describe('block actions — buttons', () => {
  it('the abandon button opens the confirmation modal, never abandons directly', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onBlockAction(blockActionsPayload({ userId: AUTHOR_SLACK, actionId: ACTION_ABANDON, value: PR }));

    expect(gateway.openedViews).toHaveLength(1);
    const view = gateway.openedViews[0]!.view as { callback_id: string; private_metadata: string };
    expect(view.callback_id).toBe(VIEW_ABANDON_CONFIRM);
    expect(JSON.parse(view.private_metadata)).toEqual({ prId: PR, channelId: CHANNEL });
    expect((await world.prs.get(PR))!.lifecycleState).not.toBe('abandoned');
  });

  it('retry makes the PR immediately due and confirms ephemerally', async () => {
    const { world, gateway, handler } = await setup();
    await world.controller.tick(world.clock.now()); // schedule into the future
    await handler.onBlockAction(blockActionsPayload({ userId: AUTHOR_SLACK, actionId: ACTION_RETRY, value: PR }));

    expect((await world.prs.get(PR))!.nextReconcileAt).toEqual(world.clock.now());
    expect(gateway.ephemerals).toEqual([
      { channelId: CHANNEL, userId: AUTHOR_SLACK, text: expect.stringContaining('Re-evaluating') },
    ]);
  });

  it('merge-now stamps the end action and nudges the loop — it never merges itself', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onBlockAction(blockActionsPayload({ userId: AUTHOR_SLACK, actionId: ACTION_MERGE_NOW, value: PR }));

    const record = (await world.prs.get(PR))!;
    expect(record.endAction).toEqual({ kind: 'merge' });
    expect(record.nextReconcileAt).toEqual(world.clock.now());
    expect(world.codeHost.merges).toHaveLength(0); // the loop merges, not the button
    expect(gateway.ephemerals[0]!.text).toContain('will merge');

    await world.controller.tick(world.clock.now());
    expect(world.codeHost.merges).toHaveLength(1);
  });

  it('denies a stranger with an ephemeral and performs nothing', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onBlockAction(blockActionsPayload({ userId: STRANGER_SLACK, actionId: ACTION_MERGE_NOW, value: PR }));

    expect((await world.prs.get(PR))!.endAction).toEqual({ kind: 'notify_ready' });
    expect(gateway.ephemerals[0]!.text).toContain('Only octocat');
    expect(gateway.openedViews).toHaveLength(0);
  });

  it('admins may act on PRs they do not author', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onBlockAction(blockActionsPayload({ userId: ADMIN_SLACK, actionId: ACTION_MERGE_NOW, value: PR }));
    expect((await world.prs.get(PR))!.endAction).toEqual({ kind: 'merge' });
    expect(gateway.ephemerals[0]!.text).toContain('will merge');
  });

  it('reports untracked PRs instead of acting', async () => {
    const { gateway, handler } = await setup({ seedPr: false });
    await handler.onBlockAction(blockActionsPayload({ userId: ADMIN_SLACK, actionId: ACTION_RETRY, value: PR }));
    expect(gateway.ephemerals[0]!.text).toContain('not tracked');
  });

  it('ignores non-shepherd actions silently', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onBlockAction(
      blockActionsPayload({ userId: AUTHOR_SLACK, actionId: 'someone_elses_app:click', value: PR }),
    );
    expect(gateway.ephemerals).toHaveLength(0);
    expect(gateway.openedViews).toHaveLength(0);
    expect((await world.prs.get(PR))!.endAction).toEqual({ kind: 'notify_ready' });
  });

  it('survives a missing channel (e.g. click from a context without one)', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onBlockAction(
      blockActionsPayload({ userId: AUTHOR_SLACK, actionId: ACTION_RETRY, value: PR, channelId: null }),
    );
    expect((await world.prs.get(PR))!.nextReconcileAt).toEqual(world.clock.now());
    expect(gateway.ephemerals).toHaveLength(0); // nowhere to whisper — command still ran
  });

  it('rejects malformed payloads at the trust boundary', async () => {
    const { handler } = await setup();
    await expect(handler.onBlockAction({ type: 'block_actions', actions: [] })).rejects.toThrow();
    await expect(handler.onBlockAction('not even an object')).rejects.toThrow();
  });
});

describe('view submission — the abandon confirmation modal', () => {
  it('abandons with the typed reason and confirms in the originating channel', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onViewSubmission(viewSubmissionPayload({ userId: AUTHOR_SLACK, prId: PR }));

    const record = (await world.prs.get(PR))!;
    expect(record.lifecycleState).toBe('abandoned');
    const terminal = (await world.audit.list(PR)).find((e) => e.type === 'terminal');
    expect(terminal!.payload).toMatchObject({ reason: 'superseded by #43', by: `slack:${AUTHOR_SLACK}` });
    expect(gateway.ephemerals[0]).toMatchObject({ channelId: CHANNEL, userId: AUTHOR_SLACK });
  });

  it('falls back to a default reason when the input is empty', async () => {
    const { world, handler } = await setup();
    await handler.onViewSubmission(viewSubmissionPayload({ userId: ADMIN_SLACK, prId: PR, reason: null }));
    const terminal = (await world.audit.list(PR)).find((e) => e.type === 'terminal');
    expect(terminal!.payload['reason']).toBe('abandoned via Slack');
  });

  it('re-checks authz at submit time', async () => {
    const { world, gateway, handler } = await setup();
    await handler.onViewSubmission(viewSubmissionPayload({ userId: STRANGER_SLACK, prId: PR }));
    expect((await world.prs.get(PR))!.lifecycleState).not.toBe('abandoned');
    expect(gateway.ephemerals[0]!.text).toContain('Only octocat');
  });

  it('ignores foreign callback ids', async () => {
    const { world, handler } = await setup();
    await handler.onViewSubmission(
      viewSubmissionPayload({ userId: AUTHOR_SLACK, prId: PR, callbackId: 'other_app:dialog' }),
    );
    expect((await world.prs.get(PR))!.lifecycleState).not.toBe('abandoned');
  });

  it('double-submitting the modal is safe (second is already_terminal)', async () => {
    const { world, gateway, handler } = await setup();
    const payload = viewSubmissionPayload({ userId: AUTHOR_SLACK, prId: PR });
    await handler.onViewSubmission(payload);
    await handler.onViewSubmission(payload);
    expect((await world.audit.list(PR)).filter((e) => e.type === 'terminal')).toHaveLength(1);
    expect(gateway.ephemerals[1]!.text).toContain('already terminal');
  });
});

describe('/shepherd slash commands', () => {
  async function run(handler: SlackInteractionHandler, userId: string, text: string): Promise<SlashResponse> {
    return handler.onSlashCommand(slashCommandPayload({ userId, text }));
  }

  it('status renders the record, ephemerally', async () => {
    const { world, handler } = await setup();
    await world.controller.tick(world.clock.now()); // green + notify_ready → 'ready'
    const res = await run(handler, STRANGER_SLACK, 'status acme/web#42'); // reads are open to all
    expect(res.ephemeral).toBe(true);
    expect(res.text).toContain('github:acme/web#42');
    expect(res.text).toContain('ready');
    expect(res.text).toContain('end action: notify_ready');
  });

  it('status on an untracked PR says so', async () => {
    const { handler } = await setup({ seedPr: false });
    expect((await run(handler, AUTHOR_SLACK, 'status acme/web#42')).text).toContain('not tracked');
  });

  it('track parses the ref and end action and delegates to enrollment', async () => {
    const { handler, enroll } = await setup();
    const res = await run(handler, AUTHOR_SLACK, 'track acme/web#77 notify');
    expect(enroll).toHaveBeenCalledWith('acme/web', 77, AUTHOR_SLACK, 'notify_ready');
    expect(res.text).toContain('tracking acme/web#77');

    await run(handler, AUTHOR_SLACK, 'track acme/web#78');
    expect(enroll).toHaveBeenLastCalledWith('acme/web', 78, AUTHOR_SLACK, 'merge');
  });

  it('abandon works inline for authorized users and is denied for strangers', async () => {
    const { world, handler } = await setup();
    const denied = await run(handler, STRANGER_SLACK, 'abandon acme/web#42 wontfix');
    expect(denied.text).toContain('Only octocat');
    expect((await world.prs.get(PR))!.lifecycleState).not.toBe('abandoned');

    const ok = await run(handler, ADMIN_SLACK, 'abandon acme/web#42 wontfix, closing the campaign');
    expect(ok.text).toContain('abandoned');
    const terminal = (await world.audit.list(PR)).find((e) => e.type === 'terminal');
    expect(terminal!.payload['reason']).toBe('wontfix, closing the campaign');
  });

  it('digest delegates to the report seam', async () => {
    const { handler, digest } = await setup();
    const res = await run(handler, AUTHOR_SLACK, 'digest');
    expect(digest).toHaveBeenCalledWith(AUTHOR_SLACK);
    expect(res.text).toContain('nothing in flight');
  });

  it.each(['', 'help', 'status', 'status not-a-ref', 'track', 'frobnicate'])(
    'falls back to usage for %j',
    async (text) => {
      const { handler } = await setup();
      expect((await run(handler, AUTHOR_SLACK, text)).text).toContain('Usage:');
    },
  );
});

describe('StaticSlackAuthz', () => {
  const authz = StaticSlackAuthz.fromIdentityMap(
    {
      octocat: { transport: 'slack', address: AUTHOR_SLACK },
      'email-only': { transport: 'email', address: 'x@example.com' }, // non-slack: no reverse mapping
    },
    [ADMIN_SLACK],
  );

  it('reverses only slack destinations', () => {
    expect(authz.githubLoginFor(AUTHOR_SLACK)).toBe('octocat');
    expect(authz.githubLoginFor('x@example.com')).toBeNull();
  });

  it('author-or-admin rule', () => {
    expect(authz.mayAct(AUTHOR_SLACK, 'octocat')).toBe(true);
    expect(authz.mayAct(AUTHOR_SLACK, 'someone-else')).toBe(false);
    expect(authz.mayAct(ADMIN_SLACK, 'someone-else')).toBe(true);
    expect(authz.mayAct(STRANGER_SLACK, 'octocat')).toBe(false);
  });
});
