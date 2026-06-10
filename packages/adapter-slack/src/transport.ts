import { WebClient } from '@slack/web-api';
import { z } from 'zod';
import type { Destination, NotifierTransport, SlackBlocks } from '@shepherd/delivery';

const postResponseSchema = z.object({ ok: z.boolean(), error: z.string().optional() }).passthrough();

/**
 * Slack implementation of the generic delivery transport (§5.5).
 * `Destination.address` is a channel id or user id (DM).
 */
export class SlackNotifierTransport implements NotifierTransport {
  constructor(private readonly client: WebClient) {}

  static fromToken(botToken: string): SlackNotifierTransport {
    return new SlackNotifierTransport(new WebClient(botToken));
  }

  async send(dest: Destination, payload: SlackBlocks): Promise<void> {
    const raw = await this.client.chat.postMessage({
      channel: dest.address,
      text: payload.text,
      ...(payload.blocks ? { blocks: payload.blocks as never } : {}),
    });
    const res = postResponseSchema.parse(raw);
    if (!res.ok) throw new Error(`slack send failed: ${res.error ?? 'unknown error'}`);
  }
}
