import type {
  LifecycleState,
  NotifyDestination,
  OutboundNotification,
  PrRecord,
  PrRepository,
  ReportService,
} from '../contracts/index.js';

/** Triage order: things needing a human outrank things the loop is handling. */
const TRIAGE_ORDER: LifecycleState[] = [
  'escalated',
  'ready',
  'awaiting_remediation',
  'awaiting_checks',
  'merging',
  'evaluating',
  'tracked',
  'draft_paused',
];

function ageBucket(ingestedAt: Date, now: Date): string {
  const days = (now.getTime() - ingestedAt.getTime()) / 86_400_000;
  if (days < 1) return '<1d';
  if (days < 7) return '1–7d';
  if (days < 30) return '7–30d';
  return '>1mo';
}

export class DefaultReportService implements ReportService {
  constructor(
    private readonly prs: PrRepository,
    private readonly destinationFor: (userId: string) => NotifyDestination,
  ) {}

  async buildDailyDigest(userId: string, now: Date): Promise<OutboundNotification> {
    const active = await this.prs.listActive();
    const ordered = [...active].sort((a, b) => {
      const tier = TRIAGE_ORDER.indexOf(a.lifecycleState) - TRIAGE_ORDER.indexOf(b.lifecycleState);
      if (tier !== 0) return tier;
      const prio = (a.priority ?? 99) - (b.priority ?? 99);
      if (prio !== 0) return prio;
      return a.ingestedAt.getTime() - b.ingestedAt.getTime(); // older first
    });

    const lines = ordered.map((r) => this.line(r, now));
    const text =
      lines.length === 0
        ? 'PR Shepherd digest: nothing in flight.'
        : `PR Shepherd digest — ${lines.length} PR(s) in flight:\n${lines.join('\n')}`;

    return {
      destinations: [this.destinationFor(userId)],
      payload: {
        text,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'PR Shepherd — daily digest' } },
          ...ordered.map((r) => ({
            type: 'section',
            text: { type: 'mrkdwn', text: this.line(r, now) },
          })),
        ],
      },
      dedupKey: `digest:${userId}:${now.toISOString().slice(0, 10)}`,
    };
  }

  private line(r: PrRecord, now: Date): string {
    const campaign = r.campaignLabel ? ` [${r.campaignLabel}]` : '';
    const why = r.escalation ? ` — ${r.escalation.reason}` : '';
    return `• ${r.repo}#${r.number}${campaign} — *${r.lifecycleState}* (${ageBucket(r.ingestedAt, now)})${why}`;
  }
}
