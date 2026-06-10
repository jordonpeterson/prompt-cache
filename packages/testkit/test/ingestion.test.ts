import { describe, expect, it } from 'vitest';
import { EnrollmentScanner } from '@shepherd/core';
import { buildWorld, makeSnapshot } from '../src/world.js';

function seed(world: ReturnType<typeof buildWorld>, id: string, patch: Record<string, unknown> = {}) {
  const number = Number(id.split('#')[1]);
  world.codeHost.setPr(makeSnapshot({ id, repo: 'acme/web', number, ...(patch as object) }));
}

describe('DefaultIngestionService', () => {
  it('creates a passive record from a label trigger with audit', async () => {
    const world = buildWorld();
    seed(world, 'github:acme/web#1', { labels: ['auto-shepherd'] });
    const snap = (await world.codeHost.getPr('github:acme/web#1'))!;
    const record = await world.ingestion.ingest(snap, { source: 'label', campaignLabel: 'auto-shepherd' });

    expect(record).toMatchObject({
      enrollment: 'passive',
      matchedBy: 'label',
      campaignLabel: 'auto-shepherd',
      lifecycleState: 'tracked',
    });
    expect(record.nextReconcileAt).toEqual(world.clock.now()); // due immediately
    expect((await world.audit.list(record.id)).map((e) => e.type)).toContain('enrolled');
  });

  it('is idempotent: re-ingesting an existing record changes nothing', async () => {
    const world = buildWorld();
    seed(world, 'github:acme/web#1');
    const snap = (await world.codeHost.getPr('github:acme/web#1'))!;
    const first = await world.ingestion.ingest(snap, { source: 'label' });
    world.clock.advanceSeconds(60);
    const second = await world.ingestion.ingest(snap, { source: 'label' });
    expect(second).toEqual(first);
    expect((await world.audit.list(first.id)).filter((e) => e.type === 'enrolled')).toHaveLength(1);
  });

  it('an API trigger upgrades a passive enrollment with campaign metadata + end action', async () => {
    const world = buildWorld();
    seed(world, 'github:acme/web#1', { labels: ['auto-shepherd'] });
    const snap = (await world.codeHost.getPr('github:acme/web#1'))!;
    await world.ingestion.ingest(snap, { source: 'label', campaignLabel: 'auto-shepherd' });

    const upgraded = await world.ingestion.ingest(snap, {
      source: 'api',
      campaignKey: 'q2-cleanup',
      priority: 1,
      endAction: { kind: 'merge' },
      overrides: { staleEscalateAfterDays: 7 },
    });
    expect(upgraded).toMatchObject({
      enrollment: 'triggered',
      matchedBy: 'api',
      campaignKey: 'q2-cleanup',
      priority: 1,
      endAction: { kind: 'merge' },
      configOverrides: { staleEscalateAfterDays: 7 },
    });
    expect((await world.audit.list(upgraded.id)).map((e) => e.type)).toContain('enrollment_upgraded');
  });

  it('stamps campaign metadata on a fresh API trigger', async () => {
    const world = buildWorld();
    seed(world, 'github:acme/web#2');
    const snap = (await world.codeHost.getPr('github:acme/web#2'))!;
    const record = await world.ingestion.ingest(snap, { source: 'api', campaignKey: 'k', endAction: { kind: 'notify_ready' } });
    expect(record.enrollment).toBe('triggered');
    expect(record.endAction).toEqual({ kind: 'notify_ready' });
  });
});

describe('EnrollmentScanner', () => {
  it('enrolls only label/author matches from the open-PR sweep', async () => {
    const world = buildWorld();
    seed(world, 'github:acme/web#1', { labels: ['auto-shepherd'] });
    seed(world, 'github:acme/web#2', { labels: ['unrelated'] });
    seed(world, 'github:acme/web#3', { author: 'renovate-runner' });
    seed(world, 'github:acme/web#4'); // matches nothing

    const scanner = new EnrollmentScanner(world.codeHost, world.ingestion, {
      watchLabels: ['auto-shepherd'],
      watchAuthors: ['renovate-runner'],
    });
    const enrolled = await scanner.scan({ repos: ['acme/web'] });

    expect(enrolled).toBe(2);
    expect(await world.prs.get('github:acme/web#1')).not.toBeNull();
    expect(await world.prs.get('github:acme/web#2')).toBeNull();
    expect((await world.prs.get('github:acme/web#3'))!.matchedBy).toBe('author');
    expect(await world.prs.get('github:acme/web#4')).toBeNull();
  });

  it('repeated sweeps do not duplicate or reset records', async () => {
    const world = buildWorld();
    seed(world, 'github:acme/web#1', { labels: ['auto-shepherd'] });
    const scanner = new EnrollmentScanner(world.codeHost, world.ingestion, {
      watchLabels: ['auto-shepherd'],
      watchAuthors: [],
    });
    await scanner.scan({ repos: ['acme/web'] });
    const before = (await world.prs.get('github:acme/web#1'))!;
    world.clock.advanceSeconds(120);
    await scanner.scan({ repos: ['acme/web'] });
    expect((await world.prs.get('github:acme/web#1'))!).toEqual(before);
  });

  it('skips closed PRs (the fake lists only open, like the real list endpoint)', async () => {
    const world = buildWorld();
    seed(world, 'github:acme/web#1', { labels: ['auto-shepherd'], state: 'closed' });
    const scanner = new EnrollmentScanner(world.codeHost, world.ingestion, {
      watchLabels: ['auto-shepherd'],
      watchAuthors: [],
    });
    expect(await scanner.scan({ repos: ['acme/web'] })).toBe(0);
  });
});
