import { z } from 'zod';

/**
 * Zod at the trust boundary: Slack interaction payloads parse
 * forward-compatibly (passthrough) — we validate only what we consume.
 * Shapes follow Slack's interactivity docs (block_actions, view_submission,
 * slash commands); realistic fixtures live in the tests.
 */

export const blockActionsPayloadSchema = z
  .object({
    type: z.literal('block_actions'),
    user: z.object({ id: z.string() }).passthrough(),
    trigger_id: z.string(),
    channel: z.object({ id: z.string() }).passthrough().optional(),
    actions: z
      .array(
        z
          .object({
            action_id: z.string(),
            value: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export type BlockActionsPayload = z.infer<typeof blockActionsPayloadSchema>;

export const viewSubmissionPayloadSchema = z
  .object({
    type: z.literal('view_submission'),
    user: z.object({ id: z.string() }).passthrough(),
    view: z
      .object({
        callback_id: z.string(),
        private_metadata: z.string(),
        state: z
          .object({
            values: z.record(z.record(z.object({ value: z.string().nullable().optional() }).passthrough())),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type ViewSubmissionPayload = z.infer<typeof viewSubmissionPayloadSchema>;

/** Slash commands arrive form-encoded; Bolt hands us this object. */
export const slashCommandPayloadSchema = z
  .object({
    command: z.string(),
    text: z.string().default(''),
    user_id: z.string(),
    channel_id: z.string().optional(),
  })
  .passthrough();

export type SlashCommandPayload = z.infer<typeof slashCommandPayloadSchema>;

/** Pulls the first input value out of a view_submission's state, by block/action id. */
export function inputValue(payload: ViewSubmissionPayload, blockId: string, actionId: string): string | null {
  const block = payload.view.state.values[blockId];
  const input = block?.[actionId];
  return input?.value ?? null;
}
