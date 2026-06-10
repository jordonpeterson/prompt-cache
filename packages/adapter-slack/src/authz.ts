/**
 * Authorization for the Slack UI. The identity map (github login → Slack
 * destination) only answers "where do I notify"; the UI needs the reverse —
 * "who is this Slack user, and may they act on this PR?"
 *
 * Rule: admins may do anything; a mapped user may act on their own PRs;
 * everyone may read (status/digest). Single-workspace, list-based — the
 * design doc's known authz debt still stands for real org write access.
 */
export interface SlackAuthz {
  githubLoginFor(slackUserId: string): string | null;
  isAdmin(slackUserId: string): boolean;
  mayAct(slackUserId: string, prAuthor: string): boolean;
}

export class StaticSlackAuthz implements SlackAuthz {
  constructor(
    /** slack user id → github login */
    private readonly slackToGithub: Record<string, string>,
    private readonly adminSlackUserIds: string[],
  ) {}

  /** Build the reverse map from the delivery identity config (github → destination). */
  static fromIdentityMap(
    identityMap: Record<string, { transport: string; address: string }>,
    adminSlackUserIds: string[],
  ): StaticSlackAuthz {
    const reverse: Record<string, string> = {};
    for (const [githubLogin, dest] of Object.entries(identityMap)) {
      if (dest.transport === 'slack') reverse[dest.address] = githubLogin;
    }
    return new StaticSlackAuthz(reverse, adminSlackUserIds);
  }

  githubLoginFor(slackUserId: string): string | null {
    return this.slackToGithub[slackUserId] ?? null;
  }

  isAdmin(slackUserId: string): boolean {
    return this.adminSlackUserIds.includes(slackUserId);
  }

  mayAct(slackUserId: string, prAuthor: string): boolean {
    if (this.isAdmin(slackUserId)) return true;
    const login = this.githubLoginFor(slackUserId);
    return login !== null && login === prAuthor;
  }
}
