// Prove the extension is inert on the *currently published* Pi (0.83.0), which
// renders the transcript inline and has no fullscreen surface to scroll.
//
// The extension is loaded through Pi's real extension loader and driven through
// the real hook names, so a renamed hook or a changed loader contract fails here.

import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveFullscreenSurface } from "./adapter.ts";

const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));

async function loadExtension() {
  const loaderPath = join(dirname(codingAgentEntry), "core/extensions/loader.js");
  const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
  const result = await loadExtensions([join(import.meta.dir, "index.ts")], import.meta.dir);
  expect(result.errors).toEqual([]);
  expect(result.extensions).toHaveLength(1);
  return result.extensions[0];
}

function fakeUi() {
  const widgets: Array<{ key: string; factory: unknown }> = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  return {
    widgets,
    notifications,
    setWidget(key: string, factory: unknown) {
      widgets.push({ key, factory });
    },
    notify(message: string, level?: string) {
      notifications.push({ message, level });
    },
  };
}

/** The 0.83 inline TUI shape: children/render/requestRender, no viewport brand. */
function inlineTui() {
  return {
    children: [] as unknown[],
    terminal: { columns: 80, rows: 24, write() {} },
    render: () => [] as string[],
    requestRender() {},
    hasOverlay: () => false,
    addInputListener: () => () => {},
  };
}

describe("Pi 0.83.0 runtime", () => {
  test("the published pi-tui really has no fullscreen transcript surface", async () => {
    const tui = await import("@earendil-works/pi-tui");
    expect("TuiAltScreen" in tui).toBe(false);
    expect("ScrollView" in tui).toBe(false);
    expect("isViewportTUI" in tui).toBe(false);
  });

  test("loads through the real extension lifecycle and registers the documented hooks", async () => {
    const extension = await loadExtension();
    for (const hook of ["session_start", "before_agent_start", "agent_settled", "session_shutdown"]) {
      expect(typeof extension.handlers.get(hook)?.[0]).toBe("function");
    }
    expect(extension.commands.has("fullscreen-auto-jump")).toBe(true);
  });

  test("captures the TUI without leaving a widget behind", async () => {
    const extension = await loadExtension();
    const ui = fakeUi();
    const ctx: any = { mode: "tui", hasUI: true, ui };

    await extension.handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    expect(ui.widgets.map((entry) => entry.key)).toEqual([
      "__fullscreen_auto_jump_capture",
      "__fullscreen_auto_jump_capture",
    ]);
    // Installed, then immediately cleared: nothing renders.
    expect(ui.widgets[0]?.factory).toBeInstanceOf(Function);
    expect(ui.widgets[1]?.factory).toBeUndefined();

    const captured = (ui.widgets[0]!.factory as (tui: unknown) => any)(inlineTui());
    expect(captured.render(80)).toEqual([]);
  });

  test("an inline 0.83 TUI is not accepted as a fullscreen surface", () => {
    expect(resolveFullscreenSurface(inlineTui())).toBeNull();
  });

  test("both turn hooks are silent no-ops on 0.83 and never touch the TUI", async () => {
    const extension = await loadExtension();
    const ui = fakeUi();
    const ctx: any = { mode: "tui", hasUI: true, ui };
    await extension.handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

    const tui = inlineTui();
    const touched: string[] = [];
    for (const method of ["requestRender", "render"] as const) {
      const original = tui[method] as (...args: any[]) => any;
      (tui as any)[method] = (...args: any[]) => {
        touched.push(method);
        return original.apply(tui, args);
      };
    }
    (ui.widgets[0]!.factory as (tui: unknown) => any)(tui);

    await extension.handlers.get("before_agent_start")?.[0]?.(
      { type: "before_agent_start", prompt: "hi", systemPrompt: "", systemPromptOptions: {} },
      ctx,
    );
    await extension.handlers.get("agent_settled")?.[0]?.({ type: "agent_settled" }, ctx);

    expect(touched).toEqual([]);
    expect(ui.notifications).toEqual([]);
  });

  test("the command reports inactive instead of failing", async () => {
    const extension = await loadExtension();
    const ui = fakeUi();
    const ctx: any = { mode: "tui", hasUI: true, ui };
    await extension.handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);
    (ui.widgets[0]!.factory as (tui: unknown) => any)(inlineTui());

    await extension.commands.get("fullscreen-auto-jump")?.handler("", ctx);

    expect(ui.notifications).toHaveLength(1);
    expect(ui.notifications[0]?.message).toContain("inactive");
    expect(ui.notifications[0]?.level).toBe("warning");
  });

  test("stays inert outside the TUI (headless / print mode)", async () => {
    const extension = await loadExtension();
    const ui = fakeUi();
    const ctx: any = { mode: "print", hasUI: false, ui };
    await extension.handlers.get("session_start")?.[0]?.({ type: "session_start", reason: "startup" }, ctx);
    expect(ui.widgets).toEqual([]);
  });
});
