import { parse } from 'yaml';
import { makePrId, type CheckConclusion, type CheckRun, type PrRecord, type PrSnapshot } from '@shepherd/core';
import { buildWorld, makeSnapshot, type World, type WorldOptions } from './world.js';

/**
 * Declarative scenario fixtures (§13): a timeline of world mutations, ticks,
 * and expectations. Deterministic — injected clock, manual ticks, no network.
 *
 * ```yaml
 * pr: { repo: acme/web, number: 42, labels: [auto-shepherd] }
 * timeline:
 *   - { checks: { lint: failure }, tick: 1 }
 *   - expect: { remediation_triggered: eslint-autofix, state: awaiting_remediation }
 *   - { advance: 130s, headSha: def456, checks: { lint: pending }, tick: 1 }
 *   - { checks: { lint: success }, mergeable: mergeable, tick: 1 }
 *   - expect_terminal: merged
 * ```
 */
export interface Scenario {
  pr: {
    repo: string;
    number: number;
    labels?: string[];
    author?: string;
    draft?: boolean;
    headSha?: string;
    mergeable?: PrSnapshot['mergeable'];
    behindBase?: boolean;
    checks?: Record<string, string>;
    /** 'triggered' enrolls via the API path. */
    enrollment?: 'passive' | 'triggered';
    /** End action stamped on triggered enrollment (default 'merge'). */
    endAction?: 'merge' | 'notify_ready';
  };
  timeline: TimelineEntry[];
}

export type TimelineEntry =
  | { expect: Expectation }
  | { expect_terminal: string }
  | StepEntry;

export interface StepEntry {
  /** "130s" | "5m" | seconds */
  advance?: string | number;
  checks?: Record<string, string>;
  headSha?: string;
  mergeable?: PrSnapshot['mergeable'];
  behindBase?: boolean;
  isDraft?: boolean;
  state?: PrSnapshot['state'];
  lastActivityAt?: string;
  /** Number of controller ticks to run after applying mutations (default 1). */
  tick?: number | boolean;
}

export interface Expectation {
  state?: string;
  remediation_triggered?: string;
  escalated?: string; // substring of the escalation reason
  merged_on_host?: boolean;
  notified?: 'escalated' | 'ready' | 'merged';
  check_retries?: number;
  branch_updates?: number;
  remediation_triggers_total?: number;
}

export interface TimelinePoint {
  at: string;
  step: number;
  state: string;
  note?: string;
}

export interface ScenarioResult {
  world: World;
  prId: string;
  record: PrRecord;
  stateTimeline: TimelinePoint[];
}

function parseAdvance(v: string | number): number {
  if (typeof v === 'number') return v * 1000;
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(v.trim());
  if (!m) throw new Error(`bad advance: ${v}`);
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * factor;
}

function toChecks(spec: Record<string, string>): CheckRun[] {
  return Object.entries(spec).map(([name, conclusion]) => ({
    name,
    jobName: name,
    conclusion: conclusion === 'pending' ? null : (conclusion as CheckConclusion),
    completedAt: conclusion === 'pending' ? null : new Date(0),
    runId: `${name}-run`,
  }));
}

