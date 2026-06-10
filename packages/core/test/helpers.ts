import type { EffectiveConfig, PrRecord, PrSnapshot, RemediationDef } from '../src/index.js';

export function makeRecord(patch: Partial<PrRecord> = {}): PrRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'github:acme/web#42',
    repo: 'acme/web',
    number: 42,
    author: 'octocat',
    enrollment: 'passive',
    lifecycleState: 'evaluating',
    remediation: null,
    escalation: null,
    lastInteractionAt: now,
    ingestedAt: now,
    terminalAt: null,
    nextReconcileAt: now,
    ...patch,
  };
}

export function makeSnapshot(patch: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    id: 'github:acme/web#42',
    repo: 'acme/web',
    number: 42,
    author: 'octocat',
    isDraft: false,
    labels: [],
    state: 'open',
    mergeable: 'mergeable',
    behindBase: false,
    checks: [],
    baseRef: 'main',
    headRef: 'feature',
    headSha: 'abc123',
    lastActivityAt: new Date('2026-01-01T00:00:00Z'),
    ...patch,
  };
}

export function makeConfig(patch: Partial<EffectiveConfig> = {}): EffectiveConfig {
  return {
    remediations: [],
    guardrails: { disabledRemediationClasses: [], autoMergeAllowed: true },
    endActionDefault: 'notify_ready',
    keepBranchUpToDate: false,
    notifications: { quietSeconds: 120, hardCapSeconds: 1800 },
    staleness: { escalateAfterDays: 30 },
    ...patch,
  };
}

export function makeDef(patch: Partial<RemediationDef> & Pick<RemediationDef, 'id'>): RemediationDef {
  return {
    description: patch.id,
    class: 'mechanical',
    match: { check: '*' },
    response: { kind: 'external', task: patch.id },
    priority: 50,
    cooldownSeconds: 120,
    maxAttempts: 2,
    ...patch,
  };
}

export function check(name: string, conclusion: PrSnapshot['checks'][number]['conclusion'], runId = `${name}-run`) {
  return { name, jobName: name, conclusion, completedAt: conclusion ? new Date(0) : null, runId };
}
