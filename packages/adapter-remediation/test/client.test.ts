import { describe, expect, it, vi } from 'vitest';
import type { RemediationTrigger } from '@shepherd/core';
import { HttpRemediationService, singleServerRouter, type TaskRouter } from '../src/client.js';

const TRIGGER: RemediationTrigger = {
  idempotencyKey: 'rem:github:acme/web#42:abc123:eslint-autofix:1',
  task: 'eslint-autofix',
  target: { repo: 'acme/web', prNumber: 42, headRef: 'feature', headSha: 'abc123' },
  context: { failingJobs: ['lint'] },
};

function fetchReturning(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const ROUTER = singleServerRouter({ endpoint: 'https://tasks.example.com/api/', credential: 's3cret' });

describe('HttpRemediationService', () => {
  it('POSTs the §5.1 payload to {endpoint}/trigger with a bearer token', async () => {
    const fetchImpl = fetchReturning({ result: 'accepted' });
    const service = new HttpRemediationService(ROUTER, fetchImpl);
    const ack = await service.trigger(TRIGGER);

    expect(ack).toEqual({ result: 'accepted', reason: undefined });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init = {}] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://tasks.example.com/api/trigger'); // trailing slash normalized
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer s3cret');
    expect(JSON.parse(init.body as string)).toEqual(TRIGGER); // idempotency key reaches the server verbatim
  });

  it('passes a decline through with its reason', async () => {
    const service = new HttpRemediationService(ROUTER, fetchReturning({ result: 'declined', reason: 'conflict too gnarly' }));
    expect(await service.trigger(TRIGGER)).toEqual({ result: 'declined', reason: 'conflict too gnarly' });
  });

  it('tolerates forward-compatible extra fields in the ack', async () => {
    const service = new HttpRemediationService(ROUTER, fetchReturning({ result: 'accepted', jobUrl: 'https://x', queue: 3 }));
    expect((await service.trigger(TRIGGER)).result).toBe('accepted');
  });

  it('treats a 5xx as a transport failure, NOT a decline (loop retries with the same key)', async () => {
    const service = new HttpRemediationService(ROUTER, fetchReturning('internal error', 500));
    await expect(service.trigger(TRIGGER)).rejects.toThrow(/HTTP 500/);
  });

  it('treats a 401 the same way — auth problems must not escalate the PR', async () => {
    const service = new HttpRemediationService(ROUTER, fetchReturning('bad token', 401));
    await expect(service.trigger(TRIGGER)).rejects.toThrow(/HTTP 401/);
  });

  it('rejects a malformed ack at the trust boundary', async () => {
    const service = new HttpRemediationService(ROUTER, fetchReturning({ result: 'maybe?' }));
    await expect(service.trigger(TRIGGER)).rejects.toThrow();
  });

  it('rejects a non-JSON ack body', async () => {
    const service = new HttpRemediationService(ROUTER, fetchReturning('<html>gateway</html>'));
    await expect(service.trigger(TRIGGER)).rejects.toThrow();
  });

  it('routes per task through the TaskRouter seam', async () => {
    const fetchImpl = fetchReturning({ result: 'accepted' });
    const router: TaskRouter = (task) =>
      task === 'conflict-rebase'
        ? { endpoint: 'https://conflicts.example.com', credential: 'c-token' }
        : { endpoint: 'https://general.example.com', credential: 'g-token' };
    const service = new HttpRemediationService(router, fetchImpl);

    await service.trigger({ ...TRIGGER, task: 'conflict-rebase' });
    await service.trigger(TRIGGER);

    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['https://conflicts.example.com/trigger', 'https://general.example.com/trigger']);
    const tokens = fetchImpl.mock.calls.map((c) => (c[1]?.headers as Record<string, string>)['authorization']);
    expect(tokens).toEqual(['Bearer c-token', 'Bearer g-token']);
  });
});