export async function runScenario(yamlText: string, worldOptions: WorldOptions = {}): Promise<ScenarioResult> {
  const scenario = parse(yamlText) as Scenario;
  const world = buildWorld(worldOptions);
  const { clock, codeHost, controller, prs, ingestion, audit, remediationService, notifier } = world;

  const prId = makePrId('github', scenario.pr.repo, scenario.pr.number);
  codeHost.setPr(
    makeSnapshot({
      id: prId,
      repo: scenario.pr.repo,
      number: scenario.pr.number,
      labels: scenario.pr.labels ?? [],
      author: scenario.pr.author ?? 'octocat',
      isDraft: scenario.pr.draft ?? false,
      headSha: scenario.pr.headSha ?? 'abc123',
      mergeable: scenario.pr.mergeable ?? 'mergeable',
      behindBase: scenario.pr.behindBase ?? false,
      checks: toChecks(scenario.pr.checks ?? {}),
      lastActivityAt: clock.now(),
    }),
  );
  const snapshot = (await codeHost.getPr(prId))!;
  await ingestion.ingest(
    snapshot,
    scenario.pr.enrollment === 'triggered'
      ? { source: 'api', endAction: { kind: scenario.pr.endAction ?? 'merge' } }
      : { source: 'label', campaignLabel: scenario.pr.labels?.[0] },
  );

  const stateTimeline: TimelinePoint[] = [];
  let auditCursor = 0;
  let stepNo = 0;

  const recordState = async (note?: string) => {
    const record = (await prs.get(prId))!;
    stateTimeline.push({ at: clock.now().toISOString(), step: stepNo, state: record.lifecycleState, note });
  };
  await recordState('ingested');

  for (const entry of scenario.timeline) {
    stepNo++;
    if ('expect' in entry || 'expect_terminal' in entry) {
      const record = (await prs.get(prId))!;
      const expectation: Expectation =
        'expect_terminal' in entry ? { state: entry.expect_terminal } : entry.expect;
      if ('expect_terminal' in entry && record.terminalAt === null) {
        throw failure(stepNo, `expected terminal state '${entry.expect_terminal}' but PR is not terminal (state=${record.lifecycleState})`, stateTimeline);
      }
      if (expectation.state && record.lifecycleState !== expectation.state) {
        throw failure(stepNo, `expected state '${expectation.state}', got '${record.lifecycleState}'`, stateTimeline);
      }
      if (expectation.remediation_triggered) {
        const events = (await audit.list(prId)).slice(auditCursor);
        const hit = events.find(
          (e) => e.type === 'remediation_triggered' && e.payload['defId'] === expectation.remediation_triggered,
        );
        if (!hit) {
          throw failure(stepNo, `expected remediation '${expectation.remediation_triggered}' to be triggered; audit since last expect: ${events.map((e) => e.type).join(', ') || '(none)'}`, stateTimeline);
        }
      }
      if (expectation.escalated !== undefined) {
        if (!record.escalation || !record.escalation.reason.includes(expectation.escalated)) {
          throw failure(stepNo, `expected escalation containing '${expectation.escalated}', got '${record.escalation?.reason ?? '(none)'}'`, stateTimeline);
        }
      }
      if (expectation.merged_on_host !== undefined) {
        const merged = codeHost.merges.some((m) => m.id === prId);
        if (merged !== expectation.merged_on_host) {
          throw failure(stepNo, `expected merged_on_host=${expectation.merged_on_host}, got ${merged}`, stateTimeline);
        }
      }
      if (expectation.notified) {
        if (!notifier.events.some((e) => e.kind === expectation.notified && e.prId === prId)) {
          throw failure(stepNo, `expected '${expectation.notified}' notification; got: ${notifier.events.map((e) => e.kind).join(', ') || '(none)'}`, stateTimeline);
        }
      }
      if (expectation.check_retries !== undefined) {
        const actual = codeHost.checkRetries.filter((r) => r.id === prId).length;
        if (actual !== expectation.check_retries) {
          throw failure(stepNo, `expected ${expectation.check_retries} check retr(ies), got ${actual}`, stateTimeline);
        }
      }
      if (expectation.branch_updates !== undefined) {
        const actual = codeHost.branchUpdates.filter((u) => u.id === prId).length;
        if (actual !== expectation.branch_updates) {
          throw failure(stepNo, `expected ${expectation.branch_updates} branch update(s), got ${actual}`, stateTimeline);
        }
      }
      if (expectation.remediation_triggers_total !== undefined) {
        const actual = remediationService.triggers.length;
        if (actual !== expectation.remediation_triggers_total) {
          throw failure(stepNo, `expected ${expectation.remediation_triggers_total} remediation trigger(s) total, got ${actual}`, stateTimeline);
        }
      }
      auditCursor = (await audit.list(prId)).length;
      continue;
    }

    const step = entry as StepEntry;
    if (step.advance !== undefined) clock.advance(parseAdvance(step.advance));
    const patch: Partial<PrSnapshot> = {};
    if (step.checks) patch.checks = toChecks(step.checks);
    if (step.headSha) patch.headSha = step.headSha;
    if (step.mergeable) patch.mergeable = step.mergeable;
    if (step.behindBase !== undefined) patch.behindBase = step.behindBase;
    if (step.isDraft !== undefined) patch.isDraft = step.isDraft;
    if (step.state) patch.state = step.state;
    if (step.lastActivityAt) patch.lastActivityAt = new Date(step.lastActivityAt);
    if (Object.keys(patch).length > 0) codeHost.mutatePr(prId, patch);

    const ticks = step.tick === undefined || step.tick === true ? 1 : step.tick === false ? 0 : step.tick;
    for (let i = 0; i < ticks; i++) {
      // Force the PR due: scenarios assert ordering, not cadence math.
      const record = (await prs.get(prId))!;
      if (record.terminalAt === null) {
        await prs.upsert({ ...record, nextReconcileAt: clock.now() });
      }
      await controller.tick(clock.now());
    }
    await recordState();
  }

  const record = (await prs.get(prId))!;
  return { world, prId, record, stateTimeline };
}

function failure(step: number, message: string, timeline: TimelinePoint[]): Error {
  const trail = timeline.map((p) => `  [${p.step}] ${p.at} ${p.state}${p.note ? ` (${p.note})` : ''}`).join('\n');
  return new Error(`scenario step ${step}: ${message}\nstate timeline so far:\n${trail}`);
}
