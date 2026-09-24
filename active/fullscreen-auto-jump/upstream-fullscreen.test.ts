// Integration test against the *real* unreleased fullscreen TUI.
//
// Pi 0.83.0 (the published version) has no alternate-screen transcript, so the
// only way to prove the adapter reads the right internals is to drive the actual
// upstream `TuiAltScreen` + `ScrollView` + layout engine. The upstream source is
// expected at PI_MONO_MAIN (default /tmp/pi-mono-main); the whole suite skips
// when it is absent, so this file never fails on a machine without the clone.
//
// The clone is unbuilt and has no node_modules, so its sources are mirrored into
// this extension's node_modules/.upstream-pi-tui — that makes `marked` and
// `get-east-asian-width` resolve through our own dependency tree.

import { beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveFullscreenSurface, resolveTranscriptGeometry, scrollViewportTo } from "./adapter.ts";
import { decideJump } from "./policy.ts";

const UPSTREAM = process.env.PI_MONO_MAIN ?? "/tmp/pi-mono-main";
const TUI_SRC = join(UPSTREAM, "packages/tui/src");
const available = existsSync(join(TUI_SRC, "tui-alt-screen.ts"));
const MIRROR = join(import.meta.dir, "node_modules", ".upstream-pi-tui");

let TuiAltScreen: any;
let ScrollView: any;
let VStack: any;
let Text: any;

/**
 * Minimal Terminal implementation: the adapter only needs layout to be computed,
 * so output is collected rather than emulated (avoids an @xterm/headless dep).
 */
class SinkTerminal {
  readonly writes: string[] = [];
  private onInput: ((data: string) => void) | undefined;

  constructor(public columns = 80, public rows = 24) {}

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.onInput = onInput;
  }
  stop(): void {
    this.onInput = undefined;
  }
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
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

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));


describe.if(available)("upstream fullscreen integration", () => {
  beforeAll(async () => {
    rmSync(MIRROR, { recursive: true, force: true });
    cpSync(TUI_SRC, MIRROR, { recursive: true });
    const load = (relative: string) => import(pathToFileURL(join(MIRROR, relative)).href);
    const [alt, scroll, vstack, text] = await Promise.all([
      load("tui-alt-screen.ts"),
      load("components/scroll-view.ts"),
      load("components/v-stack.ts"),
      load("components/text.ts"),
    ]);
    TuiAltScreen = alt.TuiAltScreen;
    ScrollView = scroll.ScrollView;
    VStack = vstack.VStack;
    Text = text.Text;
  });

  const mount = async (documentLines: string[], rows: number) => {
    const terminal = new SinkTerminal(80, rows);
    const tui = new TuiAltScreen(terminal);
    const document = new Text(documentLines.join("\n"), 0, 0);
    const transcript = new ScrollView(document, { follow: "end", primary: true, overscroll: "chain" });
    const dock = new VStack([new Text("editor", 0, 0), new Text("footer", 0, 0)]);
    tui.setLayoutRoot(
      new VStack([
        { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
      ]),
    );
    tui.start();
    await settle();
    return { terminal, tui, document, transcript };
  };

  test("the real TuiAltScreen is recognised as a fullscreen surface", async () => {
    const { tui } = await mount(["a", "b", "c"], 10);
    expect(resolveFullscreenSurface(tui)).toBe(tui);
    tui.stop();
  });

  test("geometry matches the real ScrollView and layout frame", async () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${String(index + 1)}`);
    const { tui, document, transcript } = await mount(lines, 12);
    const surface = resolveFullscreenSurface(tui)!;

    const geometry = resolveTranscriptGeometry(surface)!;
    expect(geometry).not.toBeNull();
    expect(geometry.document).toBe(document);
    expect(geometry.contentHeight).toBe(50);
    // 12 terminal rows minus the 2-row dock.
    expect(geometry.viewportHeight).toBe(10);
    expect(geometry.contentWidth).toBe(80);
    expect(geometry.scrollTop).toBe(transcript.scrollTop);
    expect(transcript.scrollTop).toBe(40);
    tui.stop();
  });

  test("scrollViewportTo lands exactly on an absolute target and clears follow", async () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${String(index + 1)}`);
    const { tui, transcript } = await mount(lines, 12);
    const surface = resolveFullscreenSurface(tui)!;
    const before = resolveTranscriptGeometry(surface)!;

    scrollViewportTo(surface, before.scrollTop, 8);
    await settle();

    expect(transcript.scrollTop).toBe(8);
    expect(surface.viewportTop).toBe(8);
    expect(surface.isFollowingOutput).toBe(false);
    expect(resolveTranscriptGeometry(surface)!.scrollTop).toBe(8);
    tui.stop();
  });

  test("scrollToBottom restores follow so a new turn streams in view", async () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${String(index + 1)}`);
    const { tui, transcript } = await mount(lines, 12);
    const surface = resolveFullscreenSurface(tui)!;

    scrollViewportTo(surface, surface.viewportTop, 5);
    await settle();
    expect(surface.isFollowingOutput).toBe(false);

    surface.scrollToBottom();
    await settle();
    expect(surface.isFollowingOutput).toBe(true);
    expect(transcript.scrollTop).toBe(40);
    tui.stop();
  });

  test("the wheel-driven follow state is what the policy reads to cancel a jump", async () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${String(index + 1)}`);
    const { terminal, tui } = await mount(lines, 12);
    const surface = resolveFullscreenSurface(tui)!;

    // SGR wheel-up over the transcript area.
    terminal.sendInput("\x1b[<64;1;1M");
    await settle();
    expect(surface.isFollowingOutput).toBe(false);

    const geometry = resolveTranscriptGeometry(surface)!;
    expect(decideJump({
      rangeStart: 10,
      rangeEnd: 45,
      viewportHeight: geometry.viewportHeight,
      contentHeight: geometry.contentHeight,
      scrollTop: geometry.scrollTop,
      isFollowingOutput: surface.isFollowingOutput,
    })).toEqual({ jump: false, reason: "user-scrolled-away" });
    tui.stop();
  });

  test("end-to-end: a tall answer jumps to its first line", async () => {
    const documentLines = [
      ...Array.from({ length: 20 }, (_, index) => `history ${String(index + 1)}`),
      ...Array.from({ length: 30 }, (_, index) => `answer ${String(index + 1)}`),
    ];
    const { tui, transcript } = await mount(documentLines, 12);
    const surface = resolveFullscreenSurface(tui)!;
    const geometry = resolveTranscriptGeometry(surface)!;

    const decision = decideJump({
      rangeStart: 20,
      rangeEnd: 50,
      viewportHeight: geometry.viewportHeight,
      contentHeight: geometry.contentHeight,
      scrollTop: geometry.scrollTop,
      isFollowingOutput: surface.isFollowingOutput,
    });
    expect(decision).toEqual({ jump: true, scrollTop: 20 });
    if (!decision.jump) throw new Error("unreachable");

    scrollViewportTo(surface, geometry.scrollTop, decision.scrollTop);
    await settle();
    expect(transcript.scrollTop).toBe(20);
    tui.stop();
  });
});

describe.if(!available)("upstream fullscreen integration", () => {
  test("skipped: upstream pi-tui source not found", () => {
    expect(available).toBe(false);
  });
});
