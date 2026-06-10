/** `${provider}:${repo}#${number}` */
export type PrId = string;

/** Tool-generated, deterministic. */
export type IdemKey = string;

export function makePrId(provider: string, repo: string, number: number): PrId {
  return `${provider}:${repo}#${number}`;
}

/**
 * Remediation firing key: `headSha` does double duty — identity AND
 * change-detector. Unchanged head ⇒ key collides ⇒ no double-fire; new commit
 * ⇒ legitimately a new attempt. (§7.2)
 */
export function remediationKey(prId: PrId, headSha: string, defId: string, attempt: number): IdemKey {
  return `rem:${prId}:${headSha}:${defId}:${attempt}`;
}

export function mergeKey(prId: PrId, headSha: string): IdemKey {
  return `merge:${prId}:${headSha}`;
}

export function updateBranchKey(prId: PrId, headSha: string): IdemKey {
  return `ub:${prId}:${headSha}`;
}
