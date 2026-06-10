import { makePrId, type PrCommands, type PrId, type PrRecord } from '@shepherd/core';
import {
  ACTION_ABANDON,
  ACTION_MERGE_NOW,
  ACTION_PREFIX,
  ACTION_RETRY,
  VIEW_ABANDON_CONFIRM,
  abandonConfirmModal,
  type AbandonModalMeta,
} from './actions.js';
import {
  blockActionsPayloadSchema,
  inputValue,
  slashCommandPayloadSchema,
  viewSubmissionPayloadSchema,
} from './payloads.js';
import type { SlackAuthz } from './authz.js';
import type { SlackGateway } from './gateway.js';

export interface SlackUiDeps {
  commands: PrCommands;
  getRecord(prId: PrId): Promise<PrRecord | null>;
  authz: SlackAuthz;
  gateway: SlackGateway;
  /** App-provided: code-host lookup + ingestion. Returns a user-facing line. */
  enroll(repo: string, number: number, slackUserId: string, endAction?: 'merge' | 'notify_ready'): Promise<string>;
  /** App-provided: report service rendered to text. */
  digest(slackUserId: string): Promise<string>;
}

export interface SlashResponse {
  text: string;
  /** Slash responses default to ephemeral (visible only to the invoker). */
  ephemeral: boolean;
}

const USAGE = [
  'Usage:',
  '`/shepherd status <owner/repo>#<n>` — lifecycle state and detail',
  '`/shepherd track <owner/repo>#<n> [merge|notify]` — enroll a PR (default: merge)',
  '`/shepherd abandon <owner/repo>#<n> <reason…>` — stop shepherding permanently',
  '`/shepherd digest` — your triage-ordered digest',
].join('\n');

