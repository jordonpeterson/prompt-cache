import type { PrRecord, ShepherdNotifier } from '@shepherd/core';
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
        ],
      },
      dedupKey: `escalated:${record.id}:${record.escalation?.at.toISOString() ?? reason}`,
    });
  }

  /** Ready/merged are routine: debounced into the author's batch. */
  async prReady(record: PrRecord): Promise<void> {
    const author = this.identity.resolve(record.author);
    await this.delivery.enqueueDebounced(
      `pr-events:${author.transport}:${author.address}`,
      {
        destinations: [author],
        payload: { text: `:white_check_mark: ${record.repo}#${record.number} is green and ready to merge.` },
        dedupKey: `ready:${record.id}:${record.lastInteractionAt.toISOString()}`,
      },
      this.debounce,
    );
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
