import { describe, expect, it, vi } from 'vitest';
import type { WebClient } from '@slack/web-api';
import { SlackNotifierTransport } from '../src/transport.js';

function stubClient(response: Record<string, unknown>) {
  const postMessage = vi.fn(async () => response);
  return { client: { chat: { postMessage } } as unknown as WebClient, postMessage };
}

const DEST = { transport: 'slack', address: 'C123' };

describe('SlackNotifierTransport', () => {
  it('posts text and blocks to the destination channel', async () => {
    const { client, postMessage } = stubClient({ ok: true, ts: '1.2', channel: 'C123' });
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }];
    await new SlackNotifierTransport(client).send(DEST, { text: 'hi', blocks });
    expect(postMessage).toHaveBeenCalledWith({ channel: 'C123', text: 'hi', blocks });
  });

  it('omits blocks entirely when not provided', async () => {
    const { client, postMessage } = stubClient({ ok: true });
    await new SlackNotifierTransport(client).send(DEST, { text: 'plain' });
    expect(postMessage).toHaveBeenCalledWith({ channel: 'C123', text: 'plain' });
  });

  it('surfaces ok:false as an error with the Slack reason', async () => {
    const { client } = stubClient({ ok: false, error: 'channel_not_found' });
    await expect(new SlackNotifierTransport(client).send(DEST, { text: 'x' })).rejects.toThrow(/channel_not_found/);
  });

  it('tolerates forward-compatible extra response fields', async () => {
    const { client } = stubClient({ ok: true, message: { ts: '1' }, response_metadata: {} });
    await expect(new SlackNotifierTransport(client).send(DEST, { text: 'x' })).resolves.toBeUndefined();
  });
});
