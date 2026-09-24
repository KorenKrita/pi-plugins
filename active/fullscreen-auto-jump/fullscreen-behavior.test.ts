// Full-pipeline test: the extension, loaded through Pi's real extension loader,
// driving a real upstream fullscreen TUI whose transcript contains a real Pi
// AssistantMessageComponent.
//
// This is the test that would catch a regression in the actual feature: hooks →
// adapter → assistant-range → policy → scroll. Upstream fullscreen source is
// expected at PI_MONO_MAIN (default /tmp/pi-mono-main); the suite skips without it.

import { beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const UPSTREAM = process.env.PI_MONO_MAIN ?? "/tmp/pi-mono-main";
const TUI_SRC = join(UPSTREAM, "packages/tui/src");
const available = existsSync(join(TUI_SRC, "tui-alt-screen.ts"));
const MIRROR = join(import.meta.dir, "node_modules", ".upstream-pi-tui-behavior");

const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));

let TuiAltScreen: any;
let ScrollView: any;
let VStack: any;
let Container: any;
let Text: any;
let AssistantMessageComponent: any;

class SinkTerminal {
  private onInput: ((data: string) => void) | undefined;
  constructor(public columns = 80, public rows = 24) {}
  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  stop(): void {
    this.onInput = undefined;
  }
  async drainInput(): Promise<void> {}
  write(): void {}
  get kittyProtocolActive(): boolean {
    return false;
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
  sendInput(data: string): void {
    this.onInput?.(data);
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

function assistantMessage(thinkingLines: number, answerLines: number) {
  const paragraph = (label: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${label} line ${String(index + 1)}`).join("\n\n");
  return {
    role: "assistant",
    content: [
      ...(thinkingLines > 0 ? [{ type: "thinking", thinking: paragraph("thought", thinkingLines) }] : []),
      { type: "text", text: paragraph("answer", answerLines) },
    ],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe.if(available)("fullscreen behavior", () => {
  beforeAll(async () => {
    rmSync(MIRROR, { recursive: true, force: true });
    cpSync(TUI_SRC, MIRROR, { recursive: true });
    const load = (relative: string) => import(pathToFileURL(join(MIRROR, relative)).href);
    const [alt, scroll, vstack, text, tui, assistant, theme] = await Promise.all([
      load("tui-alt-screen.ts"),
      load("components/scroll-view.ts"),
      load("components/v-stack.ts"),
      load("components/text.ts"),
      load("tui.ts"),
      import(pathToFileURL(join(dirname(codingAgentEntry), "modes/interactive/components/assistant-message.js")).href),
      import(pathToFileURL(join(dirname(codingAgentEntry), "modes/interactive/theme/theme.js")).href),
    ]);
    TuiAltScreen = alt.TuiAltScreen;
    ScrollView = scroll.ScrollView;
    VStack = vstack.VStack;
    Text = text.Text;
    Container = tui.Container;
    AssistantMessageComponent = assistant.AssistantMessageComponent;
    theme.initTheme("dark", false);
  });

  async function loadExtension() {
    const loaderPath = join(dirname(codingAgentEntry), "core/extensions/loader.js");
    const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
    const result = await loadExtensions([join(import.meta.dir, "index.ts")], import.meta.dir);
    expect(result.errors).toEqual([]);
    return result.extensions[0];
  }

  /** Compose the fullscreen layout the way interactive-mode does. */
  async function mount(options: { rows: number; historyLines: number; thinkingLines: number; answerLines: number }) {
    const terminal = new SinkTerminal(80, options.rows);
    const tui = new TuiAltScreen(terminal);
    const documentContainer = new Container();
    documentContainer.addChild(
      new Text(Array.from({ length: options.historyLines }, (_, i) => `history ${String(i + 1)}`).join("\n"), 0, 0),
    );
    const assistant = new AssistantMessageComponent(
      assistantMessage(options.thinkingLines, options.answerLines),
      false,
    );
    documentContainer.addChild(assistant);

    const transcript = new ScrollView(documentContainer, { follow: "end", primary: true, overscroll: "chain" });
    const dock = new VStack([new Text("editor", 0, 0), new Text("footer", 0, 0)]);
    tui.setLayoutRoot(
      new VStack([
        { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
      ]),
    );
    tui.start();
    await settle();

    const extension = await loadExtension();
    const notifications: Array<{ message: string; level?: string }> = [];
    const ui = {
      setWidget(_key: string, factory: unknown) {
        if (typeof factory === "function") (factory as (t: unknown) => any)(tui);
      },
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
    };
    const ctx: any = { mode: "tui", hasUI: true, ui };
    await extension.handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    return { terminal, tui, transcript, documentContainer, assistant, extension, ctx, notifications };
  }

  const settleTurn = async (extension: any, ctx: any) => {
    await extension.handlers.get("agent_settled")?.[0]?.({ type: "agent_settled" }, ctx);
    await settle();
  };

  const startTurn = async (extension: any, ctx: any) => {
    await extension.handlers.get("before_agent_start")?.[0]?.(
      { type: "before_agent_start", prompt: "hi", systemPrompt: "", systemPromptOptions: {} },
      ctx,
    );
    await settle();
  };

  test("a tall answer scrolls so its first line is at the top of the viewport", async () => {
    const { tui, transcript, documentContainer, assistant, extension, ctx } = await mount({
      rows: 14,
      historyLines: 40,
      thinkingLines: 6,
      answerLines: 30,
    });

    const bottom = transcript.scrollTop;
    await settleTurn(extension, ctx);

    expect(transcript.scrollTop).toBeLessThan(bottom);

    // The first visible transcript line must be the answer's first line: measure
    // where the assistant component's text starts in the rendered document.
    const contentWidth = transcript.getContentWidth(80);
    const documentLines = documentContainer.render(contentWidth);
    const firstAnswerLine = documentLines.findIndex((line: string) => line.includes("answer line 1"));
    expect(firstAnswerLine).toBeGreaterThan(0);
    expect(transcript.scrollTop).toBe(firstAnswerLine);

    // Thinking must be above the fold, not the jump target.
    const firstThoughtLine = documentLines.findIndex((line: string) => line.includes("thought line 1"));
    expect(firstThoughtLine).toBeGreaterThanOrEqual(0);
    expect(firstThoughtLine).toBeLessThan(firstAnswerLine);
    expect(assistant).toBeDefined();
    tui.stop();
  });

  test("a short answer is left alone at the bottom", async () => {
    const { tui, transcript, extension, ctx } = await mount({
      rows: 24,
      historyLines: 40,
      thinkingLines: 4,
      answerLines: 2,
    });

    const bottom = transcript.scrollTop;
    await settleTurn(extension, ctx);

    expect(transcript.scrollTop).toBe(bottom);
    expect(transcript.isFollowingEnd).toBe(true);
    tui.stop();
  });

  test("no jump when the user scrolled away and never returned to the bottom", async () => {
    const { terminal, tui, transcript, extension, ctx } = await mount({
      rows: 14,
      historyLines: 40,
      thinkingLines: 6,
      answerLines: 30,
    });

    terminal.sendInput("\x1b[<64;1;1M"); // wheel up over the transcript
    await settle();
    const scrolledTo = transcript.scrollTop;
    expect(transcript.isFollowingEnd).toBe(false);

    await settleTurn(extension, ctx);

    expect(transcript.scrollTop).toBe(scrolledTo);
    tui.stop();
  });

  test("scrolling away and back to the bottom still jumps", async () => {
    const { terminal, tui, transcript, documentContainer, extension, ctx } = await mount({
      rows: 14,
      historyLines: 40,
      thinkingLines: 6,
      answerLines: 30,
    });

    const bottom = transcript.scrollTop;
    terminal.sendInput("\x1b[<64;1;1M");
    await settle();
    expect(transcript.isFollowingEnd).toBe(false);
    terminal.sendInput("\x1b[<65;1;1M"); // wheel down, back to the end
    await settle();
    expect(transcript.isFollowingEnd).toBe(true);
    expect(transcript.scrollTop).toBe(bottom);

    await settleTurn(extension, ctx);

    const documentLines = documentContainer.render(transcript.getContentWidth(80));
    const firstAnswerLine = documentLines.findIndex((line: string) => line.includes("answer line 1"));
    expect(transcript.scrollTop).toBe(firstAnswerLine);
    expect(transcript.scrollTop).toBeLessThan(bottom);
    tui.stop();
  });

  test("a new turn re-pins to the bottom even after the previous turn's jump", async () => {
    const { tui, transcript, extension, ctx } = await mount({
      rows: 14,
      historyLines: 40,
      thinkingLines: 6,
      answerLines: 30,
    });

    await settleTurn(extension, ctx);
    const jumped = transcript.scrollTop;
    expect(transcript.isFollowingEnd).toBe(false);

    await startTurn(extension, ctx);

    expect(transcript.isFollowingEnd).toBe(true);
    expect(transcript.scrollTop).toBeGreaterThan(jumped);
    tui.stop();
  });

  test("an open overlay suppresses the jump", async () => {
    const { tui, transcript, extension, ctx } = await mount({
      rows: 14,
      historyLines: 40,
      thinkingLines: 6,
      answerLines: 30,
    });

    tui.showOverlay(new Text("dialog", 0, 0));
    await settle();
    const before = transcript.scrollTop;

    await settleTurn(extension, ctx);

    expect(transcript.scrollTop).toBe(before);
    tui.hideOverlay();
    tui.stop();
  });

  test("the command reports an active surface and its decision", async () => {
    const { tui, extension, ctx, notifications } = await mount({
      rows: 14,
      historyLines: 40,
      thinkingLines: 6,
      answerLines: 30,
    });

    await extension.commands.get("fullscreen-auto-jump")?.handler("", ctx);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toContain("active");
    expect(notifications[0]?.message).toMatch(/jumped to line \d+/);
    tui.stop();
  });

  test("measures the answer appended in the same tick as settle, with no render in between", async () => {
    // This is the real ordering: the final assistant message is added to the
    // transcript and `agent_settled` fires before the TUI's throttled render pass
    // has rebuilt the layout frame. A stale frame would under-measure the document
    // and the jump would land short of the answer's first line.
    const { tui, transcript, documentContainer, extension, ctx } = await mount({
      rows: 14,
      historyLines: 40,
      thinkingLines: 4,
      answerLines: 4,
    });

    const staleFrameHeight = (tui as any).currentLayout
      ? ((tui as any).currentLayout.primaryScrollView?.children?.[0]?.render(80)?.length ?? 0)
      : 0;
    expect(staleFrameHeight).toBeGreaterThan(0);

    // Append a tall answer and settle immediately — no awaits, no renders between.
    documentContainer.addChild(new AssistantMessageComponent(assistantMessage(3, 40), false));
    await extension.handlers.get("agent_settled")?.[0]?.({ type: "agent_settled" }, ctx);
    await settle();

    // Exact match: "answer line 1" is a prefix of "answer line 19".
    const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").trim();
    const documentLines: string[] = documentContainer.render(transcript.getContentWidth(80));
    const answerStarts: number[] = [];
    documentLines.forEach((line, index) => {
      if (plain(line) === "answer line 1") answerStarts.push(index);
    });
    expect(answerStarts).toHaveLength(2);
    const lastAnswerStart = answerStarts.at(-1)!;
    // The final answer begins past everything the pre-settle frame had measured.
    expect(lastAnswerStart).toBeGreaterThanOrEqual(staleFrameHeight);
    expect(transcript.scrollTop).toBe(lastAnswerStart);
    tui.stop();
  });
});

describe.if(!available)("fullscreen behavior", () => {
  test("skipped: upstream pi-tui source not found", () => {
    expect(available).toBe(false);
  });
});
