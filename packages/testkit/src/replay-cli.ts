/**
 * `npm run replay <scenario.yaml>` — runs one scenario and dumps the PR's
 * state timeline + recorded side-effects. Stable assertion surface for agents.
 */
import { readFileSync } from 'node:fs';
import { runScenario } from './scenario.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: npm run replay -- <scenario.yaml>');
  process.exit(2);
}

const yamlText = readFileSync(path, 'utf8');

try {
  const { world, record, stateTimeline } = await runScenario(yamlText);
  console.log('── state timeline ──────────────────────────────');
  for (const p of stateTimeline) {
    console.log(`  [${String(p.step).padStart(2)}] ${p.at}  ${p.state}${p.note ? `  (${p.note})` : ''}`);
  }
  console.log('── outbound side-effects ───────────────────────');
  console.log('  remediation triggers:');
  for (const t of world.remediationService.triggers) {
    console.log(`    ${t.task}  key=${t.idempotencyKey}`);
  }
  console.log('  merges:', world.codeHost.merges.map((m) => m.id).join(', ') || '(none)');
  console.log('  branch updates:', world.codeHost.branchUpdates.length);
  console.log('  check retries:', world.codeHost.checkRetries.length);
  console.log('  notifications:', world.notifier.events.map((e) => e.kind).join(', ') || '(none)');
  console.log('── audit trail ─────────────────────────────────');
  for (const e of await world.audit.list()) {
    console.log(`  ${e.at.toISOString()}  ${e.type}  ${JSON.stringify(e.payload)}`);
  }
  console.log(`\nterminal: ${record.lifecycleState}${record.terminalAt ? ` at ${record.terminalAt.toISOString()}` : ' (not terminal)'}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
