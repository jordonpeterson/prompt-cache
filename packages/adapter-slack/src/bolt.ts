import { App } from '@slack/bolt';
import { ACTION_PREFIX, VIEW_ABANDON_CONFIRM } from './actions.js';
import type { SlackInteractionHandler } from './interactions.js';

export interface SocketModeConfig {
  /** xoxb- bot token (chat:write etc.). */
  botToken: string;
  /** xapp- app-level token with connections:write — Socket Mode needs no public URL (§12). */
  appToken: string;
}

/**
 * Production wiring: Bolt in Socket Mode, every event acked immediately and
 * routed to the transport-agnostic handler. Handler errors are logged, never
 * thrown back into the socket (a bad payload must not kill the connection).
 */
export async function startSlackSocketMode(
  cfg: SocketModeConfig,
  handler: SlackInteractionHandler,
  log: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void },
): Promise<{ stop: () => Promise<void> }> {
  const app = new App({ token: cfg.botToken, appToken: cfg.appToken, socketMode: true });

  app.action(ACTION_PREFIX, async ({ ack, body }) => {
    await ack();
    try {
      await handler.onBlockAction(body);
    } catch (err) {
      log.error({ err }, 'slack block action failed');
    }
  });

  app.view(VIEW_ABANDON_CONFIRM, async ({ ack, body }) => {
    await ack();
    try {
      await handler.onViewSubmission(body);
    } catch (err) {
      log.error({ err }, 'slack view submission failed');
    }
  });

  app.command('/shepherd', async ({ ack, body }) => {
    try {
      const res = await handler.onSlashCommand(body);
      await ack({ text: res.text, response_type: res.ephemeral ? 'ephemeral' : 'in_channel' });
    } catch (err) {
      log.error({ err }, 'slack slash command failed');
      await ack({ text: 'Something went wrong — check the shepherd logs.', response_type: 'ephemeral' });
    }
  });

  await app.start();
  log.info('slack socket-mode connection established');
  return {
    stop: async () => {
      await app.stop();
    },
  };
}
