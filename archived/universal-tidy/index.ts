import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  formatDuration,
  fullTextResult,
  secondaryDetail,
  summarizeReasoning,
  summarizeResult,
  summarizeTarget,
} from "./format";

const PATCH_STATE = Symbol.for("korenkrita.pi.universal-tidy.patch.v1");

interface Timing {
  elapsedMs: number;
  isError: boolean;
}

interface PatchState {
  refCount: number;
  startedAt: Map<string, number>;
  completed: Map<string, Timing>;
  timers: Map<string, ReturnType<typeof setInterval>>;
  original: {
    hasRendererDefinition: (...args: unknown[]) => boolean;
    getRenderShell: (...args: unknown[]) => "default" | "self";
    getCallRenderer: (...args: unknown[]) => unknown;
    getResultRenderer: (...args: unknown[]) => unknown;
  };
  patched: {
    hasRendererDefinition: (...args: unknown[]) => boolean;
    getRenderShell: (...args: unknown[]) => "self";
    getCallRenderer: (...args: unknown[]) => unknown;
    getResultRenderer: (...args: unknown[]) => unknown;
  };
}

interface ToolExecutionPrototype {
  toolName?: string;
  [PATCH_STATE]?: PatchState;
  hasRendererDefinition: (...args: unknown[]) => boolean;
  getRenderShell: (...args: unknown[]) => "default" | "self";
  getCallRenderer: (...args: unknown[]) => unknown;
  getResultRenderer: (...args: unknown[]) => unknown;
}

type Theme = {
  fg(name: string, text: string): string;
  bg(name: string, text: string): string;
  bold(text: string): string;
};

