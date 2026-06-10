import { describe, expect, it } from 'vitest';
import { globMatch, logPatternHits, phase1Matches } from '../src/remediation/matcher.js';
import { check } from './helpers.js';

describe('globMatch', () => {
  it('matches exact names without metacharacters', () => {
    expect(globMatch('lint', 'lint')).toBe(true);
    expect(globMatch('lint', 'lint-2')).toBe(false);
  });

  it('matches glob patterns', () => {
    expect(globMatch('build:*', 'build:linux')).toBe(true);
    expect(globMatch('build:*', 'test:linux')).toBe(false);
    expect(globMatch('*', 'anything')).toBe(true);
  });

  it('treats regex characters in the pattern as literals', () => {
    expect(globMatch('build(x)', 'build(x)')).toBe(true);
    expect(globMatch('build.x', 'buildyx')).toBe(false);
  });
});

describe('phase1Matches', () => {
  const checks = [check('lint', 'failure'), check('build', 'success'), check('e2e', null)];

  it('selects failing checks by name and conclusion', () => {
    expect(phase1Matches({ check: 'lint' }, checks).map((c) => c.name)).toEqual(['lint']);
  });

  it('defaults to failure/timed_out conclusions', () => {
    expect(phase1Matches({ check: '*' }, checks)).toHaveLength(1);
    expect(phase1Matches({ check: '*', conclusion: ['success'] }, checks).map((c) => c.name)).toEqual(['build']);
  });

  it('never selects pending checks', () => {
    expect(phase1Matches({ check: 'e2e' }, checks)).toHaveLength(0);
  });

  it('filters on job name when given', () => {
    expect(phase1Matches({ job: 'lint' }, checks)).toHaveLength(1);
    expect(phase1Matches({ job: 'nope' }, checks)).toHaveLength(0);
  });
});

describe('logPatternHits', () => {
  it('uses substring semantics for literal patterns', () => {
    expect(logPatternHits('eslint', 'ran eslint --fix and failed')).toBe(true);
    expect(logPatternHits('eslint', 'tsc error')).toBe(false);
  });

  it('supports bounded regex', () => {
    expect(logPatternHits('error TS\\d+', 'error TS2345: nope')).toBe(true);
  });

  it('fails closed on invalid regex', () => {
    expect(logPatternHits('([', 'anything ([ here')).toBe(false);
  });

  it('rejects oversized patterns', () => {
    expect(logPatternHits('x'.repeat(600), 'xxx')).toBe(false);
  });

  it('matches the tail when the log exceeds the size bound', () => {
    const log = 'a'.repeat(300_000) + 'NEEDLE';
    expect(logPatternHits('NEEDLE', log)).toBe(true);
  });
});
