// Version-tolerant bridge to Pi's fullscreen (alternate-screen) transcript.
//
// Public surface used when available: `viewportTop`, `isFollowingOutput`,
// `scrollBy`, `scrollToBottom`, `hasOverlay`, `requestRender`, `terminal`.
//
// Two things the public surface does not expose are read defensively from the
// last computed layout frame: the primary ScrollView and its viewport/content
// geometry. Everything is probed and type-checked at call time, so a Pi build
// without fullscreen — or one that reshapes these internals — degrades to a
// no-op instead of throwing.

const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");

export interface FullscreenSurface {
  readonly viewportTop: number;
  readonly isFollowingOutput: boolean;
  scrollBy(lines: number): void;
  scrollToBottom(): void;
  hasOverlay?(): boolean;
  requestRender?(force?: boolean): void;
  terminal?: { columns?: number };
}

export interface TranscriptGeometry {
  /** The rendered document inside the transcript ScrollView. */
  document: unknown;
  /** Width the transcript content was rendered at. */
  contentWidth: number;
  /** Rows the transcript viewport shows. */
  viewportHeight: number;
  /** Total document height, measured from the live document at contentWidth. */
  contentHeight: number;
  /** Current viewport offset. */
  scrollTop: number;
}

interface LayoutRectLike {
  width: number;
  height: number;
}

interface LayoutBoxLike {
  rect?: LayoutRectLike;
  children?: unknown[];
  scrollView?: unknown;
  scrollContentLines?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFn(value: unknown): value is (...args: any[]) => any {
  return typeof value === "function";
}

/**
 * Return the fullscreen scroll surface, or null when this Pi build renders the
 * transcript inline (no alternate screen, hence nothing to scroll).
 */
export function resolveFullscreenSurface(tui: unknown): FullscreenSurface | null {
  if (!isRecord(tui)) return null;
  if ((tui as Record<PropertyKey, unknown>)[VIEWPORT_TUI] !== true) return null;
  if (!isFn(tui.setLayoutRoot) || !isFn(tui.scrollBy) || !isFn(tui.scrollToBottom)) return null;
  if (typeof tui.viewportTop !== "number" || typeof tui.isFollowingOutput !== "boolean") return null;
  return tui as unknown as FullscreenSurface;
}

function findScrollViewBox(box: unknown, scrollView: unknown): LayoutBoxLike | null {
  if (!isRecord(box)) return null;
  const candidate = box as LayoutBoxLike;
  if (candidate.scrollView === scrollView) return candidate;
  if (!Array.isArray(candidate.children)) return null;
  for (const child of candidate.children) {
    const found = findScrollViewBox(child, scrollView);
    if (found) return found;
  }
  return null;
}

/**
 * Read the transcript's geometry from the most recent layout frame. Returns null
 * whenever the expected shape is not present, which also covers "no frame has
 * been computed yet".
 *
 * Only the *viewport* dimensions are taken from the frame. Content height is
 * measured from the live document, because the frame is only refreshed inside the
 * TUI's throttled render pass: right after a turn settles the frame can still
 * describe the document from before the final answer was appended, and a stale
 * content height would make the jump land short.
 */
export function resolveTranscriptGeometry(surface: FullscreenSurface): TranscriptGeometry | null {
  const frame = (surface as unknown as Record<string, unknown>).currentLayout;
  if (!isRecord(frame)) return null;

  const scrollView = frame.primaryScrollView;
  if (!isRecord(scrollView)) return null;
  if (typeof scrollView.scrollTop !== "number" || !isFn(scrollView.getContentWidth)) return null;

  const document = Array.isArray(scrollView.children) ? scrollView.children[0] : undefined;
  if (!isRecord(document) || !isFn(document.render)) return null;

  const box = findScrollViewBox(frame.root, scrollView);
  const rectWidth = box?.rect?.width;
  const rectHeight = box?.rect?.height;
  if (typeof rectWidth !== "number" || typeof rectHeight !== "number") return null;

  let contentWidth: number;
  let contentHeight: number;
  try {
    contentWidth = scrollView.getContentWidth(rectWidth);
    if (typeof contentWidth !== "number" || contentWidth <= 0) return null;
    const lines = document.render(contentWidth);
    if (!Array.isArray(lines)) return null;
    contentHeight = lines.length;
  } catch {
    return null;
  }

  return {
    document,
    contentWidth,
    viewportHeight: rectHeight,
    contentHeight,
    scrollTop: scrollView.scrollTop,
  };
}

export function hasBlockingOverlay(surface: FullscreenSurface): boolean {
  try {
    return surface.hasOverlay?.() === true;
  } catch {
    return false;
  }
}

/**
 * Wait until the TUI has laid out the final document.
 *
 * The layout frame is only rebuilt inside the TUI's render pass, which is
 * throttled to ~16ms. Right after a turn settles the frame can still describe the
 * document from before the answer was appended, and the ScrollView clamps scrolls
 * against that stale content height.
 *
 * A plain `requestRender()` is used deliberately: the forced variant resets the
 * render state, which repaints the whole screen (and drops Kitty images) on every
 * turn. Instead the frame identity is polled until a new one appears, bounded so a
 * build that never re-renders cannot hang the hook.
 */
export async function waitForFreshLayout(surface: FullscreenSurface, timeoutMs = 120): Promise<void> {
  const frameOf = () => (surface as unknown as Record<string, unknown>).currentLayout;
  const before = frameOf();
  try {
    surface.requestRender?.();
  } catch {
    return;
  }

  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 4));
    if (frameOf() !== before) return;
  }
}

/** Move the viewport to an absolute offset using only the public scroll API. */
export function scrollViewportTo(surface: FullscreenSurface, currentScrollTop: number, targetScrollTop: number): void {
  const delta = targetScrollTop - currentScrollTop;
  if (delta === 0) return;
  surface.scrollBy(delta);
  surface.requestRender?.();
}
