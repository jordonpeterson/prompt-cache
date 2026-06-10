import { describe, expect, it } from 'vitest';
import {
  DefaultDeliveryService,
  InMemoryDeliveryStore,
  ListBotFilter,
  StaticIdentityMap,
  combinePayloads,
  type Destination,
  type NotifierTransport,
  type SlackBlocks,
} from '../src/index.js';

class RecordingTransport implements NotifierTransport {
  sends: Array<{ dest: Destination; payload: SlackBlocks }> = [];
  async send(dest: Destination, payload: SlackBlocks): Promise<void> {
    this.sends.push({ dest, payload });
  }
}

class TestClock {
  t = new Date('2026-01-01T00:00:00Z');
  now() {
    return new Date(this.t);
  }
  advance(s: number) {
    this.t = new Date(this.t.getTime() + s * 1000);
  }
}

const DEST: Destination = { transport: 'slack', address: 'U1' };
const POLICY = { quietSeconds: 60, hardCapSeconds: 300 };

function build() {
  const transport = new RecordingTransport();
  const clock = new TestClock();
  const service = new DefaultDeliveryService({ slack: transport }, new InMemoryDeliveryStore(), clock);
  return { transport, clock, service };
}

describe('notify', () => {
  it('sends immediately and dedupes on dedupKey', async () => {
    const { transport, service } = build();
    const req = { destinations: [DEST], payload: { text: 'hi' }, dedupKey: 'k1' };
    await service.notify(req);
    await service.notify(req);
    expect(transport.sends).toHaveLength(1);
  });

  it('throws on an unregistered transport', async () => {
    const { service } = build();
    await expect(
      service.notify({ destinations: [{ transport: 'pigeon', address: 'roof' }], payload: { text: 'x' } }),
    ).rejects.toThrow(/no transport/);
  });
});

describe('debounce math', () => {
  it('holds until the quiet window elapses', async () => {
    const { transport, clock, service } = build();
    await service.enqueueDebounced('k', { destinations: [DEST], payload: { text: 'a' } }, POLICY);
    clock.advance(30);
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(0);
    clock.advance(31);
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(1);
  });

  it('each new item extends the quiet window', async () => {
    const { transport, clock, service } = build();
    await service.enqueueDebounced('k', { destinations: [DEST], payload: { text: 'a' } }, POLICY);
    clock.advance(45);
    await service.enqueueDebounced('k', { destinations: [DEST], payload: { text: 'b' } }, POLICY);
    clock.advance(45); // 90s after first, but only 45s after second
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(0);
    clock.advance(16);
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(1);
    expect(transport.sends[0]!.payload.text).toBe('a\nb');
  });

  it('the hard cap fires even under constant chatter', async () => {
    const { transport, clock, service } = build();
    for (let i = 0; i < 10; i++) {
      await service.enqueueDebounced('k', { destinations: [DEST], payload: { text: `m${i}` } }, POLICY);
      clock.advance(40); // never 60s of quiet
    }
    // 400s elapsed > 300s hard cap
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(1);
  });

  it('combines destinations without duplicating sends', async () => {
    const { transport, clock, service } = build();
    await service.enqueueDebounced('k', { destinations: [DEST], payload: { text: 'a' } }, POLICY);
    await service.enqueueDebounced('k', { destinations: [DEST, { transport: 'slack', address: 'U2' }], payload: { text: 'b' } }, POLICY);
    clock.advance(61);
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(2); // U1 once, U2 once
  });

  it('dedups buffered items against already-sent keys', async () => {
    const { transport, clock, service } = build();
    await service.notify({ destinations: [DEST], payload: { text: 'x' }, dedupKey: 'dup' });
    await service.enqueueDebounced('k', { destinations: [DEST], payload: { text: 'x again' }, dedupKey: 'dup' }, POLICY);
    clock.advance(61);
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(1); // only the immediate one
  });
});

describe('bot filter', () => {
  it('drops bot actors at enqueue time', async () => {
    const { transport, clock, service } = build();
    await service.enqueueDebounced('k', { destinations: [DEST], payload: { text: 'noise' }, actor: 'dependabot[bot]' }, POLICY);
    clock.advance(61);
    await service.flushDue(clock.now());
    expect(transport.sends).toHaveLength(0);
  });

  it('deny list beats the heuristic; allow list beats the deny list', () => {
    const filter = new ListBotFilter(['ci-robot'], ['friendly[bot]']);
    expect(filter.isBot('ci-robot')).toBe(true);
    expect(filter.isBot('anything[bot]')).toBe(true);
    expect(filter.isBot('friendly[bot]')).toBe(false);
    expect(filter.isBot('octocat')).toBe(false);
  });
});

describe('identity map', () => {
  it('resolves known actors and falls back for strangers', () => {
    const map = new StaticIdentityMap({ octocat: DEST }, { transport: 'slack', address: '#general' });
    expect(map.resolve('octocat')).toEqual(DEST);
    expect(map.resolve('stranger').address).toBe('#general');
  });
});

describe('combinePayloads', () => {
  it('passes a single payload through untouched', () => {
    expect(combinePayloads([{ text: 'a', blocks: [1] }])).toEqual({ text: 'a', blocks: [1] });
  });

  it('joins text and synthesizes blocks for block-less payloads', () => {
    const combined = combinePayloads([{ text: 'a' }, { text: 'b', blocks: [{ type: 'divider' }] }]);
    expect(combined.text).toBe('a\nb');
    expect(combined.blocks).toHaveLength(2);
  });
});
