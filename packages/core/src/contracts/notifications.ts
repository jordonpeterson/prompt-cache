import type { PrRecord } from './record.js';

/**
 * Structural twins of the generic delivery package's types. The core never
 * imports `@shepherd/delivery` — it emits these and the app wires them across
 * (structural typing makes them compatible).
 */
export interface NotifyDestination {
  transport: string;
  address: string;
}

export interface NotificationPayload {
  text: string;
  blocks?: unknown[];
}

export interface OutboundNotification {
  destinations: NotifyDestination[];
  payload: NotificationPayload;
  dedupKey?: string;
}

/**
 * The shepherd's thin domain-event seam toward delivery (§5.5). The app's
 * implementation owns templates, author-vs-admin routing, and debounce policy.
 */
export interface ShepherdNotifier {
  prEscalated(record: PrRecord, reason: string): Promise<void>;
  prReady(record: PrRecord): Promise<void>;
  prMerged(record: PrRecord): Promise<void>;
}

export interface ReportService {
  /** Triage-ordered daily digest. */
  buildDailyDigest(userId: string, now: Date): Promise<OutboundNotification>;
}
