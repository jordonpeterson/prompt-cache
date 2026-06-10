import { describe, expect, it } from 'vitest';
import { DefaultMergePolicy } from '../src/merge/policy.js';
import { check, makeConfig, makeRecord, makeSnapshot } from './helpers.js';

const policy = new DefaultMergePolicy();

describe('DefaultMergePolicy', () => {
  it('waits while checks are pending', () => {
    const s = makeSnapshot({ checks: [check('lint', null)] });
    expect(policy.decide(makeRecord(), s, makeConfig())).toEqual({ action: 'wait' });
  });

  it('waits on failing checks (remediation engine territory)', () => {
    const s = makeSnapshot({ checks: [check('lint', 'failure')] });
    expect(policy.decide(makeRecord(), s, makeConfig())).toEqual({ action: 'wait' });
  });

  it('waits on conflicts (remediation engine territory)', () => {
    const s = makeSnapshot({ mergeable: 'conflicting' });
    expect(policy.decide(makeRecord(), s, makeConfig())).toEqual({ action: 'wait' });
  });

  it("waits while GitHub's verdict is unknown — the hard gate", () => {
    const s = makeSnapshot({ checks: [check('lint', 'success')], mergeable: 'unknown' });
    expect(policy.decide(makeRecord(), s, makeConfig())).toEqual({ action: 'wait' });
  });

  it('updates the branch when behind and keepBranchUpToDate is on', () => {
    const s = makeSnapshot({ checks: [check('lint', 'success')], behindBase: true });
    expect(policy.decide(makeRecord(), s, makeConfig({ keepBranchUpToDate: true }))).toEqual({
      action: 'update_branch',
    });
  });

  it('merges when green + mergeable + end-action merge', () => {
    const s = makeSnapshot({ checks: [check('lint', 'success')] });
    const r = makeRecord({ endAction: { kind: 'merge' } });
    expect(policy.decide(r, s, makeConfig())).toEqual({ action: 'merge' });
  });

  it('falls back to the configured default end-action for passive PRs', () => {
    const s = makeSnapshot({ checks: [check('lint', 'success')] });
    expect(policy.decide(makeRecord(), s, makeConfig({ endActionDefault: 'merge' }))).toEqual({ action: 'merge' });
    expect(policy.decide(makeRecord(), s, makeConfig())).toEqual({ action: 'notify_ready' });
  });

  it('never merges past the autoMergeAllowed guardrail', () => {
    const s = makeSnapshot({ checks: [check('lint', 'success')] });
    const r = makeRecord({ endAction: { kind: 'merge' } });
    const cfg = makeConfig({ guardrails: { disabledRemediationClasses: [], autoMergeAllowed: false } });
    expect(policy.decide(r, s, cfg)).toEqual({ action: 'notify_ready' });
  });

  it('treats neutral conclusions as green', () => {
    const s = makeSnapshot({ checks: [check('lint', 'success'), check('optional', 'neutral')] });
    expect(policy.decide(makeRecord({ endAction: { kind: 'merge' } }), s, makeConfig())).toEqual({ action: 'merge' });
  });
});
