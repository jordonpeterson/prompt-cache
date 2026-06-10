import type { PrRecord, ShepherdNotifier } from '@shepherd/core';
import { escalationActionsBlock, readyActionsBlock } from '@shepherd/adapter-slack';
import type { DebouncePolicy, DeliveryService, Destination, IdentityMap } from '@shepherd/delivery';

/**
 * The shepherd's thin domain layer toward delivery (§5.5): owns templates and
 * author-vs-admin routing. No PR concepts leak into the delivery package.
 */
export class DeliveryShepherdNotifier implements ShepherdNotifier {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly identity: IdentityMap,
    private readonly admin: Destination,
    private readonly debounce: DebouncePolicy,
  ) {}

  /** Escalations interrupt: immediate send to author AND admins, deduped per escalation. */
  async prEscalated(record: PrRecord, reason: string): Promise<void> {
    const author = this.identity.resolve(record.author);
    await this.delivery.notify({
      destinations: dedupe([author, this.admin]),
      payload: {
        text: `:rotating_light: ${record.repo}#${record.number} needs a human — ${reason}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:rotating_light: *${record.repo}#${record.number}* escalated\n>${reason}\nShepherd has paused autonomous actions; push a commit to resume.`,
            },
          },
          // Slack-as-UI: buttons route back through the interaction handler.
          escalationActionsBlock(record.id),
        ],
      },
      dedupKey: `escalated:${record.id}:${record.escalation?.at.toISOString() ?? reason}`,
    });
  }

  /** Ready is interactive (it carries a button), so it sends immediately, not debounced. */
  async prReady(record: PrRecord): Promise<void> {
    const author = this.identity.resolve(record.author);
    const text = `:white_check_mark: ${record.repo}#${record.number} is green and ready to merge.`;
    await this.delivery.notify({
      destinations: [author],
      payload: {
        text,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text } },
          readyActionsBlock(record.id),
        ],
      },
      dedupKey: `ready:${record.id}:${record.lastInteractionAt.toISOString()}`,
    });
  }

  async prMerged(record: PrRecord): Promise<void> {
    const author = this.identity.resolve(record.author);
    await this.delivery.enqueueDebounced(
      `pr-events:${author.transport}:${author.address}`,
      {
        destinations: [author],
        payload: { text: `:tada: ${record.repo}#${record.number} merged by shepherd.` },
        dedupKey: `merged:${record.id}`,
      },
      this.debounce,
    );
  }
}

function dedupe(dests: Destination[]): Destination[] {
  const seen = new Set<string>();
  return dests.filter((d) => {
    const k = `${d.transport}:${d.address}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
