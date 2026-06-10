import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runScenario } from '../src/scenario.js';

const scenariosDir = join(dirname(fileURLToPath(import.meta.url)), 'scenarios');

describe('e2e scenarios (hermetic: full wiring, all fakes, no network)', () => {
  for (const file of readdirSync(scenariosDir).filter((f) => f.endsWith('.yaml')).sort()) {
    it(file, async () => {
      const result = await runScenario(readFileSync(join(scenariosDir, file), 'utf8'));
      expect(result.stateTimeline.length).toBeGreaterThan(0);
    });
  }

  it('fails loudly with the state timeline when an expectation breaks', async () => {
    const bad = `
pr: { repo: acme/web, number: 1, checks: { lint: success } }
timeline:
  - { tick: 1 }
  - expect: { state: escalated }
`;
    await expect(runScenario(bad)).rejects.toThrow(/expected state 'escalated'[\s\S]*state timeline/);
  });
});
