import type {
  BufferedEntry,
  ClockLike,
  DebouncePolicy,
  DeliveryItem,
  DeliveryRequest,
  DeliveryService,
  DeliveryStore,
  Destination,
  NotifierTransport,
  SlackBlocks,
} from './types.js';

export interface BotFilter {
  isBot(actor: string): boolean;
}

/** Start with an allow/deny list of bot actors; no classification yet (known debt). */
export class ListBotFilter implements BotFilter {
  constructor(
    private readonly denyList: string[] = [],
    private readonly allowList: string[] = [],
  ) {}

  isBot(actor: string): boolean {
    if (this.allowList.includes(actor)) return false;
    if (this.denyList.includes(actor)) return true;
    return /\[bot\]$/i.test(actor);
  }
}

export class DefaultDeliveryService implements DeliveryService {
  constructor(
    private readonly transports: Record<string, NotifierTransport>,
    private readonly store: DeliveryStore,
    private readonly clock: ClockLike,
    private readonly botFilter: BotFilter = new ListBotFilter(),
  ) {}

  async notify(req: DeliveryRequest): Promise<void> {
    if (req.dedupKey) {
      if (await this.store.wasSent(req.dedupKey)) return;
    }
    for (const dest of req.destinations) {
      await this.send(dest, req.payload);
    }
    if (req.dedupKey) await this.store.markSent(req.dedupKey, this.clock.now());
  }

  async enqueueDebounced(key: string, item: DeliveryItem, policy: DebouncePolicy): Promise<void> {
    if (item.actor && this.botFilter.isBot(item.actor)) return; // bot noise stops here
    const now = this.clock.now();
    const existing = await this.store.getBuffer(key);
    if (!existing) {
      await this.store.putBuffer({
        key,
        items: [item],
        firstAt: now,
        quietUntil: new Date(now.getTime() + policy.quietSeconds * 1000),
        hardCapAt: new Date(now.getTime() + policy.hardCapSeconds * 1000),
      });
      return;
    }
    // Each new item extends the quiet window, but never past the hard cap.
    const quiet = Math.min(now.getTime() + policy.quietSeconds * 1000, existing.hardCapAt.getTime());
    await this.store.putBuffer({
      ...existing,
      items: [...existing.items, item],
      quietUntil: new Date(quiet),
    });
  }

  async flushDue(now: Date): Promise<void> {
    const due = await this.store.listDueBuffers(now);
    for (const entry of due) {
      await this.store.deleteBuffer(entry.key); // delete first: a send crash loses a batch, never duplicates it
      const fresh = await this.dedupe(entry.items);
      if (fresh.length === 0) continue;
      const combined = combinePayloads(fresh.map((i) => i.payload));
      for (const dest of uniqueDestinations(fresh.flatMap((i) => i.destinations))) {
        await this.send(dest, combined);
      }
      for (const item of fresh) {
        if (item.dedupKey) await this.store.markSent(item.dedupKey, now);
      }
    }
  }

  private async dedupe(items: DeliveryItem[]): Promise<DeliveryItem[]> {
    const out: DeliveryItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item.dedupKey) {
        if (seen.has(item.dedupKey)) continue;
        if (await this.store.wasSent(item.dedupKey)) continue;
        seen.add(item.dedupKey);
      }
      out.push(item);
    }
    return out;
  }

  private async send(dest: Destination, payload: SlackBlocks): Promise<void> {
    const transport = this.transports[dest.transport];
    if (!transport) throw new Error(`no transport registered for '${dest.transport}'`);
    await transport.send(dest, payload);
  }
}

export function combinePayloads(payloads: SlackBlocks[]): SlackBlocks {
  if (payloads.length === 1) return payloads[0]!;
  return {
    text: payloads.map((p) => p.text).join('\n'),
    blocks: payloads.flatMap((p) => p.blocks ?? [{ type: 'section', text: { type: 'mrkdwn', text: p.text } }]),
  };
}

function uniqueDestinations(dests: Destination[]): Destination[] {
  const seen = new Set<string>();
  return dests.filter((d) => {
    const k = `${d.transport}:${d.address}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Config-backed identity map: external actor → destination, with a fallback. */
export class StaticIdentityMap {
  constructor(
    private readonly mapping: Record<string, Destination>,
    private readonly fallback: Destination,
  ) {}

  resolve(actor: string): Destination {
    return this.mapping[actor] ?? this.fallback;
  }
}

/** In-memory store — tests and local dev. The PG-backed twin lives in @shepherd/persistence. */
export class InMemoryDeliveryStore implements DeliveryStore {
  private buffers = new Map<string, BufferedEntry>();
  private sent = new Map<string, Date>();

  async getBuffer(key: string): Promise<BufferedEntry | null> {
    return this.buffers.get(key) ?? null;
  }
  async putBuffer(entry: BufferedEntry): Promise<void> {
    this.buffers.set(entry.key, entry);
  }
  async deleteBuffer(key: string): Promise<void> {
    this.buffers.delete(key);
  }
  async listDueBuffers(now: Date): Promise<BufferedEntry[]> {
    return [...this.buffers.values()].filter(
      (e) => e.quietUntil.getTime() <= now.getTime() || e.hardCapAt.getTime() <= now.getTime(),
    );
  }
  async wasSent(dedupKey: string): Promise<boolean> {
    return this.sent.has(dedupKey);
  }
  async markSent(dedupKey: string, at: Date): Promise<void> {
    this.sent.set(dedupKey, at);
  }
}
