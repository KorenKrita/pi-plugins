import { describe, expect, test } from "bun:test";

import {
  hasBlockingOverlay,
  resolveFullscreenSurface,
  resolveTranscriptGeometry,
  scrollViewportTo,
  waitForFreshLayout,
} from "./adapter.ts";

const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");

function fullscreenTui(overrides: Record<string, unknown> = {}) {
  return {
    [VIEWPORT_TUI]: true,
    setLayoutRoot() {},
    scrollBy() {},
    scrollToBottom() {},
    viewportTop: 0,
    isFollowingOutput: true,
    ...overrides,
  };
}

describe("resolveFullscreenSurface", () => {
  test("accepts a viewport TUI carrying the whole scroll surface", () => {
    const tui = fullscreenTui();
    expect(resolveFullscreenSurface(tui)).toBe(tui as any);
  });

  test("rejects a TUI without the viewport brand (inline transcript builds)", () => {
    const inline = { scrollBy() {}, scrollToBottom() {}, viewportTop: 0, isFollowingOutput: true };
    expect(resolveFullscreenSurface(inline)).toBeNull();
  });

  test("rejects a branded TUI whose scroll API is incomplete", () => {
    expect(resolveFullscreenSurface(fullscreenTui({ scrollBy: undefined }))).toBeNull();
    expect(resolveFullscreenSurface(fullscreenTui({ viewportTop: undefined }))).toBeNull();
    expect(resolveFullscreenSurface(fullscreenTui({ isFollowingOutput: undefined }))).toBeNull();
    expect(resolveFullscreenSurface(fullscreenTui({ setLayoutRoot: undefined }))).toBeNull();
  });

  test("rejects non-objects", () => {
    expect(resolveFullscreenSurface(null)).toBeNull();
    expect(resolveFullscreenSurface(undefined)).toBeNull();
    expect(resolveFullscreenSurface("tui")).toBeNull();
  });
});

function layoutFrame(options: {
  document?: unknown;
  scrollTop?: number;
  rectWidth?: number;
  rectHeight?: number;
  lines?: string[];
  getContentWidth?: (width: number) => number;
} = {}) {
  const document = options.document ?? { render: () => ["a", "b", "c"] };
  const scrollView = {
    children: [document],
    scrollTop: options.scrollTop ?? 7,
    getContentWidth: options.getContentWidth ?? ((width: number) => width),
  };
  const box = {
    rect: { width: options.rectWidth ?? 80, height: options.rectHeight ?? 10 },
    scrollView,
    scrollContentLines: options.lines ?? ["a", "b", "c"],
    children: [],
  };
  return {
    root: { rect: { width: 80, height: 24 }, children: [box] },
    primaryScrollView: scrollView,
  };
}

describe("resolveTranscriptGeometry", () => {
  test("reads document, width, viewport, content height and offset from the layout frame", () => {
    const document = { render: () => ["a", "b", "c", "d"] };
    const frame = layoutFrame({ document, scrollTop: 3, rectWidth: 100, rectHeight: 12, lines: ["a", "b", "c", "d"] });
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;

    expect(resolveTranscriptGeometry(surface)).toEqual({
      document,
      contentWidth: 100,
      viewportHeight: 12,
      contentHeight: 4,
      scrollTop: 3,
    });
  });

  test("honours the ScrollView's content width reservation for an always-on scrollbar", () => {
    const frame = layoutFrame({ rectWidth: 80, getContentWidth: (width: number) => width - 1 });
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)?.contentWidth).toBe(79);
  });

  test("returns null before any layout frame exists", () => {
    const surface = resolveFullscreenSurface(fullscreenTui())!;
    expect(resolveTranscriptGeometry(surface)).toBeNull();
  });

  test("returns null when the frame has no primary scroll view", () => {
    const frame = layoutFrame() as any;
    frame.primaryScrollView = undefined;
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)).toBeNull();
  });

  test("returns null when the scroll view has no renderable child", () => {
    const frame = layoutFrame({ document: { notRenderable: true } });
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)).toBeNull();
  });

  test("returns null when the primary scroll view is absent from the box tree", () => {
    const frame = layoutFrame() as any;
    frame.root.children = [];
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)).toBeNull();
  });

  test("returns null when getContentWidth throws", () => {
    const frame = layoutFrame({
      getContentWidth: () => {
        throw new Error("shape changed");
      },
    });
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)).toBeNull();
  });

  test("measures content height from the live document, not the frame's cached lines", () => {
    // The frame's cached lines are what a stale layout frame would report; the
    // live document is one answer taller. Measuring the document is what keeps a
    // jump from landing short right after a turn settles.
    const document = { render: () => Array.from({ length: 40 }, (_, index) => `line ${String(index)}`) };
    const frame = layoutFrame({ document, lines: ["stale", "stale"] });
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)?.contentHeight).toBe(40);
  });

  test("returns null when the live document render does not yield lines", () => {
    const frame = layoutFrame({ document: { render: () => undefined as any } });
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)).toBeNull();
  });

  test("returns null when the live document render throws", () => {
    const frame = layoutFrame({
      document: {
        render: () => {
          throw new Error("render failed");
        },
      },
    });
    const surface = resolveFullscreenSurface(fullscreenTui({ currentLayout: frame }))!;
    expect(resolveTranscriptGeometry(surface)).toBeNull();
  });
});

