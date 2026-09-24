import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Container, TUI } from "@earendil-works/pi-tui";

import { findFinalAssistantTextRange } from "./assistant-range.ts";

describe("Pi 0.80.6 runtime smoke", () => {
  test("retains the TUI methods used by the compositor", () => {
    const prototype = TUI.prototype as any;
    expect(typeof prototype.addInputListener).toBe("function");
    expect(typeof prototype.getTopmostVisibleOverlay).toBe("function");
    expect(typeof prototype.render).toBe("function");
  });

  test("loads and installs through the real Pi extension lifecycle", async () => {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const loaderPath = join(dirname(codingAgentEntry), "core/extensions/loader.js");
    const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
    const extensionPath = join(import.meta.dir, "..", "index.ts");
    const result = await loadExtensions([extensionPath], join(import.meta.dir, ".."));
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);

    const extension = result.extensions[0];
    const start = extension.handlers.get("session_start")?.[0];
    const shutdown = extension.handlers.get("session_shutdown")?.[0];
    expect(typeof start).toBe("function");
    expect(typeof shutdown).toBe("function");

    let editorFactory: any = () => ({ render: () => ["editor"], handleInput() {}, invalidate() {} });
    const previousFactory = editorFactory;
    const notifications: string[] = [];
    const ui = {
      getEditorComponent: () => editorFactory,
      setEditorComponent: (factory: any) => { editorFactory = factory; },
      notify: (message: string) => { notifications.push(message); },
    };
    const ctx: any = { mode: "tui", ui };
    await start?.({ type: "session_start", reason: "startup" }, ctx);
    expect(editorFactory).not.toBe(previousFactory);

    const renderable = (children: any[] = []) => ({ children, render: () => [] });
    const writes: string[] = [];
    const tui: any = {
      children: [renderable(), renderable(), renderable(), renderable(), renderable()],
      terminal: { columns: 80, rows: 20, write: (data: string) => { writes.push(data); } },
      render(width: number) { return this.children.flatMap((child: any) => child.render(width)); },
      doRender() {},
      compositeLineAt(base: string) { return base; },
      addInputListener() { return () => {}; },
      requestRender() {},
      getShowHardwareCursor() { return false; },
      getTopmostVisibleOverlay() { return undefined; },
    };
    const editor = editorFactory(tui, {}, {});
    tui.children[2].children = [editor];
    await Bun.sleep(30);

    const command = extension.commands.get("fixed-input");
    await command?.handler("", ctx);
    expect(notifications).toContain("Fixed input is active");

    await shutdown?.({ type: "session_shutdown", reason: "reload" }, ctx);
    expect(ui.getEditorComponent()).toBe(previousFactory);
  });

  test("resolves text from the real AssistantMessageComponent shape", async () => {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const componentPath = join(
      dirname(codingAgentEntry),
      "modes/interactive/components/assistant-message.js",
    );
    const themePath = join(dirname(codingAgentEntry), "modes/interactive/theme/theme.js");
    const [{ AssistantMessageComponent }, { initTheme }] = await Promise.all([
      import(pathToFileURL(componentPath).href),
      import(pathToFileURL(themePath).href),
    ]);
    initTheme("dark", false);
    const component = new AssistantMessageComponent({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reasoning" },
        { type: "text", text: "final answer" },
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
    }, false);
    const root = new Container();
    root.addChild(component);

    const range = findFinalAssistantTextRange(root, 80);
    expect(range?.lineCount).toBeGreaterThan(0);
    expect(range?.startLine).toBeGreaterThan(1);
  });
});
