import type {
  ConfigLayer,
  ConfigLayerInput,
  ConfigProvenance,
  ConfigResolver,
  EffectiveConfig,
  Preferences,
  RemediationClass,
  RemediationDef,
  ResolvedRemediationDef,
} from '../contracts/index.js';
import type { PrId } from '../contracts/index.js';

const LAYER_ORDER: ConfigLayer[] = ['default', 'org', 'user', 'pr'];

export const BASE_PREFERENCES: Required<Omit<Preferences, 'remediationOverrides'>> & {
  remediationOverrides: NonNullable<Preferences['remediationOverrides']>;
} = {
  enabledRemediations: [],
  remediationOverrides: {},
  endActionDefault: 'notify_ready',
  keepBranchUpToDate: false,
  notifyQuietSeconds: 120,
  notifyHardCapSeconds: 1800,
  staleEscalateAfterDays: 30,
};

/**
 * Cascade resolver (§10): two sources, one resolver, two merge rules.
 * - Preferences: most-specific-wins (pr > user > org > default).
 * - Guardrails: most-restrictive-wins; lower layers cannot loosen them.
 *
 * The remediation catalog is the registry of *available* defs; layers pick
 * which are enabled and tune cooldown/maxAttempts — they cannot invent
 * responses (the matcher/response split, §7.1).
 */
export class CascadeConfigResolver implements ConfigResolver {
  private readonly layers: Map<ConfigLayer, ConfigLayerInput>;

  constructor(
    private readonly catalog: RemediationDef[],
    layers: ConfigLayerInput[],
  ) {
    this.layers = new Map(layers.map((l) => [l.layer, l]));
    const ids = new Set<string>();
    for (const def of catalog) {
      if (ids.has(def.id)) throw new Error(`duplicate remediation def id: ${def.id}`);
      ids.add(def.id);
    }
  }

  resolve(_prId: PrId, perPr?: Preferences): EffectiveConfig {
    const { prefs } = this.mergedPreferences(perPr);
    const guardrails = this.mergedGuardrails();

    const byId = new Map(this.catalog.map((d) => [d.id, d]));
    const remediations: ResolvedRemediationDef[] = [];
    for (const id of prefs.enabledRemediations) {
      const def = byId.get(id);
      if (!def) continue; // enabled id not in catalog — config drift, skip
      if (guardrails.disabledRemediationClasses.includes(def.class)) continue;
      const override = prefs.remediationOverrides[id];
      remediations.push(
        override
          ? {
              ...def,
              cooldownSeconds: override.cooldownSeconds ?? def.cooldownSeconds,
              maxAttempts: override.maxAttempts ?? def.maxAttempts,
            }
          : def,
      );
    }
    remediations.sort((a, b) => a.priority - b.priority);

    return {
      remediations,
      guardrails,
      endActionDefault: prefs.endActionDefault,
      keepBranchUpToDate: prefs.keepBranchUpToDate,
      notifications: {
        quietSeconds: prefs.notifyQuietSeconds,
        hardCapSeconds: prefs.notifyHardCapSeconds,
      },
      staleness: { escalateAfterDays: prefs.staleEscalateAfterDays },
    };
  }

  explain(_prId: PrId, perPr?: Preferences): ConfigProvenance {
    const { provenance } = this.mergedPreferences(perPr);
    const out: ConfigProvenance = { ...provenance };
    // Guardrail provenance: the layer that locked the value.
    let autoMerge: { value: boolean; source: ConfigLayer } = { value: true, source: 'default' };
    const disabled: Array<{ value: RemediationClass; source: ConfigLayer }> = [];
    for (const layer of LAYER_ORDER) {
      const g = this.layers.get(layer)?.guardrails;
      if (!g) continue;
      if (g.autoMergeAllowed === false && autoMerge.value) autoMerge = { value: false, source: layer };
      for (const cls of g.disabledRemediationClasses ?? []) {
        if (!disabled.some((d) => d.value === cls)) disabled.push({ value: cls, source: layer });
      }
    }
    out['autoMergeAllowed'] = autoMerge;
    out['disabledRemediationClasses'] = {
      value: disabled.map((d) => d.value),
      source: disabled[0]?.source ?? 'default',
    };
    return out;
  }

  private mergedPreferences(perPr?: Preferences): {
    prefs: typeof BASE_PREFERENCES;
    provenance: ConfigProvenance;
  } {
    const prefs = { ...BASE_PREFERENCES };
    const provenance: ConfigProvenance = {};
    for (const key of Object.keys(BASE_PREFERENCES) as Array<keyof Preferences>) {
      provenance[key] = { value: BASE_PREFERENCES[key], source: 'default' };
    }
    const apply = (layer: ConfigLayer, p?: Preferences) => {
      if (!p) return;
      for (const [key, value] of Object.entries(p) as Array<[keyof Preferences, unknown]>) {
        if (value === undefined) continue; // unset ≠ default — layers store only overrides
        (prefs as Record<string, unknown>)[key] = value;
        provenance[key] = { value, source: layer };
      }
    };
    for (const layer of LAYER_ORDER) {
      if (layer === 'pr') apply('pr', perPr);
      else apply(layer, this.layers.get(layer)?.preferences);
    }
    return { prefs, provenance };
  }

  private mergedGuardrails(): EffectiveConfig['guardrails'] {
    const disabled = new Set<RemediationClass>();
    let autoMergeAllowed = true;
    for (const layer of LAYER_ORDER) {
      const g = this.layers.get(layer)?.guardrails;
      if (!g) continue;
      for (const cls of g.disabledRemediationClasses ?? []) disabled.add(cls);
      if (g.autoMergeAllowed === false) autoMergeAllowed = false;
    }
    return { disabledRemediationClasses: [...disabled], autoMergeAllowed };
  }
}
