import { describe, expect, test } from "bun:test";

import { TerminalSplitCompositor } from "./terminal-split.ts";

class Lines {
  constructor(public lines: string[]) {}
  render(): string[] { return this.lines; }
}

class Container {
  constructor(public children: any[] = []) {}
  render(width: number): string[] {
    return this.children.flatMap((child) => child.render(width));
  }
}

function assistant(content: any[], renderedChildren: any[]) {
  const contentContainer = new Container(renderedChildren);
  return Object.assign(new Container([contentContainer]), {
    lastMessage: { role: "assistant", content },
    contentContainer,
  });
}

function createHarness(options: {
  rows?: number;
  children?: any[];
  onCopy?: (text: string) => void | Promise<void>;
  onCopyError?: (error: Error) => void;
} = {}) {
  const writes: string[] = [];
  let inputListener: ((data: string) => { consume?: boolean; data?: string } | undefined) | null = null;
  const terminal = {
    columns: 80,
    rows: options.rows ?? 10,
    write(data: string) { writes.push(data); },
  };
  const root = new Container(options.children ?? [new Lines(Array.from({ length: 30 }, (_, i) => `line-${i}`))]);
  const tui: any = Object.assign(root, {
    terminal,
    requestRender() {},
    doRender() {},
    compositeLineAt(base: string) { return base; },
    addInputListener(listener: typeof inputListener) {
      inputListener = listener;
      return () => { inputListener = null; };
    },
    getTopmostVisibleOverlay() { return undefined; },
  });
  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["editor"], cursor: null }),
    onCopySelection: options.onCopy,
    onCopyError: options.onCopyError,
  });
  return {
    compositor,
    terminal,
    tui,
    writes,
    input: (data: string) => {
      if (!inputListener) throw new Error("input listener not installed");
      return inputListener(data);
    },
  };
}

