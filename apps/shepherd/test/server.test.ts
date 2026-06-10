import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildWorld, makeSnapshot } from '@shepherd/testkit';
import { buildServer } from '../src/server.js';
import { shepherdConfigSchema } from '../src/config-schema.js';

function makeApp() {
  const world = buildWorld();
  const app = buildServer({
    codeHost: world.codeHost,
    ingestion: world.ingestion,
    prs: world.prs,
    commands: world.commands,
  });
  return { world, app };
}

describe('trigger API', () => {
  it('enrolls a PR with campaign metadata and end-action', async () => {
    const { world, app } = makeApp();
    world.codeHost.setPr(makeSnapshot({ id: 'github:acme/web#42', repo: 'acme/web', number: 42 }));

    const res = await app.inject({
      method: 'POST',
      url: '/triggers/pr',
      payload: { repo: 'acme/web', number: 42, campaignKey: 'q2-cleanup', endAction: { kind: 'merge' } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ prId: 'github:acme/web#42', state: 'tracked' });

    const record = (await world.prs.get('github:acme/web#42'))!;
    expect(record.enrollment).toBe('triggered');
    expect(record.campaignKey).toBe('q2-cleanup');
    expect(record.endAction).toEqual({ kind: 'merge' });
  });

  it('rejects malformed bodies with 400 (Zod at the trust boundary)', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/triggers/pr', payload: { repo: 'not-a-repo', number: -1 } });
    expect(res.statusCode).toBe(400);
  });

  it('404s when the PR does not exist on the code host', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/triggers/pr', payload: { repo: 'acme/web', number: 999 } });
    expect(res.statusCode).toBe(404);
  });

  it('serves status and supports manual abandon (the only manual hard-terminal)', async () => {
    const { world, app } = makeApp();
    world.codeHost.setPr(makeSnapshot({ id: 'github:acme/web#42', repo: 'acme/web', number: 42 }));
    await app.inject({ method: 'POST', url: '/triggers/pr', payload: { repo: 'acme/web', number: 42 } });

    const prId = encodeURIComponent('github:acme/web#42');
    const status = await app.inject({ method: 'GET', url: `/prs/${prId}/status` });
    expect(status.statusCode).toBe(200);
    expect(status.json().state).toBe('tracked');

    const abandon = await app.inject({ method: 'POST', url: `/prs/${prId}/abandon`, payload: { reason: 'superseded' } });
    expect(abandon.statusCode).toBe(200);
    expect((await world.prs.get('github:acme/web#42'))!.lifecycleState).toBe('abandoned');
    expect((await world.audit.list('github:acme/web#42')).some((e) => e.type === 'terminal')).toBe(true);

    const again = await app.inject({ method: 'POST', url: `/prs/${prId}/abandon`, payload: { reason: 'twice' } });
    expect(again.statusCode).toBe(409);
  });
});

describe('config', () => {
  it('the shipped shepherd.json parses against the schema', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'shepherd.json');
    const cfg = shepherdConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(cfg.catalog.length).toBeGreaterThan(0);
    expect(cfg.catalog.map((d) => d.id)).toContain('eslint-autofix');
  });

  it('config cannot invent a response kind (matcher/response split)', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'shepherd.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.catalog[0].response = { kind: 'run_arbitrary_shell', cmd: 'rm -rf /' };
    expect(() => shepherdConfigSchema.parse(raw)).toThrow();
  });
});