const PR_REF = /^([^\s/]+\/[^\s#]+)#(\d+)$/;

/**
 * The Slack driving adapter: parses interaction payloads at the trust
 * boundary and maps them onto domain commands. It never mutates lifecycle
 * state itself — buttons nudge `reconcileNow`, set end-actions, or invoke the
 * one manual hard-terminal (abandon, behind a confirmation modal).
 */
export class SlackInteractionHandler {
  constructor(private readonly deps: SlackUiDeps) {}

  /** block_actions: a button was clicked in one of our messages. */
  async onBlockAction(raw: unknown): Promise<void> {
    const payload = blockActionsPayloadSchema.parse(raw);
    const action = payload.actions.find((a) => ACTION_PREFIX.test(a.action_id));
    if (!action || !action.value) return; // not ours — ignore
    const prId = action.value;
    const userId = payload.user.id;
    const channelId = payload.channel?.id ?? null;

    const tell = async (text: string) => {
      if (channelId) await this.deps.gateway.postEphemeral(channelId, userId, text);
    };

    const record = await this.deps.getRecord(prId);
    if (!record) return tell(`:grey_question: ${prId} is not tracked (anymore).`);
    if (!this.deps.authz.mayAct(userId, record.author)) {
      return tell(`:no_entry: Only ${record.author} (the author) or an admin can act on ${prId}.`);
    }

    switch (action.action_id) {
      case ACTION_RETRY: {
        const result = await this.deps.commands.reconcileNow(prId, { actor: `slack:${userId}` });
        return tell(
          result.ok
            ? `:arrows_counterclockwise: Re-evaluating ${prId} now.`
            : `:no_entry: ${prId} is already terminal.`,
        );
      }
      case ACTION_MERGE_NOW: {
        const set = await this.deps.commands.setEndAction(prId, { kind: 'merge' }, { actor: `slack:${userId}` });
        if (!set.ok) return tell(`:no_entry: ${prId} is already terminal.`);
        await this.deps.commands.reconcileNow(prId, { actor: `slack:${userId}` });
        return tell(`:rocket: ${prId} will merge as soon as it is green and mergeable.`);
      }
      case ACTION_ABANDON: {
        // Hard-terminal → explicit confirmation modal, never one-click.
        await this.deps.gateway.openView(payload.trigger_id, abandonConfirmModal(prId, channelId));
        return;
      }
      default:
        return; // unknown shepherd action id (newer message than code) — ignore
    }
  }

  /** view_submission: the abandon-confirmation modal was submitted. */
  async onViewSubmission(raw: unknown): Promise<void> {
    const payload = viewSubmissionPayloadSchema.parse(raw);
    if (payload.view.callback_id !== VIEW_ABANDON_CONFIRM) return;
    const meta = JSON.parse(payload.view.private_metadata) as AbandonModalMeta;
    const userId = payload.user.id;
    const reason = inputValue(payload, 'reason', 'reason') ?? 'abandoned via Slack';

    const tell = async (text: string) => {
      if (meta.channelId) await this.deps.gateway.postEphemeral(meta.channelId, userId, text);
    };

    // Re-check authz at submit time: the modal could outlive a config change.
    const record = await this.deps.getRecord(meta.prId);
    if (!record) return tell(`:grey_question: ${meta.prId} is not tracked (anymore).`);
    if (!this.deps.authz.mayAct(userId, record.author)) {
      return tell(`:no_entry: Only ${record.author} (the author) or an admin can abandon ${meta.prId}.`);
    }

    const result = await this.deps.commands.abandon(meta.prId, { reason, actor: `slack:${userId}` });
    return tell(
      result.ok
        ? `:wastebasket: ${meta.prId} abandoned — the shepherd will not touch it again.`
        : `:no_entry: ${meta.prId} is already terminal.`,
    );
  }

  /** `/shepherd …` slash commands. */
  async onSlashCommand(raw: unknown): Promise<SlashResponse> {
    const payload = slashCommandPayloadSchema.parse(raw);
    const [sub = 'help', ...rest] = payload.text.trim().split(/\s+/).filter(Boolean);
    const userId = payload.user_id;

    switch (sub) {
      case 'status': {
        const ref = parseRef(rest[0]);
        if (!ref) return usage();
        const record = await this.deps.getRecord(ref.prId);
        if (!record) return { text: `${ref.prId} is not tracked.`, ephemeral: true };
        return { text: statusLine(record), ephemeral: true };
      }
      case 'track': {
        const ref = parseRef(rest[0]);
        if (!ref) return usage();
        const endAction = rest[1] === 'notify' ? 'notify_ready' : 'merge';
        const message = await this.deps.enroll(ref.repo, ref.number, userId, endAction);
        return { text: message, ephemeral: true };
      }
      case 'abandon': {
        const ref = parseRef(rest[0]);
        if (!ref) return usage();
        const reason = rest.slice(1).join(' ') || 'abandoned via /shepherd';
        const record = await this.deps.getRecord(ref.prId);
        if (!record) return { text: `${ref.prId} is not tracked.`, ephemeral: true };
        if (!this.deps.authz.mayAct(userId, record.author)) {
          return { text: `:no_entry: Only ${record.author} (the author) or an admin can abandon ${ref.prId}.`, ephemeral: true };
        }
        const result = await this.deps.commands.abandon(ref.prId, { reason, actor: `slack:${userId}` });
        return {
          text: result.ok ? `:wastebasket: ${ref.prId} abandoned.` : `${ref.prId} is already terminal.`,
          ephemeral: true,
        };
      }
      case 'digest':
        return { text: await this.deps.digest(userId), ephemeral: true };
      default:
        return usage();
    }
  }
}

function usage(): SlashResponse {
  return { text: USAGE, ephemeral: true };
}

function parseRef(token: string | undefined): { repo: string; number: number; prId: PrId } | null {
  if (!token) return null;
  const m = PR_REF.exec(token);
  if (!m) return null;
  const repo = m[1]!;
  const number = Number(m[2]);
  return { repo, number, prId: makePrId('github', repo, number) };
}

function statusLine(record: PrRecord): string {
  const lines = [`*${record.id}* — \`${record.lifecycleState}\` (${record.enrollment})`];
  if (record.remediation) {
    lines.push(
      `remediation: ${record.remediation.lastDefId} attempt ${record.remediation.attemptCount}, cooldown until ${record.remediation.cooldownUntil.toISOString()}`,
    );
  }
  if (record.escalation) lines.push(`escalated: ${record.escalation.reason}`);
  if (record.endAction) lines.push(`end action: ${record.endAction.kind}`);
  return lines.join('\n');
}
