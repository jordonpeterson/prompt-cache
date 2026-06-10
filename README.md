# PR Shepherd

A reconciliation loop that shepherds pull requests to a terminal state — merged, escalated, or abandoned — with bounded, hardwired remediation and Slack-only reporting.

Built to the **PR Shepherd Technical Design** (implementation handoff). TypeScript / Node 20+, ports-and-adapters modular monolith, Postgres only, Slack only.

## How it works (30 seconds)

Each tracked PR is a resource. A scheduler wakes every few seconds and claims PRs whose `next_reconcile_at` is due; for each, the controller re-derives the **single next action** from persisted state + a fresh GitHub snapshot. Level-triggered, idempotent, restart-safe.

Remediation is **fire-and-wait**: when a failing check or conflict matches a catalog definition, the shepherd triggers the external task service with a deterministic idempotency key, then waits out a configured cooldown `c` — it never polls for completion. After `c` it just looks at the PR again: passing → proceed, pending → normal CI wait, still failing → re-trigger (bounded) or escalate. `c × maxAttempts` is the stuck detector. The task server **must dedupe on the idempotency key** — that is the safety condition the whole model rests on.

Nothing exits silently: every terminal transition is audited, and every unmatched failure signal escalates to a human via Slack.

## Repository layout

```
apps/shepherd            # the deployable: wires core + adapters + scheduler + HTTP
packages/core            # domain hexagon — pure, no I/O, no adapter imports
  src/contracts/         #   all port + service interfaces (the spec)
  src/shepherd/          #   ShepherdController: reconcile loop + state machine
  src/remediation/       #   engine + two-phase matcher
  src/merge/             #   MergePolicy (the green path)
  src/config/            #   cascade resolver (preferences vs guardrails) + provenance
  src/report/            #   triage-ordered daily digest
  src/ingestion/         #   enrollment (passive label/author, triggered API)
packages/persistence     # Drizzle schema, repositories, unit-of-work, migrations
packages/adapter-github  # CodeHostPort via Octokit (token or GitHub App, ETag cache)
packages/adapter-slack   # NotifierTransport via Slack Web API
packages/adapter-remediation  # HTTP client to the external task service
packages/delivery        # GENERIC notification package: debounce, dedup, bot-filter, identity
packages/testkit         # fakes for every port, fake clock, scenario harness, replay CLI
```

Dependency rule: `core` imports nothing but its own contracts. Adapters depend on contracts. Only `apps/shepherd` imports concrete adapters.

## Quick start

```bash
npm install
npm test                  # hermetic suite: unit + integration + e2e scenarios (no network)
npm run typecheck

# replay a scenario and dump the state timeline + side effects
npm run replay -- packages/testkit/test/scenarios/happy-merge.yaml

# run the app hermetically (in-memory everything, console notifications)
FAKE_ADAPTERS=1 npm start

# run for real
cp .env.example .env      # fill in DATABASE_URL, GITHUB_TOKEN, SLACK_BOT_TOKEN, REMEDIATION_*
npm start
```

Gated, non-hermetic suites:

```bash
npm run test:pg           # real Postgres via Testcontainers (needs Docker)
GITHUB_CONTRACT=1 GITHUB_TOKEN=... GITHUB_CONTRACT_REPO=o/r GITHUB_CONTRACT_PR=1 \
  npx vitest run packages/adapter-github   # read-only contract test vs the real API
```

## HTTP API

| Route | Purpose |
|---|---|
| `POST /triggers/pr` | Enroll a PR (triggered): `{ repo, number, campaignKey?, priority?, endAction?, overrides? }` |
| `GET /prs/:prId/status` | Lifecycle state, remediation/escalation detail (`prId` URL-encoded, e.g. `github%3Aacme%2Fweb%2342`) |
| `POST /prs/:prId/abandon` | Manual hard-terminal — the only state a human sets directly |
| `GET /healthz` | Liveness |

Passive enrollment (watch labels/authors) is configured in `apps/shepherd/config/shepherd.json` and runs as a periodic sweep.

## Configuration

Static policy lives in git JSON (`apps/shepherd/config/shepherd.json`, override path with `SHEPHERD_CONFIG`): the remediation **catalog**, layer cascade, enrollment rules, identity map, bot deny-list, scheduler cadence. **No secrets in git** — credentials come from `.env` (see `.env.example`).

Two merge rules, enforced by `CascadeConfigResolver`:
- **Preferences** (enabled remediations, cooldowns, end-action, notification timing): most-specific-wins — per-PR > user > org > default.
- **Guardrails** (`autoMergeAllowed`, disabled remediation classes): most-restrictive-wins — lower layers cannot loosen them.

`resolver.explain(prId)` returns value + source layer per field.

