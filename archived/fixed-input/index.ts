import {
  copyToClipboard,
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { renderFixedEditorCluster } from "./fixed-editor/cluster.ts";
import { resolveFixedInputLayout, restoreEditorFactoryIfOwned } from "./fixed-editor/layout.ts";
import {
  emergencyTerminalModeReset,
  TerminalSplitCompositor,
  type TuiLike,
} from "./fixed-editor/terminal-split.ts";

const INSTALL_RETRY_MS = 20;
const MAX_INSTALL_ATTEMPTS = 20;

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export default function fixedInput(pi: ExtensionAPI) {
  let compositor: TerminalSplitCompositor | null = null;
  let installTimer: ReturnType<typeof setTimeout> | null = null;
  let currentEditor: any = null;
  let previousEditorFactory: EditorFactory | undefined;
  let installedEditorFactory: EditorFactory | undefined;
  let activeCtx: ExtensionContext | null = null;
  let generation = 0;

  const clearInstallTimer = () => {
    if (installTimer) clearTimeout(installTimer);
    installTimer = null;
  };

  const teardown = (resetTerminalModes = false) => {
    clearInstallTimer();
    const hadCompositor = compositor !== null;
    compositor?.dispose({ resetExtendedKeyboardModes: resetTerminalModes });
    compositor = null;

    if (!hadCompositor && resetTerminalModes) {
      try {
        process.stdout.write(emergencyTerminalModeReset());
      } catch {
        // Process shutdown cannot surface a useful terminal recovery error.
      }
    }
  };

  const install = (ctx: ExtensionContext, tui: TuiLike, attempt: number, expectedGeneration: number) => {
    if (expectedGeneration !== generation || compositor || !currentEditor) return;

    const layout = resolveFixedInputLayout(tui, currentEditor);
    if (!layout) {
      if (attempt < MAX_INSTALL_ATTEMPTS) {
        installTimer = setTimeout(
          () => install(ctx, tui, attempt + 1, expectedGeneration),
          INSTALL_RETRY_MS,
        );
      } else {
        ctx.ui.notify("Fixed input found an unsupported Pi layout; compositor was not installed", "warning");
      }
      return;
    }

    installTimer = null;
    const {
      statusContainer,
      widgetAbove,
      editorContainer,
      widgetBelow,
      footer,
    } = layout;

    let nextCompositor: TerminalSplitCompositor;
    nextCompositor = new TerminalSplitCompositor({
      tui,
      terminal: tui.terminal,
      mouseScroll: true,
      onCopySelection: (text) => copyToClipboard(text),
      onCopyError: (error) => ctx.ui.notify(`Fixed input copy failed: ${error.message}`, "warning"),
      getShowHardwareCursor: () =>
        typeof tui.getShowHardwareCursor === "function" && tui.getShowHardwareCursor(),
      renderCluster: (width, terminalRows) => {
        const statusLines = nextCompositor.renderHidden(statusContainer, width)
          .filter((line) => visibleWidth(line) > 0);
        const aboveLines = nextCompositor.renderHidden(widgetAbove, width);
        const belowLines = nextCompositor.renderHidden(widgetBelow, width);

        return renderFixedEditorCluster({
          width,
          terminalRows,
          statusLines: [...aboveLines, ...statusLines],
          editorLines: nextCompositor.renderHidden(editorContainer, width),
          secondaryLines: belowLines,
          footerLines: nextCompositor.renderHidden(footer, width),
        });
      },
    });

    compositor = nextCompositor;
    nextCompositor.hideRenderable(statusContainer);
    nextCompositor.hideRenderable(widgetAbove);
    nextCompositor.hideRenderable(editorContainer);
    nextCompositor.hideRenderable(widgetBelow);
    nextCompositor.hideRenderable(footer);

    try {
      nextCompositor.install();
      tui.requestRender?.(true);
    } catch (error) {
      compositor = null;
      nextCompositor.dispose({ resetExtendedKeyboardModes: true });
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Fixed input failed: ${message}`, "error");
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    generation += 1;
    const sessionGeneration = generation;
    activeCtx = ctx;

    if (ctx.mode !== "tui") return;

    teardown();
    previousEditorFactory = ctx.ui.getEditorComponent() as EditorFactory | undefined;

    installedEditorFactory = (tui, theme, keybindings) => {
      const editor = previousEditorFactory?.(tui, theme, keybindings)
        ?? new CustomEditor(tui, theme, keybindings);
      const adaptedTui = tui as unknown as TuiLike;
      currentEditor = editor;
      clearInstallTimer();
      installTimer = setTimeout(() => install(ctx, adaptedTui, 0, sessionGeneration), 0);
      return editor;
    };
    ctx.ui.setEditorComponent(installedEditorFactory);
  });

  pi.on("before_agent_start", async () => {
    compositor?.jumpToRootBottom();
    compositor?.beginAgentResponse();
  });

  pi.on("agent_settled", async () => {
    compositor?.jumpToAgentResponseStartIfLong();
  });

  pi.on("session_shutdown", async (event, ctx) => {
    generation += 1;
    const resetTerminalModes = event.reason === "quit" || event.reason === "reload";
    teardown(resetTerminalModes);

    if (ctx.mode === "tui" && installedEditorFactory) {
      restoreEditorFactoryIfOwned(ctx.ui, installedEditorFactory, previousEditorFactory);
    }

    activeCtx = null;
    currentEditor = null;
    previousEditorFactory = undefined;
    installedEditorFactory = undefined;
  });

  pi.registerCommand("fixed-input", {
    description: "Show whether the fixed input extension is active",
    handler: async (_args, ctx) => {
      const active = ctx.mode === "tui" && activeCtx !== null && compositor !== null;
      ctx.ui.notify(active ? "Fixed input is active" : "Fixed input is not active", active ? "info" : "warning");
    },
  });
}
