import { z } from 'zod';

/**
 * Zod at the config-in-git trust boundary (§8). This file is the only place
 * the JSON shape is parsed; core receives already-validated plain objects.
 * NO secrets live here — credentials come from env (§10, §12).
 */

const conclusionSchema = z.enum(['failure', 'timed_out', 'cancelled', 'action_required', 'neutral', 'success']);

const matchPredicateSchema = z.object({
  signal: z.enum(['checks', 'conflict']).optional(),
  check: z.string().optional(),
  job: z.string().optional(),
  conclusion: z.array(conclusionSchema).optional(),
  logPattern: z.string().max(512).optional(),
});

/** Responses reference CODE-registered kinds; config can never invent one (§7.1). */
const responseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('retry_checks') }),
  z.object({ kind: z.literal('update_branch') }),
  z.object({ kind: z.literal('external'), task: z.string().min(1) }),
]);

export const remediationDefSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  class: z.enum(['mechanical', 'conflict']),
  match: matchPredicateSchema,
  response: responseSchema,
  priority: z.number().int(),
  cooldownSeconds: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
});

const preferencesSchema = z.object({
  enabledRemediations: z.array(z.string()).optional(),
  remediationOverrides: z
    .record(z.object({ cooldownSeconds: z.number().int().positive().optional(), maxAttempts: z.number().int().positive().optional() }))
    .optional(),
  endActionDefault: z.enum(['merge', 'notify_ready']).optional(),
  keepBranchUpToDate: z.boolean().optional(),
  notifyQuietSeconds: z.number().int().positive().optional(),
  notifyHardCapSeconds: z.number().int().positive().optional(),
  staleEscalateAfterDays: z.number().int().positive().optional(),
});

const guardrailsSchema = z.object({
  disabledRemediationClasses: z.array(z.enum(['mechanical', 'conflict'])).optional(),
  autoMergeAllowed: z.boolean().optional(),
});

const layerSchema = z.object({
  layer: z.enum(['default', 'org', 'user', 'pr']),
  preferences: preferencesSchema.optional(),
  guardrails: guardrailsSchema.optional(),
});

const destinationSchema = z.object({ transport: z.string(), address: z.string() });

export const shepherdConfigSchema = z.object({
  repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)),
  enrollment: z.object({
    watchLabels: z.array(z.string()).default([]),
    watchAuthors: z.array(z.string()).default([]),
  }),
  catalog: z.array(remediationDefSchema),
  layers: z.array(layerSchema),
  identity: z.object({
    map: z.record(destinationSchema).default({}),
    fallback: destinationSchema,
    /** Slack user ids allowed to act on ANY PR from the Slack UI. */
    adminSlackUserIds: z.array(z.string()).default([]),
  }),
  adminDestination: destinationSchema,
  botDenyList: z.array(z.string()).default([]),
  scheduler: z
    .object({
      tickIntervalMs: z.number().int().positive().default(2000),
      scanIntervalMs: z.number().int().positive().default(60_000),
      flushIntervalMs: z.number().int().positive().default(5000),
      claimLimit: z.number().int().positive().default(50),
    })
    .default({}),
});

export type ShepherdConfig = z.infer<typeof shepherdConfigSchema>;