type RenderContext = {
  args?: unknown;
  toolCallId?: string;
  isPartial?: boolean;
  isError?: boolean;
  expanded?: boolean;
  lastComponent?: Component;
  invalidate?: () => void;
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const LEAD = "  ";
const GUTTER_TEXT = `${LEAD}┊`;
const INDENT_TEXT = `${GUTTER_TEXT}   `;

function fitHeadAndTail(head: string, tail: string, width: number): string {
  const max = Math.max(1, width);
  if (!tail) return visibleWidth(head) <= max ? head : truncateToWidth(head, max, "…");
  const joined = head ? `${head} ${tail}` : tail;
  if (visibleWidth(joined) <= max) return joined;
  const tailWidth = visibleWidth(tail);
  if (tailWidth >= max) return truncateToWidth(tail, max, "…");
  const headWidth = Math.max(1, max - tailWidth - 1);
  const fittedHead = truncateToWidth(head, headWidth, "…");
  return `${fittedHead} ${tail}`;
}

function fitToolLine(line: string, width: number): string {
  const max = Math.max(1, width);
  return visibleWidth(line) <= max ? line : truncateToWidth(line, max, "…");
}
function toolStyle(toolName: string): { icon: string; color: string } {
  const name = toolName.toLowerCase();
  if (/(?:^|_)(read|grep|find|search|fetch|get|list|scan|lookup)(?:$|_)/.test(name)) {
    return { icon: "📖", color: CYAN };
  }
  if (/(?:^|_)(write|edit|replace|patch|update|create|delete|remove)(?:$|_)/.test(name)) {
    return { icon: "✏️", color: YELLOW };
  }
  if (/(?:^|_)(bash|shell|exec|run|command)(?:$|_)/.test(name)) {
    return { icon: "⚡", color: MAGENTA };
  }
  return { icon: "◆", color: MAGENTA };
}

function paintBackground(line: string, width: number, background: (text: string) => string): string {
  const padding = Math.max(0, width - visibleWidth(line));
  const padded = line + " ".repeat(padding);
  return padded
    .split(RESET)
    .map((segment) => background(`${segment}${RESET}`))
    .join("");
}

class WidthAwareLines implements Component {
  constructor(
    private readonly buildLines: (width: number) => string[],
    private readonly background: (text: string) => string,
  ) {}

  render(width: number): string[] {
    if (width <= 0) return [];
    return this.buildLines(width).map((line) =>
      paintBackground(fitToolLine(line, width), width, this.background),
    );
  }

  invalidate(): void {}
}

class IndentedComponent implements Component {
  readonly wantsKeyRelease?: boolean;

  constructor(
    private readonly child: Component,
    private readonly theme: Theme,
    private readonly context: RenderContext,
  ) {
    this.wantsKeyRelease = child.wantsKeyRelease;
  }

  render(width: number): string[] {
    const prefix = this.theme.fg("dim", INDENT_TEXT);
    const contentWidth = Math.max(1, width - visibleWidth(prefix));
    const background = statusBackground(this.theme, this.context);
    return this.child.render(contentWidth).map((line) =>
      paintBackground(fitToolLine(`${prefix}${line}`, width), width, background),
    );
  }

  handleInput(data: string): void {
    this.child.handleInput?.(data);
  }

  invalidate(): void {
    this.child.invalidate();
  }
}

function statusBackground(theme: Theme, context: RenderContext): (text: string) => string {
  const key = context.isPartial
    ? "toolPendingBg"
    : context.isError
      ? "toolErrorBg"
      : "toolSuccessBg";
  return (text) => theme.bg(key, text);
}

function statusMark(context: RenderContext): string {
  if (context.isPartial) return `${DIM}·${RESET}`;
  if (context.isError) return `${RED}✗${RESET}`;
  return `${GREEN}✓${RESET}`;
}

function elapsedFor(state: PatchState, toolCallId: string | undefined): number | undefined {
  if (!toolCallId) return undefined;
  const settled = state.completed.get(toolCallId);
  if (settled) return settled.elapsedMs;
  const startedAt = state.startedAt.get(toolCallId);
  return startedAt === undefined ? undefined : Date.now() - startedAt;
}

function ensureElapsedTimer(state: PatchState, context: RenderContext): void {
  const toolCallId = context.toolCallId;
  if (!context.isPartial || !toolCallId || !context.invalidate || state.timers.has(toolCallId)) return;
  const timer = setInterval(() => context.invalidate?.(), 1000);
  timer.unref?.();
  state.timers.set(toolCallId, timer);
}

function compactCallComponent(
  toolName: string,
  args: unknown,
  theme: Theme,
  context: RenderContext,
  state: PatchState,
  ): Component {
  ensureElapsedTimer(state, context);
  const reasoning = summarizeReasoning(args);
  const target = summarizeTarget(args, toolName);
  const headline = reasoning || target;
  const elapsed = formatDuration(elapsedFor(state, context.toolCallId));
  const style = toolStyle(toolName);

  return new WidthAwareLines(
    (width) => {
      const gutter = theme.fg("dim", GUTTER_TEXT);
      const prefix = `${gutter} ${statusMark(context)} ${style.color}${style.icon} ${BOLD}${toolName}${RESET}`;
      const head = headline ? `${prefix} ${theme.fg("toolOutput", headline)}` : prefix;
      const tail = elapsed ? theme.fg("dim", `(${elapsed})`) : "";
      return [fitHeadAndTail(head, tail, width)];
    },
    statusBackground(theme, context),
  );
}

function compactResultComponent(
  toolName: string,
  result: { content?: unknown; details?: unknown },
  theme: Theme,
  context: RenderContext,
  ): Component {
  const reasoning = summarizeReasoning(context.args);
  const detail = secondaryDetail(toolName, context.args, Boolean(reasoning));
  const summary = summarizeResult(
    result?.content,
    Boolean(context.isError),
    result?.details,
    toolName,
    context.args,
  );
  return new WidthAwareLines(
    (width) => {
      const indent = theme.fg("dim", INDENT_TEXT);
      const contentWidth = Math.max(1, width - visibleWidth(indent));
      const detailText = detail ? theme.fg("dim", detail) : "";
      const arrow = theme.fg("dim", "→");
      const color = context.isError ? RED : GREEN;
      const tail = `${arrow} ${color}${summary}${RESET}`;
      const content = detailText
        ? fitHeadAndTail(detailText, tail, contentWidth)
        : visibleWidth(tail) <= contentWidth
          ? tail
          : truncateToWidth(tail, contentWidth, "…");
      return [`${indent}${content}`];
    },
    statusBackground(theme, context),
  );
}

function expandedFallback(result: { content?: unknown }, theme: Theme): Component {
  const text = fullTextResult(result?.content) || summarizeResult(result?.content);
  return new Text(theme.fg("toolOutput", text), 0, 0);
}

async function loadToolExecutionComponent(): Promise<{ prototype: ToolExecutionPrototype }> {
  const candidates: string[] = [];

  try {
    const publicEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
    const distDirectory = dirname(fileURLToPath(publicEntry));
    candidates.push(resolve(distDirectory, "modes/interactive/components/tool-execution.js"));
  } catch {
    // Fall through to the CLI-path probe.
  }

  try {
    const cliPath = realpathSync(process.argv[1] ?? "");
    candidates.push(resolve(dirname(cliPath), "modes/interactive/components/tool-execution.js"));
  } catch {
    // The public package entry remains the preferred path.
  }

  const internalPath = candidates.find((candidate) => existsSync(candidate));
  if (!internalPath) {
    throw new Error("could not locate Pi's internal tool-execution.js module");
  }

  const module = await import(pathToFileURL(internalPath).href);
  if (!module.ToolExecutionComponent?.prototype) {
    throw new Error("ToolExecutionComponent export is unavailable");
  }
  return module.ToolExecutionComponent as { prototype: ToolExecutionPrototype };
}

function installPatch(prototype: ToolExecutionPrototype): PatchState {
  const existing = prototype[PATCH_STATE];
  if (existing) {
    existing.refCount += 1;
    return existing;
  }

  for (const method of ["hasRendererDefinition", "getRenderShell", "getCallRenderer", "getResultRenderer"] as const) {
    if (typeof prototype[method] !== "function") {
      throw new Error(`unsupported Pi internals: ${method}() is missing`);
    }
  }

  const original = {
    hasRendererDefinition: prototype.hasRendererDefinition,
    getRenderShell: prototype.getRenderShell,
    getCallRenderer: prototype.getCallRenderer,
    getResultRenderer: prototype.getResultRenderer,
  };

  const state = {
    refCount: 1,
    startedAt: new Map<string, number>(),
    completed: new Map<string, Timing>(),
    timers: new Map<string, ReturnType<typeof setInterval>>(),
    original,
    patched: {} as PatchState["patched"],
  } satisfies PatchState;

  const patchedHasRendererDefinition = function (): boolean {
    return true;
  };

  const patchedGetRenderShell = function (): "self" {
    return "self";
  };

  const patchedGetCallRenderer = function (this: ToolExecutionPrototype) {
    const toolName = this.toolName ?? "tool";
    return (args: unknown, theme: Theme, context: RenderContext): Component =>
      compactCallComponent(toolName, args, theme, context, state);
  };

  const patchedGetResultRenderer = function (this: ToolExecutionPrototype) {
    const originalRenderer = original.getResultRenderer.call(this);
    const toolName = this.toolName ?? "tool";
    return (
      result: { content?: unknown; details?: unknown },
      options: { expanded?: boolean; isPartial?: boolean },
      theme: Theme,
      context: RenderContext,
    ): Component => {
      if (options?.isPartial) return new Container();
      if (!options?.expanded) return compactResultComponent(toolName, result, theme, context);

      const container = new Container();
      container.addChild(compactResultComponent(toolName, result, theme, context));

      let expanded: Component | undefined;
      if (typeof originalRenderer === "function") {
        try {
          expanded = originalRenderer(
            result,
            options,
            theme,
            { ...context, lastComponent: undefined },
          ) as Component | undefined;
        } catch {
          // A renderer may rely on private row state. Preserve the raw result instead.
        }
      }
      expanded ??= expandedFallback(result, theme);
      container.addChild(new IndentedComponent(expanded, theme, context));
      return container;
    };
  };

  state.patched = {
    hasRendererDefinition: patchedHasRendererDefinition,
    getRenderShell: patchedGetRenderShell,
    getCallRenderer: patchedGetCallRenderer,
    getResultRenderer: patchedGetResultRenderer,
  };

  prototype.hasRendererDefinition = patchedHasRendererDefinition;
  prototype.getRenderShell = patchedGetRenderShell;
  prototype.getCallRenderer = patchedGetCallRenderer;
  prototype.getResultRenderer = patchedGetResultRenderer;
  prototype[PATCH_STATE] = state;
  return state;
}

function releasePatch(prototype: ToolExecutionPrototype, state: PatchState): void {
  state.refCount = Math.max(0, state.refCount - 1);
  if (state.refCount > 0) return;

  const stillOwnsAllMethods =
    prototype.hasRendererDefinition === state.patched.hasRendererDefinition &&
    prototype.getRenderShell === state.patched.getRenderShell &&
    prototype.getCallRenderer === state.patched.getCallRenderer &&
    prototype.getResultRenderer === state.patched.getResultRenderer;

  if (!stillOwnsAllMethods) return;

  prototype.hasRendererDefinition = state.original.hasRendererDefinition;
  prototype.getRenderShell = state.original.getRenderShell;
  prototype.getCallRenderer = state.original.getCallRenderer;
  prototype.getResultRenderer = state.original.getResultRenderer;
  delete prototype[PATCH_STATE];
  for (const timer of state.timers.values()) clearInterval(timer);
  state.timers.clear();
  state.startedAt.clear();
  state.completed.clear();
}

export default async function universalTidy(pi: ExtensionAPI): Promise<void> {
  let patchError: Error | undefined;
  let prototype: ToolExecutionPrototype | undefined;
  let state: PatchState | undefined;

  try {
    const component = await loadToolExecutionComponent();
    prototype = component.prototype;
    state = installPatch(prototype);
  } catch (error) {
    patchError = error instanceof Error ? error : new Error(String(error));
  }

  pi.on("tool_execution_start", (event) => {
    if (!state) return;
    state.startedAt.set(event.toolCallId, Date.now());
    state.completed.delete(event.toolCallId);
    const timer = state.timers.get(event.toolCallId);
    if (timer) clearInterval(timer);
    state.timers.delete(event.toolCallId);
  });

  pi.on("tool_result", (event) => {
    if (!state) return;
    const startedAt = state.startedAt.get(event.toolCallId);
    state.completed.set(event.toolCallId, {
      elapsedMs: startedAt === undefined ? 0 : Date.now() - startedAt,
      isError: event.isError,
    });
    const timer = state.timers.get(event.toolCallId);
    if (timer) clearInterval(timer);
    state.timers.delete(event.toolCallId);
  });

  pi.on("session_start", (_event, ctx) => {
    if (patchError) {
      ctx.ui.notify(`Universal Tidy disabled: ${patchError.message}`, "warning");
    }
  });

  pi.on("session_shutdown", () => {
    if (prototype && state) releasePatch(prototype, state);
  });

  pi.registerCommand("tidy-ui", {
    description: "Inspect the experimental universal tool renderer",
    handler: async (args, ctx) => {
      const command = args.trim() || "status";
      if (command !== "status") {
        ctx.ui.notify("Usage: /tidy-ui status", "warning");
        return;
      }
      if (patchError) {
        ctx.ui.notify(`Universal Tidy is disabled: ${patchError.message}`, "warning");
        return;
      }
      ctx.ui.notify("Universal Tidy is active (private TUI patch, Pi 0.80.6 tested).", "info");
    },
  });
}