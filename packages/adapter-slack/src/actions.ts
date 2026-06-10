import type { PrId } from '@shepherd/core';

/**
 * The action-id schema: the contract between outbound messages (buttons the
 * notifier renders) and the inbound interaction handler. Slack wire format —
 * it lives here in the Slack adapter, never in core or delivery.
 */
export const ACTION_RETRY = 'shepherd:retry';
export const ACTION_MERGE_NOW = 'shepherd:merge_now';
export const ACTION_ABANDON = 'shepherd:abandon';
export const VIEW_ABANDON_CONFIRM = 'shepherd:abandon_confirm';
export const ACTION_PREFIX = /^shepherd:/;

/** Modal private_metadata payload (modals lose the originating channel otherwise). */
export interface AbandonModalMeta {
  prId: PrId;
  channelId: string | null;
}

function button(text: string, actionId: string, value: string, style?: 'primary' | 'danger') {
  return {
    type: 'button',
    text: { type: 'plain_text', text },
    action_id: actionId,
    value,
    ...(style ? { style } : {}),
  };
}

/** Buttons appended to escalation messages. */
export function escalationActionsBlock(prId: PrId): unknown {
  return {
    type: 'actions',
    block_id: 'shepherd_escalation_actions',
    elements: [
      button('Re-evaluate now', ACTION_RETRY, prId),
      button('Abandon…', ACTION_ABANDON, prId, 'danger'),
    ],
  };
}

/** Button appended to ready-to-merge messages. */
export function readyActionsBlock(prId: PrId): unknown {
  return {
    type: 'actions',
    block_id: 'shepherd_ready_actions',
    elements: [button('Merge when green', ACTION_MERGE_NOW, prId, 'primary')],
  };
}

/**
 * The close-confirmation modal (design doc §12/§15): abandoning is the only
 * manual hard-terminal, so it gets an explicit confirm + reason.
 */
export function abandonConfirmModal(prId: PrId, channelId: string | null): unknown {
  const meta: AbandonModalMeta = { prId, channelId };
  return {
    type: 'modal',
    callback_id: VIEW_ABANDON_CONFIRM,
    private_metadata: JSON.stringify(meta),
    title: { type: 'plain_text', text: 'Abandon PR?' },
    submit: { type: 'plain_text', text: 'Abandon' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `This permanently stops the shepherd for *${prId}*. The PR itself is not closed on GitHub.`,
        },
      },
      {
        type: 'input',
        block_id: 'reason',
        label: { type: 'plain_text', text: 'Why?' },
        element: {
          type: 'plain_text_input',
          action_id: 'reason',
          placeholder: { type: 'plain_text', text: 'superseded by #123' },
        },
      },
    ],
  };
}
