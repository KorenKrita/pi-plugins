import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  type FullscreenSurface,
  hasBlockingOverlay,
  resolveFullscreenSurface,
  resolveTranscriptGeometry,
  scrollViewportTo,
  waitForFreshLayout,
} from "./adapter.ts";
import { findFinalAssistantTextRange } from "./assistant-range.ts";
import { captureTui } from "./capture.ts";
import { decideJump, type JumpDecision } from "./policy.ts";

const CAPTURE_KEY = "__fullscreen_auto_jump_capture";


export default function fullscreenAutoJump(pi: ExtensionAPI) {
  let tui: unknown = null;
  let lastDecision: JumpDecision | null = null;

  const surface = (): FullscreenSurface | null => resolveFullscreenSurface(tui);

  const jumpToAnswerStart = (): JumpDecision | null => {
    const active = surface();
    if (!active || hasBlockingOverlay(active)) return null;

    const geometry = resolveTranscriptGeometry(active);
    if (!geometry) return null;

    const range = findFinalAssistantTextRange(geometry.document, geometry.contentWidth);
    if (!range) return null;

    const decision = decideJump({
      rangeStart: range.startLine,
      rangeEnd: range.endLine,
      viewportHeight: geometry.viewportHeight,
      contentHeight: geometry.contentHeight,
      scrollTop: geometry.scrollTop,
      isFollowingOutput: active.isFollowingOutput,
    });
    if (decision.jump) scrollViewportTo(active, geometry.scrollTop, decision.scrollTop);
    return decision;
  };

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    captureTui(ctx.ui as any, CAPTURE_KEY, (captured) => {
      tui = captured;
    });
  });

  // A new turn always starts pinned to the bottom, so the answer streams in view
  // even if the previous turn left the viewport parked elsewhere.
  pi.on("before_agent_start", async () => {
    surface()?.scrollToBottom();
  });

  pi.on("agent_settled", async () => {
    const active = surface();
    if (!active) return;
    // The transcript's layout frame is only rebuilt during the TUI's throttled
    // render pass, so wait for the final answer to be laid out before measuring.
    await waitForFreshLayout(active);
    lastDecision = jumpToAnswerStart();
  });

  pi.on("session_shutdown", async () => {
    tui = null;
    lastDecision = null;
  });

  pi.registerCommand("fullscreen-auto-jump", {
    description: "fullscreen-auto-jump: report status and re-run the jump for the current answer",
    handler: async (_args, ctx: ExtensionContext) => {
      const active = surface();
      if (!active) {
        ctx.ui.notify("fullscreen-auto-jump: inactive (this Pi build has no fullscreen transcript)", "warning");
        return;
      }
      const decision = jumpToAnswerStart() ?? lastDecision;
      const detail = decision === null
        ? "no measurable answer"
        : decision.jump
          ? `jumped to line ${String(decision.scrollTop)}`
          : `no jump (${decision.reason})`;
      ctx.ui.notify(`fullscreen-auto-jump: active — ${detail}`);
    },
  });
}
