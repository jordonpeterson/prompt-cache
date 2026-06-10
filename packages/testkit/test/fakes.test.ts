import { describe, expect, it } from 'vitest';
import { FakeRemediationService, InMemoryIdempotencyStore } from '../src/fakes.js';

describe('FakeRemediationService — honors the §6 server contract', () => {
  it('dedupes on idempotencyKey: same key acks but never runs twice', async () => {
    const service = new FakeRemediationService();
    const req = {
      idempotencyKey: 'rem:github:a/b#1:sha:def:1',
      task: 'eslint-autofix',
      target: { repo: 'a/b', prNumber: 1, headRef: 'f', headSha: 'sha' },
    };
    expect((await service.trigger(req)).result).toBe('accepted');
    expect((await service.trigger(req)).result).toBe('accepted');
    expect(service.triggers).toHaveLength(1);
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('reserves exactly once per key', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.reserve('k')).toBe(true);
    expect(await store.reserve('k')).toBe(false);
    expect(await store.reserve('k2')).toBe(true);
  });
});
