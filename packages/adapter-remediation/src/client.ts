import { z } from 'zod';
import type { RemediationServicePort, RemediationTrigger } from '@shepherd/core';

const ackSchema = z
  .object({
    result: z.enum(['accepted', 'declined']),
    reason: z.string().optional(),
  })
  .passthrough();

export interface TaskEndpoint {
  /** Base URL; the trigger call POSTs to `${endpoint}/trigger`. */
  endpoint: string;
  /** Static bearer token from .env — NOT git (§12). OAuth2 can slot in later
   * behind this same adapter without touching the core. */
  credential: string;
}

/** task → endpoint/credential resolver seam for multiple/future task servers (one now). */
export type TaskRouter = (task: string) => TaskEndpoint;

export function singleServerRouter(endpoint: TaskEndpoint): TaskRouter {
  return () => endpoint;
}

/**
 * HTTP client for the external remediation/task service. Fire-and-wait (§6):
 * this is the synchronous submit ack only — completion is never polled.
 * The server owns the "no behavior change / verifiable-or-decline" guarantee
 * and MUST dedupe on `idempotencyKey`.
 */
export class HttpRemediationService implements RemediationServicePort {
  constructor(
    private readonly router: TaskRouter,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async trigger(req: RemediationTrigger): Promise<{ result: 'accepted' | 'declined'; reason?: string }> {
    const { endpoint, credential } = this.router(req.task);
    const res = await this.fetchImpl(`${endpoint.replace(/\/$/, '')}/trigger`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      // Transport/server failure is NOT a decline — throw so the loop retries
      // next tick with the same idempotency key.
      throw new Error(`remediation service HTTP ${res.status}: ${await safeText(res)}`);
    }
    const ack = ackSchema.parse(await res.json());
    return { result: ack.result, reason: ack.reason };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '(unreadable body)';
  }
}