describe("waitForFreshLayout", () => {
  test("asks for a normal (non-forced) render and resolves once a new frame lands", async () => {
    const calls: unknown[] = [];
    const tui = fullscreenTui({ currentLayout: { generation: 1 } }) as Record<string, any>;
    tui.requestRender = (force?: boolean) => {
      calls.push(force);
      // Mimic the throttled render pass replacing the frame.
      setTimeout(() => {
        (tui as any).currentLayout = { generation: 2 };
      }, 8);
    };
    const surface = resolveFullscreenSurface(tui)!;

    await waitForFreshLayout(surface);

    // A forced render would reset render state and repaint the whole screen.
    expect(calls).toEqual([undefined]);
    expect((tui as any).currentLayout).toEqual({ generation: 2 });
  });

  test("gives up after the timeout when no new frame ever arrives", async () => {
    const tui = fullscreenTui({ currentLayout: { generation: 1 } });
    const surface = resolveFullscreenSurface(tui)!;

    const started = Date.now();
    await waitForFreshLayout(surface, 30);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(400);
    expect((tui as any).currentLayout).toEqual({ generation: 1 });
  });

  test("tolerates a TUI without requestRender and one that throws", async () => {
    await waitForFreshLayout(resolveFullscreenSurface(fullscreenTui())!, 10);
    await waitForFreshLayout(resolveFullscreenSurface(fullscreenTui({
      requestRender: () => {
        throw new Error("nope");
      },
    }))!, 10);
  });
});

describe("hasBlockingOverlay", () => {
  test("reports an overlay when the TUI says so", () => {
    const surface = resolveFullscreenSurface(fullscreenTui({ hasOverlay: () => true }))!;
    expect(hasBlockingOverlay(surface)).toBe(true);
  });

  test("treats a missing or throwing hasOverlay as no overlay", () => {
    expect(hasBlockingOverlay(resolveFullscreenSurface(fullscreenTui())!)).toBe(false);
    const throwing = resolveFullscreenSurface(fullscreenTui({
      hasOverlay: () => {
        throw new Error("nope");
      },
    }))!;
    expect(hasBlockingOverlay(throwing)).toBe(false);
  });
});

describe("scrollViewportTo", () => {
  test("converts an absolute target into a relative scrollBy and repaints", () => {
    const calls: number[] = [];
    let renders = 0;
    const surface = resolveFullscreenSurface(fullscreenTui({
      scrollBy: (lines: number) => calls.push(lines),
      requestRender: () => {
        renders += 1;
      },
    }))!;

    scrollViewportTo(surface, 180, 100);
    expect(calls).toEqual([-80]);
    expect(renders).toBe(1);
  });

  test("does nothing when the viewport is already at the target", () => {
    const calls: number[] = [];
    const surface = resolveFullscreenSurface(fullscreenTui({ scrollBy: (lines: number) => calls.push(lines) }))!;
    scrollViewportTo(surface, 100, 100);
    expect(calls).toEqual([]);
  });
});
