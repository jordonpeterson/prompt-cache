import { describe, expect, it } from 'vitest';
import { DefaultRemediationEngine } from '../src/remediation/engine.js';
import type { LogSource } from '../src/index.js';
import { check, makeConfig, makeDef, makeRecord, makeSnapshot } from './helpers.js';

function logSource(logs: Record<string, string> = {}): LogSource & { fetches: string[] } {
  const fetches: string[] = [];
  return {
    fetches,
    async getJobLogs(_id, runId) {
      fetches.push(runId);
      return logs[runId] ?? '';
    },
  };
}

const eslintDef = makeDef({ id: 'eslint-autofix', match: { check: 'lint*' }, priority: 20 });
const conflictDef = makeDef({
  id: 'conflict-rebase',
  class: 'conflict',
  match: { signal: 'conflict' },
  priority: 10,
  maxAttempts: 1,
});

describe('DefaultRemediationEngine', () => {
  it('noops when there is nothing to remediate', async () => {
    const engine = new DefaultRemediationEngine(logSource());
    const decision = await engine.evaluate(
      makeRecord(),
      makeSnapshot({ checks: [check('lint', 'success'), check('e2e', null)] }),
      makeConfig({ remediations: [eslintDef] }),
    );
    expect(decision).toEqual({ kind: 'noop' });
  });

  it('returns ONE def-level decision when several checks match the same def', async () => {
    const engine = new DefaultRemediationEngine(logSource());
    const decision = await engine.evaluate(
      makeRecord(),
      makeSnapshot({ checks: [check('lint-1', 'failure'), check('lint-2', 'failure'), check('lint-3', 'failure')] }),
      makeConfig({ remediations: [eslintDef] }),
    );
    expect(decision).toEqual({ kind: 'response', defId: 'eslint-autofix', action: eslintDef.response });
  });

  it('attacks the highest-priority match first (conflict is tightest-leash)', async () => {
    const engine = new DefaultRemediationEngine(logSource());
    const decision = await engine.evaluate(
      makeRecord(),
      makeSnapshot({ mergeable: 'conflicting', checks: [check('lint', 'failure')] }),
      makeConfig({ remediations: [conflictDef, eslintDef] }),
    );
    expect(decision).toMatchObject({ kind: 'response', defId: 'conflict-rebase' });
  });

  it('escalates unmatched signals — the default case never drops silently', async () => {
    const engine = new DefaultRemediationEngine(logSource());
    const decision = await engine.evaluate(
      makeRecord(),
      makeSnapshot({ checks: [check('security-scan', 'failure')] }),
      makeConfig({ remediations: [eslintDef] }),
    );
    expect(decision).toMatchObject({ kind: 'escalate' });
    expect((decision as { reason: string }).reason).toContain('security-scan');
  });

  it('escalates when a def is out of attempts', async () => {
    const engine = new DefaultRemediationEngine(logSource());
    const record = makeRecord({
      remediation: {
        lastDefId: 'eslint-autofix',
        triggeredAt: new Date(0),
        cooldownUntil: new Date(0),
        attemptCount: 2, // == maxAttempts
      },
    });
    const decision = await engine.evaluate(
      record,
      makeSnapshot({ checks: [check('lint', 'failure')] }),
      makeConfig({ remediations: [eslintDef] }),
    );
    expect(decision).toMatchObject({ kind: 'escalate' });
    expect((decision as { reason: string }).reason).toContain('exhausted');
  });

  it('resets attempt accounting when a different def matches', async () => {
    const engine = new DefaultRemediationEngine(logSource());
    const record = makeRecord({
      remediation: { lastDefId: 'other-def', triggeredAt: new Date(0), cooldownUntil: new Date(0), attemptCount: 5 },
    });
    const decision = await engine.evaluate(
      record,
      makeSnapshot({ checks: [check('lint', 'failure')] }),
      makeConfig({ remediations: [eslintDef] }),
    );
    expect(decision).toMatchObject({ kind: 'response', defId: 'eslint-autofix' });
  });

  describe('phase 2 (logPattern)', () => {
    const patternDef = makeDef({ id: 'eslint-autofix', match: { check: 'lint', logPattern: 'eslint' } });

    it('fetches logs only for phase-1 matches and confirms the pattern', async () => {
      const logs = logSource({ 'lint-run': 'oops: eslint found problems' });
      const engine = new DefaultRemediationEngine(logs);
      const decision = await engine.evaluate(
        makeRecord(),
        makeSnapshot({ checks: [check('lint', 'failure'), check('build', 'failure')] }),
        makeConfig({ remediations: [patternDef] }),
      );
      expect(decision).toMatchObject({ kind: 'response', defId: 'eslint-autofix' });
      expect(logs.fetches).toEqual(['lint-run']); // build's logs never fetched
    });

    it('a non-matching log keeps the def out so the real failure escalates', async () => {
      const logs = logSource({ 'lint-run': 'tsc exploded — type errors, autofix cannot help' });
      const engine = new DefaultRemediationEngine(logs);
      const decision = await engine.evaluate(
        makeRecord(),
        makeSnapshot({ checks: [check('lint', 'failure')] }),
        makeConfig({ remediations: [patternDef] }),
      );
      expect(decision).toMatchObject({ kind: 'escalate' });
    });

    it('does no I/O at all when no matched def declares a pattern', async () => {
      const logs = logSource();
      const engine = new DefaultRemediationEngine(logs);
      await engine.evaluate(
        makeRecord(),
        makeSnapshot({ checks: [check('lint', 'failure')] }),
        makeConfig({ remediations: [eslintDef] }),
      );
      expect(logs.fetches).toEqual([]);
    });
  });

  it('skips guardrail-disabled classes defensively', async () => {
    const engine = new DefaultRemediationEngine(logSource());
    const decision = await engine.evaluate(
      makeRecord(),
      makeSnapshot({ mergeable: 'conflicting' }),
      makeConfig({
        remediations: [conflictDef],
        guardrails: { disabledRemediationClasses: ['conflict'], autoMergeAllowed: true },
      }),
    );
    expect(decision).toMatchObject({ kind: 'escalate' });
  });
});
