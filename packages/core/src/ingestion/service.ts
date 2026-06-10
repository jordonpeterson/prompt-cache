import type {
  AuditLog,
  ClockPort,
  CodeHostPort,
  IngestionService,
  PollWindow,
  PrRecord,
  PrRepository,
  PrSnapshot,
  TriggerEnvelope,
} from '../contracts/index.js';

export interface EnrollmentRules {
  /** PRs carrying any of these labels enroll passively. */
  watchLabels: string[];
  /** PRs by any of these authors enroll passively. */
  watchAuthors: string[];
}

const TRIGGERED_SOURCES = new Set(['api', 'slack']);

export class DefaultIngestionService implements IngestionService {
  constructor(
    private readonly prs: PrRepository,
    private readonly audit: AuditLog,
    private readonly clock: ClockPort,
  ) {}

  async ingest(snapshot: PrSnapshot, trigger?: TriggerEnvelope): Promise<PrRecord> {
    const now = this.clock.now();
    const existing = await this.prs.get(snapshot.id);
    if (existing) {
      // Re-trigger upgrades a passive enrollment and refreshes campaign metadata.
      if (trigger && TRIGGERED_SOURCES.has(trigger.source)) {
        const upgraded: PrRecord = {
          ...existing,
          enrollment: 'triggered',
          matchedBy: trigger.source,
          campaignKey: trigger.campaignKey ?? existing.campaignKey,
          campaignLabel: trigger.campaignLabel ?? existing.campaignLabel,
          priority: trigger.priority ?? existing.priority,
          endAction: trigger.endAction ?? existing.endAction,
          configOverrides: trigger.overrides ?? existing.configOverrides,
          lastInteractionAt: now,
          nextReconcileAt: now,
        };
        await this.prs.upsert(upgraded);
        await this.audit.record({
          prId: snapshot.id, type: 'enrollment_upgraded',
          payload: { campaignKey: upgraded.campaignKey }, at: now,
        });
        return upgraded;
      }
      return existing;
    }

    const record: PrRecord = {
      id: snapshot.id,
      repo: snapshot.repo,
      number: snapshot.number,
      author: snapshot.author,
      enrollment: trigger && TRIGGERED_SOURCES.has(trigger.source) ? 'triggered' : 'passive',
      matchedBy: trigger?.source ?? 'api',
      campaignKey: trigger?.campaignKey,
      campaignLabel: trigger?.campaignLabel,
      priority: trigger?.priority,
      endAction: trigger?.endAction,
      lifecycleState: 'tracked',
      remediation: null,
      escalation: null,
      configOverrides: trigger?.overrides,
      lastInteractionAt: now,
      ingestedAt: now,
      terminalAt: null,
      nextReconcileAt: now, // due immediately
    };
    await this.prs.upsert(record);
    await this.audit.record({
      prId: snapshot.id, type: 'enrolled',
      payload: { enrollment: record.enrollment, matchedBy: record.matchedBy }, at: now,
    });
    return record;
  }
}

/**
 * Periodic passive-enrollment sweep: walks open PRs in the poll window and
 * ingests anything matching the label/author rules. Already-tracked PRs are
 * untouched (ingest is idempotent for them).
 */
export class EnrollmentScanner {
  constructor(
    private readonly codeHost: CodeHostPort,
    private readonly ingestion: IngestionService,
    private readonly rules: EnrollmentRules,
  ) {}

  async scan(window: PollWindow): Promise<number> {
    let enrolled = 0;
    for await (const snapshot of this.codeHost.listOpenPrs(window)) {
      const label = snapshot.labels.find((l) => this.rules.watchLabels.includes(l));
      const byAuthor = this.rules.watchAuthors.includes(snapshot.author);
      if (!label && !byAuthor) continue;
      await this.ingestion.ingest(snapshot, {
        source: label ? 'label' : 'author',
        campaignLabel: label,
      });
      enrolled++;
    }
    return enrolled;
  }
}