describe("TerminalSplitCompositor integration", () => {
  test("jumps to actual final text rather than thinking", () => {
    const final = assistant(
      [
        { type: "thinking", thinking: "hidden process" },
        { type: "text", text: "final answer" },
      ],
      [
        new Lines([""]),
        new Lines(Array.from({ length: 15 }, (_, i) => `thinking-${i}`)),
        new Lines([""]),
        new Lines(Array.from({ length: 12 }, (_, i) => `answer-${i}`)),
      ],
    );
    const harness = createHarness({ children: [new Lines(["before"]), final] });
    harness.compositor.install();
    harness.compositor.beginAgentResponse();

    expect(harness.compositor.jumpToAgentResponseStartIfLong()).toBe(true);
    const internal = harness.compositor as any;
    expect(internal.visibleRootStart).toBe(18);

    harness.compositor.dispose();
    expect(harness.terminal.rows).toBe(10);
  });

  test("manual scroll suppresses the settled final-text jump", () => {
    const final = assistant(
      [{ type: "text", text: "final answer" }],
      [new Lines([""]), new Lines(Array.from({ length: 20 }, (_, i) => `answer-${i}`))],
    );
    const harness = createHarness({ children: [new Lines(Array.from({ length: 20 }, (_, i) => `old-${i}`)), final] });
    harness.compositor.install();
    harness.compositor.beginAgentResponse();

    expect(harness.input("\x1b[<64;1;1M")).toEqual({ consume: true });
    expect(harness.compositor.jumpToAgentResponseStartIfLong()).toBe(false);

    harness.compositor.dispose();
  });

  test("preserves the chosen content anchor through temporary shrink and regrowth", () => {
    const original = Array.from({ length: 30 }, (_, i) => `line-${i}`);
    const harness = createHarness({ children: [new Lines([...original])] });
    harness.compositor.install();
    const internal = harness.compositor as any;
    internal.refreshRootWindow(80);
    expect(harness.input("\x1b[<64;1;1M")).toEqual({ consume: true });
    const anchoredSignature = internal.viewportAnchor.signature;

    harness.tui.children[0].lines = ["tiny"];
    internal.refreshRootWindow(80);
    expect(internal.scrollOffset).toBe(0);
    expect(internal.viewportAnchor.signature).toBe(anchoredSignature);

    harness.tui.children[0].lines = ["new-1", "new-2", ...original];
    internal.refreshRootWindow(80);
    expect(internal.scrollOffset).toBeGreaterThan(0);
    expect(internal.visibleRootLines[0]).toBe(anchoredSignature);

    harness.compositor.dispose();
  });

  test("passes through unhandled SGR mouse packets and right-clicks without a selection", () => {
    const harness = createHarness();
    harness.compositor.install();

    expect(harness.input("\x1b[<1;2;2M")).toBeUndefined();
    expect(harness.input("\x1b[<2;2;2M")).toBeUndefined();
    expect(harness.input("\x1b[<64;2;2M")).toEqual({ consume: true });

    harness.compositor.dispose();
  });

  test("non-capturing overlays do not disable scrolling", () => {
    const harness = createHarness();
    harness.tui.getTopmostVisibleOverlay = () => undefined;
    harness.compositor.install();

    expect(harness.input("\x1b[<64;2;2M")).toEqual({ consume: true });
    harness.tui.getTopmostVisibleOverlay = () => ({ options: {} });
    expect(harness.input("\x1b[<64;2;2M")).toBeUndefined();

    harness.compositor.dispose();
  });

  test("copies sanitized selection once without rewriting clipboard", async () => {
    const copies: string[] = [];
    const harness = createHarness({ onCopy: (text) => { copies.push(text); } });
    harness.compositor.install();
    const internal = harness.compositor as any;
    internal.refreshRootWindow(80);
    const line = internal.visibleRootStart;
    harness.tui.children[0].lines[line] = "safe\x1b]52;c;payload\x07 text\x00";
    internal.refreshRootWindow(80);
    internal.selectionArea = "root";
    internal.selectionAnchor = { line, col: 0 };
    internal.selectionFocus = { line, col: 40 };
    internal.selectionDragging = true;
    internal.preserveSelectionFocusOnRelease = true;

    expect(harness.input("\x1b[<0;40;1m")).toEqual({ consume: true });
    expect(harness.input("\x1b[<2;1;1M")).toEqual({ consume: true });
    await Bun.sleep(250);
    expect(copies).toEqual(["safe text"]);

    harness.compositor.dispose();
  });

  test("reports asynchronous clipboard failures", async () => {
    const errors: Error[] = [];
    const harness = createHarness({
      onCopy: async () => { throw new Error("clipboard unavailable"); },
      onCopyError: (error) => errors.push(error),
    });
    harness.compositor.install();
    const internal = harness.compositor as any;

    internal.copySelection("text");
    await Bun.sleep(0);

    expect(errors.map((error) => error.message)).toEqual(["clipboard unavailable"]);
    harness.compositor.dispose();
  });

  test("passes writes through unchanged on a one-row terminal", () => {
    const harness = createHarness({ rows: 1 });
    harness.compositor.install();
    harness.writes.length = 0;

    harness.terminal.write("payload");

    expect(harness.writes).toEqual(["payload"]);
    harness.compositor.dispose();
  });

  test("dispose preserves patches installed later by another extension", () => {
    const harness = createHarness();
    const hiddenTarget = { render: (_width: number) => ["visible"] };
    harness.compositor.hideRenderable(hiddenTarget);
    harness.compositor.install();

    const foreignWrite = (_data: string) => {};
    const foreignRender = (_width: number) => ["foreign"];
    const foreignDoRender = () => {};
    const foreignComposite = () => "foreign";
    const foreignHiddenRender = (_width: number) => ["foreign-hidden"];
    harness.terminal.write = foreignWrite;
    harness.tui.render = foreignRender;
    harness.tui.doRender = foreignDoRender;
    harness.tui.compositeLineAt = foreignComposite;
    hiddenTarget.render = foreignHiddenRender;
    Object.defineProperty(harness.terminal, "rows", { configurable: true, value: 77 });

    harness.compositor.dispose();

    expect(harness.terminal.write).toBe(foreignWrite);
    expect(harness.tui.render).toBe(foreignRender);
    expect(harness.tui.doRender).toBe(foreignDoRender);
    expect(harness.tui.compositeLineAt).toBe(foreignComposite);
    expect(hiddenTarget.render).toBe(foreignHiddenRender);
    expect(harness.terminal.rows).toBe(77);
  });

  test("restores an active modifyOtherKeys mode after leaving alternate screen", () => {
    const harness = createHarness();
    (harness.terminal as any)._modifyOtherKeysActive = true;
    harness.compositor.install();
    harness.writes.length = 0;

    harness.compositor.dispose();

    const output = harness.writes.join("");
    expect(output).toContain("\x1b[>4;0m");
    expect(output.indexOf("\x1b[?1049l")).toBeLessThan(output.lastIndexOf("\x1b[>4;2m"));
  });

  test("uses Kitty push and pop without re-enabling after pop", () => {
    const harness = createHarness();
    (harness.terminal as any).kittyProtocolActive = true;
    harness.compositor.install();
    expect(harness.writes.join("")).toContain("\x1b[>7u");
    harness.writes.length = 0;

    harness.compositor.dispose();

    const output = harness.writes.join("");
    expect(output).toContain("\x1b[<u");
    expect(output).not.toContain("\x1b[>7u");
  });

  test("dispose removes only its own rows override when rows were inherited", () => {
    const writes: string[] = [];
    const terminal = Object.create({ get rows() { return 12; } });
    terminal.columns = 80;
    terminal.write = (data: string) => writes.push(data);
    const tui: any = Object.assign(new Container([new Lines(["root"])]), {
      terminal,
      requestRender() {},
      addInputListener() { return () => {}; },
      getTopmostVisibleOverlay() { return undefined; },
    });
    const compositor = new TerminalSplitCompositor({
      tui,
      terminal,
      renderCluster: () => ({ lines: ["editor"], cursor: null }),
    });

    compositor.install();
    expect(Object.hasOwn(terminal, "rows")).toBe(true);
    compositor.dispose();
    expect(Object.hasOwn(terminal, "rows")).toBe(false);
    expect(terminal.rows).toBe(12);
  });
});
