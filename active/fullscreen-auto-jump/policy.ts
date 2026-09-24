// Pure scroll policy. No TUI access, so every rule is directly testable.

export interface JumpInput {
  /** First line of the final assistant answer, in document coordinates. */
  rangeStart: number;
  /** One past the last line of that answer. */
  rangeEnd: number;
  /** Rows the transcript viewport can show. */
  viewportHeight: number;
  /** Total rendered document height. */
  contentHeight: number;
  /** Where the viewport currently sits. */
  scrollTop: number;
  /** Whether the viewport is still pinned to the end of the transcript. */
  isFollowingOutput: boolean;
}

export type JumpSkipReason =
  | "user-scrolled-away"
  | "degenerate-viewport"
  | "answer-fits"
  | "already-there";

export type JumpDecision =
  | { jump: true; scrollTop: number }
  | { jump: false; reason: JumpSkipReason };

/**
 * Decide where the transcript should sit once a turn has settled.
 *
 * The intent: when the final answer is taller than the viewport, put its first
 * line at the top so reading starts at the beginning instead of the tail. When
 * it fits, Pi's own follow-the-end behaviour already shows all of it.
 */
export function decideJump(input: JumpInput): JumpDecision {
  if (!input.isFollowingOutput) return { jump: false, reason: "user-scrolled-away" };

  const viewportHeight = Math.floor(input.viewportHeight);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return { jump: false, reason: "degenerate-viewport" };
  }

  const contentHeight = Math.max(0, Math.floor(input.contentHeight));
  const start = Math.max(0, Math.min(Math.floor(input.rangeStart), contentHeight));
  const end = Math.max(start, Math.min(Math.floor(input.rangeEnd), contentHeight));
  if (end - start <= viewportHeight) return { jump: false, reason: "answer-fits" };

  const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
  const scrollTop = Math.max(0, Math.min(start, maxScrollTop));
  if (scrollTop === Math.floor(input.scrollTop)) return { jump: false, reason: "already-there" };

  return { jump: true, scrollTop };
}
