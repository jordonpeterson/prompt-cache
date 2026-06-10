import { describe, expect, it } from 'vitest';
import { makePrId, mergeKey, remediationKey, updateBranchKey } from '../src/contracts/ids.js';

describe('idempotency keys are tool-generated and deterministic (§8)', () => {
  it('formats match the design doc exactly', () => {
    const prId = makePrId('github', 'acme/web', 42);
    expect(prId).toBe('github:acme/web#42');
    expect(remediationKey(prId, 'abc123', 'eslint-autofix', 2)).toBe(
      'rem:github:acme/web#42:abc123:eslint-autofix:2',
    );
    expect(mergeKey(prId, 'abc123')).toBe('merge:github:acme/web#42:abc123');
    expect(updateBranchKey(prId, 'abc123')).toBe('ub:github:acme/web#42:abc123');
  });

  it('same inputs ⇒ same key; any moved part ⇒ different key', () => {
    const a = remediationKey('github:acme/web#42', 'sha1', 'def', 1);
    expect(remediationKey('github:acme/web#42', 'sha1', 'def', 1)).toBe(a);
    expect(remediationKey('github:acme/web#42', 'sha2', 'def', 1)).not.toBe(a); // new head = new firing
    expect(remediationKey('github:acme/web#42', 'sha1', 'def', 2)).not.toBe(a); // new attempt
    expect(remediationKey('github:acme/web#42', 'sha1', 'other', 1)).not.toBe(a); // keyed on def, not check
  });
});
