export class AgentResponseJumpState {
  private active = false;
  private userScrolled = false;

  beginTurn(): void {
    this.active = true;
    this.userScrolled = false;
  }

  markUserScrollIntent(): void {
    if (this.active) this.userScrolled = true;
  }

  completeTurn(): boolean {
    const shouldJump = this.active && !this.userScrolled;
    this.active = false;
    this.userScrolled = false;
    return shouldJump;
  }
}

export function scrollOffsetForViewportStart(
  viewportStartLine: number,
  totalLines: number,
  viewportRows: number,
): number {
  const rows = Math.max(1, viewportRows);
  const maxScrollOffset = Math.max(0, totalLines - rows);
  const start = Math.max(0, Math.min(viewportStartLine, maxScrollOffset));
  return maxScrollOffset - start;
}

export function autoJumpOffsetForRange(
  rangeStartLine: number,
  rangeEndLine: number,
  totalLines: number,
  viewportRows: number,
  maxScrollOffset: number,
): number | null {
  const rows = Math.max(1, viewportRows);
  const start = Math.max(0, Math.min(rangeStartLine, totalLines));
  const end = Math.max(start, Math.min(rangeEndLine, totalLines));
  if (end - start <= rows) return null;

  return Math.max(0, Math.min(totalLines - rows - start, maxScrollOffset));
}

export function autoJumpOffsetForResponse(
  responseStartLine: number,
  totalLines: number,
  viewportRows: number,
  maxScrollOffset: number,
): number | null {
  return autoJumpOffsetForRange(
    responseStartLine,
    totalLines,
    totalLines,
    viewportRows,
    maxScrollOffset,
  );
}
