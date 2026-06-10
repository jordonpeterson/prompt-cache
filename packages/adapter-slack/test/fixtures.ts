/**
 * Realistic Slack interaction payloads, modeled on the shapes Slack actually
 * sends (interactivity docs: block_actions, view_submission, slash commands).
 * Extra fields are intentionally present — the handler must parse
 * forward-compatibly and ignore what it doesn't consume.
 */
import { VIEW_ABANDON_CONFIRM } from '../src/actions.js';

export const CHANNEL = 'C0PRSHEP';

export function blockActionsPayload(opts: {
  userId: string;
  actionId: string;
  value?: string;
  channelId?: string | null;
  triggerId?: string;
}): unknown {
  const payload: Record<string, unknown> = {
    type: 'block_actions',
    team: { id: 'T0001', domain: 'acme' },
    user: { id: opts.userId, username: 'somebody', name: 'somebody', team_id: 'T0001' },
    api_app_id: 'A0001',
    token: 'legacy-verification-token',
    container: { type: 'message', message_ts: '1736012345.000200', channel_id: CHANNEL, is_ephemeral: false },
    trigger_id: opts.triggerId ?? '13345224609.738474920.8088930838d88f008e0',
    response_url: 'https://hooks.slack.com/actions/T0001/12345678/abcdefghijkl',
    message: { type: 'message', ts: '1736012345.000200', text: 'escalated' },
    state: { values: {} },
    actions: [
      {
        type: 'button',
        action_id: opts.actionId,
        block_id: 'shepherd_escalation_actions',
        text: { type: 'plain_text', text: 'Abandon…', emoji: true },
        ...(opts.value !== undefined ? { value: opts.value } : {}),
        style: 'danger',
        action_ts: '1736012350.123456',
      },
    ],
  };
  if (opts.channelId !== null) {
    payload['channel'] = { id: opts.channelId ?? CHANNEL, name: 'pr-shepherd' };
  }
  return payload;
}

export function viewSubmissionPayload(opts: {
  userId: string;
  prId: string;
  channelId?: string | null;
  reason?: string | null;
  callbackId?: string;
}): unknown {
  return {
    type: 'view_submission',
    team: { id: 'T0001', domain: 'acme' },
    user: { id: opts.userId, username: 'somebody', name: 'somebody', team_id: 'T0001' },
    api_app_id: 'A0001',
    token: 'legacy-verification-token',
    trigger_id: '13345224609.738474920.8088930838d88f008e0',
    view: {
      id: 'V0001',
      team_id: 'T0001',
      type: 'modal',
      callback_id: opts.callbackId ?? VIEW_ABANDON_CONFIRM,
      private_metadata: JSON.stringify({ prId: opts.prId, channelId: opts.channelId === undefined ? CHANNEL : opts.channelId }),
      hash: '156772938.1827394',
      state: {
        values: {
          reason: {
            reason: {
              type: 'plain_text_input',
              value: opts.reason === undefined ? 'superseded by #43' : opts.reason,
            },
          },
        },
      },
    },
  };
}

export function slashCommandPayload(opts: { userId: string; text: string }): unknown {
  return {
    token: 'legacy-verification-token',
    team_id: 'T0001',
    team_domain: 'acme',
    channel_id: CHANNEL,
    channel_name: 'pr-shepherd',
    user_id: opts.userId,
    user_name: 'somebody',
    command: '/shepherd',
    text: opts.text,
    api_app_id: 'A0001',
    is_enterprise_install: 'false',
    response_url: 'https://hooks.slack.com/commands/T0001/12345678/abcdefghijkl',
    trigger_id: '13345224609.738474920.8088930838d88f008e0',
  };
}
