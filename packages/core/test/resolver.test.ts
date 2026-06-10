import { describe, expect, it } from 'vitest';
import { CascadeConfigResolver } from '../src/config/resolver.js';
import { makeDef } from './helpers.js';

const catalog = [
  makeDef({ id: 'eslint-autofix', priority: 20 }),
  makeDef({ id: 'conflict-rebase', class: 'conflict', priority: 10, match: { signal: 'conflict' } }),
];

describe('CascadeConfigResolver — preferences (most-specific-wins)', () => {
  it('applies pr > user > org > default', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      { layer: 'default', preferences: { staleEscalateAfterDays: 30, endActionDefault: 'notify_ready' } },
      { layer: 'user', preferences: { staleEscalateAfterDays: 14 } },
    ]);
    const cfg = resolver.resolve('pr-1', { staleEscalateAfterDays: 7 });
    expect(cfg.staleness.escalateAfterDays).toBe(7);
    expect(cfg.endActionDefault).toBe('notify_ready'); // untouched by upper layers
  });

  it('treats unset as "no override", not as default', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      { layer: 'default', preferences: { keepBranchUpToDate: true } },
      { layer: 'user', preferences: {} }, // says nothing about keepBranchUpToDate
    ]);
    expect(resolver.resolve('pr-1').keepBranchUpToDate).toBe(true);
  });

  it('applies per-def cooldown/attempt overrides without changing behavior', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      {
        layer: 'default',
        preferences: {
          enabledRemediations: ['eslint-autofix'],
          remediationOverrides: { 'eslint-autofix': { cooldownSeconds: 999 } },
        },
      },
    ]);
    const cfg = resolver.resolve('pr-1');
    expect(cfg.remediations).toHaveLength(1);
    expect(cfg.remediations[0]!.cooldownSeconds).toBe(999);
    expect(cfg.remediations[0]!.response).toEqual({ kind: 'external', task: 'eslint-autofix' });
  });

  it('sorts enabled defs by priority', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      { layer: 'default', preferences: { enabledRemediations: ['eslint-autofix', 'conflict-rebase'] } },
    ]);
    expect(resolver.resolve('pr-1').remediations.map((d) => d.id)).toEqual(['conflict-rebase', 'eslint-autofix']);
  });
});

describe('CascadeConfigResolver — guardrails (most-restrictive-wins)', () => {
  it('org class disable removes defs even when a lower layer enables them', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      { layer: 'default', preferences: { enabledRemediations: ['conflict-rebase', 'eslint-autofix'] } },
      { layer: 'org', guardrails: { disabledRemediationClasses: ['conflict'] } },
    ]);
    const cfg = resolver.resolve('pr-1');
    expect(cfg.remediations.map((d) => d.id)).toEqual(['eslint-autofix']);
    expect(cfg.guardrails.disabledRemediationClasses).toEqual(['conflict']);
  });

  it('autoMergeAllowed=false at any layer cannot be loosened by a more specific one', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      { layer: 'org', guardrails: { autoMergeAllowed: false } },
      { layer: 'user', guardrails: { autoMergeAllowed: true } },
    ]);
    expect(resolver.resolve('pr-1').guardrails.autoMergeAllowed).toBe(false);
  });
});

describe('CascadeConfigResolver — explain (provenance)', () => {
  it('reports value + source layer per field', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      { layer: 'default', preferences: { staleEscalateAfterDays: 30 } },
      { layer: 'user', preferences: { staleEscalateAfterDays: 14 } },
      { layer: 'org', guardrails: { autoMergeAllowed: false } },
    ]);
    const explained = resolver.explain('pr-1', { keepBranchUpToDate: true });
    expect(explained['staleEscalateAfterDays']).toEqual({ value: 14, source: 'user' });
    expect(explained['keepBranchUpToDate']).toEqual({ value: true, source: 'pr' });
    expect(explained['endActionDefault']!.source).toBe('default');
    expect(explained['autoMergeAllowed']).toEqual({ value: false, source: 'org' });
  });
});

describe('CascadeConfigResolver — catalog integrity', () => {
  it('rejects duplicate def ids', () => {
    expect(() => new CascadeConfigResolver([makeDef({ id: 'a' }), makeDef({ id: 'a' })], [])).toThrow(/duplicate/);
  });

  it('ignores enabled ids that are not in the catalog', () => {
    const resolver = new CascadeConfigResolver(catalog, [
      { layer: 'default', preferences: { enabledRemediations: ['ghost', 'eslint-autofix'] } },
    ]);
    expect(resolver.resolve('pr-1').remediations.map((d) => d.id)).toEqual(['eslint-autofix']);
  });
});
