# Getting started

How to run PR Shepherd, from zero to a live loop. Each step works without the ones after it — start hermetic, add real services as you get credentials.

## Prerequisites

- Node 20+ (developed on 22) and npm
- Docker only if you want local Postgres or the `test:pg` suite

## 1. Install and verify

```bash
npm install
npm test              # 200 hermetic tests — no network, no credentials needed
npm run typecheck
```

If those pass, everything works.

## 2. Run it hermetically (no credentials, no DB)

```bash
FAKE_ADAPTERS=1 npm start
```

This boots the real app — reconcile loop, trigger API on port 3000, scheduler — against in-memory fakes. Notifications print to the console. Poke it:

```bash
curl localhost:3000/healthz
# {"ok":true}

curl -X POST localhost:3000/triggers/pr \
  -H 'content-type: application/json' \
  -d '{"repo":"acme/web","number":1}'
# {"error":"PR not found: github:acme/web#1"} — correct: the fake code host is empty
```

To watch a full PR lifecycle without the app at all, replay a scenario:

```bash
npm run replay -- packages/testkit/test/scenarios/happy-merge.yaml
```

That prints the state timeline, every outbound side-effect, and the audit trail.

## 3. Run it for real

```bash
cp .env.example .env    # then fill in what you have; everything is optional-but-degraded
npm start
```

What each credential unlocks (the app tells you at startup what's missing):

| Env var | Without it | With it |
|---|---|---|
| `DATABASE_URL` | in-memory state, lost on restart | durable Postgres (migrations apply automatically) |
| `GITHUB_TOKEN` *(or the three `GITHUB_APP_*` vars)* | nothing to shepherd | real PR snapshots, merges, branch updates |
| `SLACK_BOT_TOKEN` | notifications log to console | real Slack messages |
| `SLACK_APP_TOKEN` | notifications only | buttons, abandon modal, `/shepherd` commands (Socket Mode) |
| `REMEDIATION_ENDPOINT` + `REMEDIATION_TOKEN` | remediations decline → PRs escalate to a human | external autofix service is triggered |

Local Postgres in one line:

```bash
docker run -d --name shepherd-pg -p 5432:5432 \
  -e POSTGRES_USER=shepherd -e POSTGRES_PASSWORD=shepherd -e POSTGRES_DB=shepherd postgres:16
# then: DATABASE_URL=postgres://shepherd:shepherd@localhost:5432/shepherd
```

### Slack app setup (for the UI)

Create a Slack app with:

1. Bot token scopes: `chat:write`, `chat:write.customize` → install, copy the `xoxb-` token into `SLACK_BOT_TOKEN`
2. Socket Mode enabled + an app-level token with `connections:write` → copy the `xapp-` token into `SLACK_APP_TOKEN`
3. Interactivity: on (no request URL needed — Socket Mode)
4. A slash command: `/shepherd`

Then map GitHub logins to Slack user IDs in `apps/shepherd/config/shepherd.json` under `identity.map`, and put admin Slack user IDs in `identity.adminSlackUserIds`.

## 4. Tell it what to shepherd

Edit `apps/shepherd/config/shepherd.json` (or point `SHEPHERD_CONFIG` at your own copy):

- `repos` — which repos the enrollment sweep scans
- `enrollment.watchLabels` / `watchAuthors` — PRs that enroll automatically
- `catalog` + `layers` — which remediations are enabled, cooldowns, guardrails

Or enroll a single PR explicitly:

```bash
curl -X POST localhost:3000/triggers/pr \
  -H 'content-type: application/json' \
  -d '{"repo":"your-org/your-repo","number":123,"endAction":{"kind":"merge"}}'

curl localhost:3000/prs/github%3Ayour-org%2Fyour-repo%23123/status
```

…or from Slack: `/shepherd track your-org/your-repo#123 merge`.

## Command reference

```bash
npm test              # hermetic suite
npm run typecheck
npm run test:pg       # Postgres suite (needs Docker)
npm run replay -- <scenario.yaml>
FAKE_ADAPTERS=1 npm start
npm start
```

More depth: `README.md` (architecture, invariants, deviations from the design doc) and `CLAUDE.md` (rules for changing the code).
