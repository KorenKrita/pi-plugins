import { terminalLineSignature } from "./terminal-text.ts";

interface AnchorContextLine {
  offset: number;
  signature: string;
}

export interface ViewportAnchor {
  signature: string | null;
  context: AnchorContextLine[];
  rowOffset: number;
  logicalStartLine: number;
  expectedLine: number;
}

export interface ResolvedViewportAnchor {
  startLine: number;
  matched: boolean;
}

function captureContext(lines: readonly string[], line: number): AnchorContextLine[] {
  const context: AnchorContextLine[] = [];
  for (let offset = -2; offset <= 2; offset++) {
    if (offset === 0) continue;
    const candidate = line + offset;
    if (candidate < 0 || candidate >= lines.length) continue;
    context.push({ offset, signature: terminalLineSignature(lines[candidate] ?? "") });
  }
  return context;
}

export function captureViewportAnchor(
  lines: readonly string[],
  startLine: number,
  viewportRows: number,
): ViewportAnchor {
  const rows = Math.max(1, viewportRows);
  const logicalStartLine = Math.max(0, startLine);
  const end = Math.min(lines.length, logicalStartLine + rows);

  for (let line = logicalStartLine; line < end; line++) {
    const signature = terminalLineSignature(lines[line] ?? "");
    if (signature) {
      return {
        signature,
        context: captureContext(lines, line),
        rowOffset: line - logicalStartLine,
        logicalStartLine,
        expectedLine: line,
      };
    }
  }

  return {
    signature: null,
    context: [],
    rowOffset: 0,
    logicalStartLine,
    expectedLine: logicalStartLine,
  };
}

function contextScore(anchor: ViewportAnchor, lines: readonly string[], line: number): number {
  let score = 0;
  for (const contextLine of anchor.context) {
    const candidate = line + contextLine.offset;
    if (candidate < 0 || candidate >= lines.length) continue;
    if (terminalLineSignature(lines[candidate] ?? "") === contextLine.signature) score += 1;
  }
  return score;
}

export function resolveViewportAnchor(
  anchor: ViewportAnchor,
  lines: readonly string[],
  viewportRows: number,
): ResolvedViewportAnchor {
  const rows = Math.max(1, viewportRows);
  const maxStart = Math.max(0, lines.length - rows);
  let desiredStart = anchor.logicalStartLine;
  let matched = false;

  if (anchor.signature) {
    let bestLine = -1;
    let bestScore = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let line = 0; line < lines.length; line++) {
      if (terminalLineSignature(lines[line] ?? "") !== anchor.signature) continue;
      const score = contextScore(anchor, lines, line);
      const distance = Math.abs(line - anchor.expectedLine);
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        bestLine = line;
        bestScore = score;
        bestDistance = distance;
      }
    }

    if (bestLine !== -1) {
      desiredStart = bestLine - anchor.rowOffset;
      matched = true;
    }
  }

  return {
    startLine: Math.max(0, Math.min(desiredStart, maxStart)),
    matched,
  };
}
