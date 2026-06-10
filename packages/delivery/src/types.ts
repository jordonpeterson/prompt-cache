/**
 * GENERIC delivery package (§5.5): notification transport, debounce, identity.
 * No PR concepts leak into these interfaces — consumers map their domain
 * events onto DeliveryRequest/DeliveryItem themselves.
 */

export interface Destination {
  /** Transport discriminator, e.g. 'slack'. */
  transport: string;
  /** Transport-specific address, e.g. a Slack channel or user id. */
  address: string;
}

/** Named for its primary transport, shaped generically: text + optional Block Kit blocks. */
export interface SlackBlocks {
  text: string;
  blocks?: unknown[];
}

export interface DeliveryRequest {
  destinations: Destination[];
  payload: SlackBlocks;
  /** Suppresses repeat sends of the same logical notification. */
  dedupKey?: string;
}

export interface DeliveryItem {
  destinations: Destination[];
  payload: SlackBlocks;
  /** Originating actor (e.g. a GitHub login) — bot-filtered inside delivery. */
  actor?: string;
  dedupKey?: string;
}

export interface DebouncePolicy {
  /** Flush after this much quiet (no new items). */
  quietSeconds: number;
  /** ...but never hold longer than this from the first item. */
  hardCapSeconds: number;
}

export interface DeliveryService {
  /** Immediate send (dedup + bot-filter still apply). */
  notify(req: DeliveryRequest): Promise<void>;
  enqueueDebounced(key: string, item: DeliveryItem, policy: DebouncePolicy): Promise<void>;
  /** Tick-driven: flush buffers past their quiet window OR hard cap. */
  flushDue(now: Date): Promise<void>;
}

/** Implemented by transport adapters (e.g. @shepherd/adapter-slack). */
export interface NotifierTransport {
  send(dest: Destination, payload: SlackBlocks): Promise<void>;
}

/** Maps an external actor (e.g. GitHub login) to a destination; many-to-one. */
export interface IdentityMap {
  resolve(actor: string): Destination;
}

export interface BufferedEntry {
  key: string;
  items: DeliveryItem[];
  firstAt: Date;
  quietUntil: Date;
  hardCapAt: Date;
}

/** Storage the delivery package owns (its own Postgres tables in production). */
export interface DeliveryStore {
  getBuffer(key: string): Promise<BufferedEntry | null>;
  putBuffer(entry: BufferedEntry): Promise<void>;
  deleteBuffer(key: string): Promise<void>;
  listDueBuffers(now: Date): Promise<BufferedEntry[]>;
  wasSent(dedupKey: string): Promise<boolean>;
  markSent(dedupKey: string, at: Date): Promise<void>;
}

export interface ClockLike {
  now(): Date;
}
