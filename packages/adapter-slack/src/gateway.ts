import { WebClient } from '@slack/web-api';
import { z } from 'zod';

/**
 * The small slice of the Slack Web API the inbound UI needs beyond plain
 * message sending (which goes through the delivery transport). Faked in
 * tests; implemented over WebClient in production.
 */
export interface SlackGateway {
  openView(triggerId: string, view: unknown): Promise<void>;
  postEphemeral(channelId: string, userId: string, text: string): Promise<void>;
}

const okSchema = z.object({ ok: z.boolean(), error: z.string().optional() }).passthrough();

export class WebApiSlackGateway implements SlackGateway {
  constructor(private readonly client: WebClient) {}

  static fromToken(botToken: string): WebApiSlackGateway {
    return new WebApiSlackGateway(new WebClient(botToken));
  }

  async openView(triggerId: string, view: unknown): Promise<void> {
    const res = okSchema.parse(await this.client.views.open({ trigger_id: triggerId, view: view as never }));
    if (!res.ok) throw new Error(`views.open failed: ${res.error ?? 'unknown error'}`);
  }

  async postEphemeral(channelId: string, userId: string, text: string): Promise<void> {
    const res = okSchema.parse(await this.client.chat.postEphemeral({ channel: channelId, user: userId, text }));
    if (!res.ok) throw new Error(`chat.postEphemeral failed: ${res.error ?? 'unknown error'}`);
  }
}

/** Recording fake — the hermetic stand-in, same pattern as delivery's in-memory store. */
export class FakeSlackGateway implements SlackGateway {
  readonly openedViews: Array<{ triggerId: string; view: unknown }> = [];
  readonly ephemerals: Array<{ channelId: string; userId: string; text: string }> = [];

  async openView(triggerId: string, view: unknown): Promise<void> {
    this.openedViews.push({ triggerId, view: structuredClone(view) });
  }

  async postEphemeral(channelId: string, userId: string, text: string): Promise<void> {
    this.ephemerals.push({ channelId, userId, text });
  }
}
