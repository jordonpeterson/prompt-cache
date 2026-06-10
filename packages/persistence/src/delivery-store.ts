import { eq, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import type { BufferedEntry, DeliveryStore } from '@shepherd/delivery';
import { deliveryBuffer, deliverySent } from './schema.js';
import type { Db } from './repositories.js';

const deliveryItemSchema = z
  .object({
    destinations: z.array(z.object({ transport: z.string(), address: z.string() })),
    payload: z.object({ text: z.string(), blocks: z.array(z.unknown()).optional() }),
    actor: z.string().optional(),
    dedupKey: z.string().optional(),
  })
  .passthrough();

const itemsSchema = z.array(deliveryItemSchema);

/** Postgres twin of the in-memory store; owned by the delivery package (§9). */
export class DrizzleDeliveryStore implements DeliveryStore {
  constructor(private readonly db: Db) {}

  async getBuffer(key: string): Promise<BufferedEntry | null> {
    const rows = await this.db.select().from(deliveryBuffer).where(eq(deliveryBuffer.key, key)).limit(1);
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async putBuffer(entry: BufferedEntry): Promise<void> {
    const row = {
      key: entry.key,
      items: entry.items,
      firstAt: entry.firstAt,
      quietUntil: entry.quietUntil,
      hardCapAt: entry.hardCapAt,
    };
    await this.db.insert(deliveryBuffer).values(row).onConflictDoUpdate({ target: deliveryBuffer.key, set: row });
  }

  async deleteBuffer(key: string): Promise<void> {
    await this.db.delete(deliveryBuffer).where(eq(deliveryBuffer.key, key));
  }

  async listDueBuffers(now: Date): Promise<BufferedEntry[]> {
    const rows = await this.db
      .select()
      .from(deliveryBuffer)
      .where(or(lte(deliveryBuffer.quietUntil, now), lte(deliveryBuffer.hardCapAt, now)));
    return rows.map(toEntry);
  }

  async wasSent(dedupKey: string): Promise<boolean> {
    const rows = await this.db.select().from(deliverySent).where(eq(deliverySent.dedupKey, dedupKey)).limit(1);
    return rows.length > 0;
  }

  async markSent(dedupKey: string, at: Date): Promise<void> {
    await this.db.insert(deliverySent).values({ dedupKey, sentAt: at }).onConflictDoNothing();
  }
}

function toEntry(row: typeof deliveryBuffer.$inferSelect): BufferedEntry {
  return {
    key: row.key,
    items: itemsSchema.parse(row.items),
    firstAt: row.firstAt,
    quietUntil: row.quietUntil,
    hardCapAt: row.hardCapAt,
  };
}