The safety bar is the **matcher/response split**: a catalog entry's `match` is declarative data that can only *select*; its `response` must reference a code-registered kind (`retry_checks` | `update_branch` | `external task`). Config can tune parameters; it can never invent behavior (there's a test that proves the schema rejects an invented response kind).

## Invariants (§8 of the design) and where they're enforced

| Invariant | Where |
|---|---|
| Deterministic idempotency keys; reservation commits in the same txn as the transition | `contracts/ids.ts`, `UnitOfWork` (`DrizzleUnitOfWork` uses a real PG transaction; atomicity test in `packages/persistence/test/pg.test.ts`) |
| Time is a port — no `Date.now()` in core | `ClockPort`, injected everywhere; `FakeClock` in tests |
| Every loop is capped | `maxAttempts` per def → escalate on cap (engine test) |
| One action per tick per PR | controller structure: every branch returns after ≤1 guarded side-effect (test: conflict + lint → one trigger) |
| Dedupe remediation on (task + head), never per check | engine emits one def-level decision; key is `rem:{prId}:{headSha}:{defId}:{attempt}` |
| Verify-after-fix is observed, never assumed | cooldown expiry re-reads the live snapshot; nothing trusts the task ack |
| Nothing exits silently | `audit_events` rows for every transition + terminal; unmatched signals escalate |
| Zod at trust boundaries only | GitHub/Slack/remediation responses, inbound HTTP, config JSON, JSONB deserialization — never module hops |

## Testing contract

1. **Unit** — matcher, resolver (both merge rules), merge policy, debounce math. Pure.
2. **Integration** — controller + fakes for every port + injected clock + manual `tick()` (`packages/testkit/test/controller.test.ts`).
3. **Contract** — GitHub adapter runs read-only assertions against the real API when `GITHUB_CONTRACT=1`; the fake's semantics (incl. server-side idempotency dedupe) are themselves tested.
4. **e2e (hermetic)** — YAML scenario fixtures drive a timeline; assert terminal state + recorded outbound calls. `npm run replay -- <scenario>` dumps the timeline for debugging.

Plus the one non-hermetic suite: real `PrRepository`/`UnitOfWork` against Postgres via Testcontainers (`npm run test:pg`).

## Deviations from the design doc

Each of these was forced by an internal contradiction or missing field in the doc; everything else builds to the doc's contracts verbatim.

- **`PrSnapshot.state ('open'|'closed'|'merged')`** — `getPr` must distinguish externally-merged from closed-unmerged to terminalize correctly; `listOpenPrs` can't tell you.
- **`PrSnapshot.behindBase` and `headRef`** — `MergeDecision.update_branch` is unreachable without knowing the head is behind; `RemediationTrigger.target.headRef` is required by the doc's own §5.1 payload.
- **`CodeHostPort.retryChecks(...)`** — the `retry_checks` response kind exists in §7.1 but the doc's port had no way to execute it.
- **`RemediationEngine.evaluate` is async** — §5.3 shows a sync signature, §7.4 mandates Phase-2 log fetching through `getJobLogs`. The engine takes a `LogSource` (a pick of `CodeHostPort`), so core still depends only on ports.
- **`ConfigResolver.resolve(prId, perPr?)`** — the doc's `resolve(prId)` is sync, so it can't read the DB; the caller (controller) passes the record's trigger-time overrides as the most-specific layer.
- **`MatchPredicate.signal: 'checks'|'conflict'`** — a merge conflict isn't a check; conflict-class defs need something to match on.
- **Repository additions** — `PrRepository.listActive()` (digest input) and a lease inside `claimDueForReconcile` (so `SKIP LOCKED` workers don't hold row locks across reconciles).
- **Slack interactivity (close-confirmation modal) is not wired** — the manual-abandon seam exists as `POST /prs/:prId/abandon`; Bolt/Socket-Mode wiring is phase 2, as is the webhook receiver and Zod→OpenAPI generation.

## Open decisions (§15) — current working defaults

| `DECIDE` item | Working default in this codebase |
|---|---|
| Task vocabulary / trigger shape | §5.1 payload as proposed; `task` strings in the catalog (`eslint-autofix`, `conflict-rebase`) |
| Server dedupes on `idempotencyKey` | **Still a hard requirement to confirm.** The fake honors it; the contract test for the real server doesn't exist yet |
| `logPattern` limits | 256 KiB log tail, 512-char patterns, literal-substring preferred, invalid regex fails closed |
| Dedup scope | Tasks assumed comprehensive over the PR (no `scope` key component) |
| Default `c` / maxAttempts | mechanical: 300 s × 2; conflict: 600 s × 1 (in `shepherd.json`) |
| Slack templates | minimal text + one section block; see `apps/shepherd/src/notifier.ts` |
| Escalation semantics | pause-and-keep-observing; resumes on a new head; `abandoned` only via manual endpoint |
| Bot filter | deny-list + `[bot]` suffix heuristic, allow-list override |
