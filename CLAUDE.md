# PR Shepherd — working notes for agents

Read `README.md` first; it maps the design doc onto the code and lists the intentional deviations. The design doc's TypeScript interfaces are the source of truth — build to the contracts in `packages/core/src/contracts/`, not to prose.

## Hard rules

- **Core purity**: `packages/core` must never import an adapter type — no Octokit, Slack, Drizzle, Fastify, or wire-level Zod. All I/O goes through the ports in `core/contracts`. Only `apps/shepherd` wires concrete adapters.
- **Time is a port**: no `Date.now()` / `setTimeout` in core. Use the injected `ClockPort`; tests use `FakeClock` and manual `controller.tick(now)`.
- **One action per tick per PR**: every branch of `reconcile` returns after at most one guarded side-effect. Don't add a second.
- **Idempotency**: side-effects are guarded by deterministic keys (`contracts/ids.ts`) reserved inside the `UnitOfWork` transaction that also commits the state transition. Never fire outside that pattern.
- **Matcher/response split**: catalog config may only *select* (predicates) and *tune* (cooldown/attempts). New behavior = a new code-registered response kind + schema change, reviewed.
- **Zod at trust boundaries only**: external API responses, inbound HTTP, config JSON, JSONB deserialization. Never on in-process module hops.
- **Nothing exits silently**: every transition writes `audit_events`; unmatched signals escalate.

## Commands

```bash
npm test                  # hermetic suite — must stay green and network-free
npm run typecheck         # tsc strict, no emit
npm run test:pg           # Testcontainers suite (needs Docker; CI-only here)
npm run replay -- packages/testkit/test/scenarios/happy-merge.yaml
FAKE_ADAPTERS=1 npm start # boot hermetically
```

## Adding things

- **New remediation pattern handled by an existing fix** → config-only: add/edit a def in `apps/shepherd/config/shepherd.json` (and `TEST_CATALOG` in testkit if tests need it).
- **New kind of fix** → add a response kind to `contracts/config.ts` + `config-schema.ts`, implement its execution arm in `controller.applyResponse`, add engine/controller tests.
- **New port method** → add to contracts, implement in the adapter AND every fake in `packages/testkit/src/fakes.ts`, extend the contract test.
- **Schema change** → edit `packages/persistence/src/schema.ts` + add a numbered SQL file in `packages/persistence/migrations/` + update `rows.ts` mapping and the PG test.
- **New e2e flow** → prefer a YAML scenario in `packages/testkit/test/scenarios/` over an imperative test.

## Slack UI rules

- Inbound Slack lives in `packages/adapter-slack` (`interactions.ts`); it may ONLY call `PrCommands` + reads. A button must never mutate lifecycle state — the loop is the only writer. Abandon always goes through the confirmation modal.
- The action-id schema (`actions.ts`) is the outbound↔inbound contract; notifier templates and the handler must stay in sync through it.
- New Slack capability = handler change + payload fixture test in `packages/adapter-slack/test/` + (if it acts) a `PrCommands` method shared with the HTTP API.

## Known not-yet-built (phase 2)

Webhook receiver (sets `next_reconcile_at = now`), Zod→OpenAPI generation for the trigger API, pg-boss scheduler, daily-digest cron wiring (service exists: `DefaultReportService`; `/shepherd digest` serves it on demand).
