import {
  copyToClipboard,
  CustomEditor,
  type ExtensionAPI,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { isKeyRelease, truncateToWidth, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { ColorScheme, SegmentContext, StatusLineSegmentId } from "./types.ts";
import type { PowerlineConfig } from "./powerline-config.ts";
import { getPreset } from "./presets.ts";
import { collectHiddenExtensionStatusKeys, getNotificationExtensionStatuses, mergeSegmentOptions, mergeSegmentsWithCustomItems, parsePowerlineConfig } from "./powerline-config.ts";
import { getSeparator } from "./separators.ts";
import { renderSegment } from "./segments.ts";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./git-status.ts";
import { ansi } from "./colors.ts";
import { createRenderScheduler } from "./render-scheduler.ts";
import { readCoreContextUsage } from "./context-usage.ts";
import { renderFixedEditorCluster } from "./fixed-editor/cluster.ts";
import { emergencyTerminalModeReset, TerminalSplitCompositor } from "./fixed-editor/terminal-split.ts";
import { fg, getDefaultColors } from "./theme.ts";
import {
  isSupportedSuperShortcut,
  matchesConfiguredShortcut,
  shortcutConflictKey,
  shortcutUsesSuper,
} from "./shortcuts.ts";
import { 
  initVibeManager, 
  onVibeBeforeAgentStart, 
  onVibeAgentStart, 
  onVibeAgentEnd,
  onVibeToolCall,
  getVibeTheme,
  setVibeTheme,
  getVibeModel,
  setVibeModel,
} from "./working-vibes.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

let config: PowerlineConfig = {
  customItems: [],
  segmentOptions: {},
};

const CUSTOM_COMPACTION_STATUS_KEY = "compact-policy";
let customCompactionEnabled = false;

interface PowerlineShortcuts {
  jumpPreviousUserMessage: string;
  jumpNextUserMessage: string;
  jumpPreviousLlmMessage: string;
  jumpNextLlmMessage: string;
  jumpChatBottom: string;
  scrollChatUp: string;
  scrollChatDown: string;
}

type PowerlineShortcutKey = keyof PowerlineShortcuts;
type ChatJumpShortcutKey = Extract<PowerlineShortcutKey,
  | "jumpPreviousUserMessage"
  | "jumpNextUserMessage"
  | "jumpPreviousLlmMessage"
  | "jumpNextLlmMessage"
  | "jumpChatBottom"
>;
type ChatJumpRole = "user" | "assistant";
type ChatJumpDirection = "previous" | "next";
type ChatJumpShortcutAction =
  | { kind: "message"; role: ChatJumpRole; direction: ChatJumpDirection }
  | { kind: "bottom" };
const DEFAULT_SHORTCUTS: PowerlineShortcuts = {
  jumpPreviousUserMessage: "ctrl+shift+u",
  jumpNextUserMessage: "ctrl+shift+i",
  jumpPreviousLlmMessage: "ctrl+alt+,",
  jumpNextLlmMessage: "ctrl+alt+.",
  jumpChatBottom: "ctrl+shift+g",
  scrollChatUp: "super+up",
  scrollChatDown: "super+down",
};
const CHAT_JUMP_SHORTCUTS: Array<{
  shortcutKey: ChatJumpShortcutKey;
  description: string;
  action: ChatJumpShortcutAction;
}> = [
  {
    shortcutKey: "jumpPreviousUserMessage",
    description: "Jump to previous user message",
    action: { kind: "message", role: "user", direction: "previous" },
  },
  {
    shortcutKey: "jumpNextUserMessage",
    description: "Jump to next user message",
    action: { kind: "message", role: "user", direction: "next" },
  },
  {
    shortcutKey: "jumpPreviousLlmMessage",
    description: "Jump to previous LLM message",
    action: { kind: "message", role: "assistant", direction: "previous" },
  },
  {
    shortcutKey: "jumpNextLlmMessage",
    description: "Jump to next LLM message",
    action: { kind: "message", role: "assistant", direction: "next" },
  },
  {
    shortcutKey: "jumpChatBottom",
    description: "Jump chat to bottom",
    action: { kind: "bottom" },
  },
];
const SHORTCUT_KEYS: PowerlineShortcutKey[] = [
  "jumpPreviousUserMessage",
  "jumpNextUserMessage",
  "jumpPreviousLlmMessage",
  "jumpNextLlmMessage",
  "jumpChatBottom",
  "scrollChatUp",
  "scrollChatDown",
];
const APP_RESERVED_SHORTCUTS = [
  "escape",
  "ctrl+c",
  "ctrl+d",
  "ctrl+z",
  "shift+tab",
  "ctrl+p",
  "shift+ctrl+p",
  "ctrl+l",
  "ctrl+o",
  "shift+ctrl+o",
  "ctrl+t",
  "ctrl+n",
  "ctrl+g",
  "alt+enter",
  "alt+up",
  "alt+down",
  "ctrl+v",
  "alt+v",
  "shift+l",
  "shift+t",
  "ctrl+s",
  "ctrl+r",
  "ctrl+backspace",
  "ctrl+a",
  "ctrl+x",
  "ctrl+u",
] as const;
const SHORTCUT_MODIFIER_ORDER = ["ctrl", "alt", "super", "shift"] as const;
const SHORTCUT_MODIFIERS = new Set<string>(SHORTCUT_MODIFIER_ORDER);
const SHORTCUT_NAMED_KEYS = new Set([
  "escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear",
  "home", "end", "pageup", "pagedown", "up", "down", "left", "right",
]);
const SHORTCUT_SYMBOL_KEYS = new Set([
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
  "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "|", "~", "{", "}", ":", "<", ">", "?",
]);
const LAYOUT_CACHE_TTL_MS = 250;
const STREAMING_LAYOUT_CACHE_TTL_MS = 1000;
const STATUS_RENDER_DEBOUNCE_MS = 33;
const CONTEXT_STATUS_RENDER_MS = 250;
const EDITOR_STATUS_DEFER_MS = 150;

type SessionAssistantUsage = AssistantMessage["usage"];

function getUsageTokenTotal(usage: SessionAssistantUsage): number {
  const totalTokens = "totalTokens" in usage && typeof usage.totalTokens === "number" ? usage.totalTokens : 0;
  return totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function hasSessionAssistantUsage(value: unknown): value is SessionAssistantUsage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.input !== "number" ||
    typeof value.output !== "number" ||
    typeof value.cacheRead !== "number" ||
    typeof value.cacheWrite !== "number"
  ) {
    return false;
  }

  return isRecord(value.cost) && typeof value.cost.total === "number";
}

function isSessionAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && value.role === "assistant"
    && hasSessionAssistantUsage(value.usage)
    && (value.stopReason === undefined || typeof value.stopReason === "string");
}

function getSettingsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function getGlobalCompactionPolicyPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "compaction-policy.json");
}

function getCustomCompactionExtensionPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "extensions", "pi-custom-compaction");
}

function mergeSettings(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isRecord(baseValue) && isRecord(overrideValue)
      ? mergeSettings(baseValue, overrideValue)
      : overrideValue;
  }

  return merged;
}

function readSettingsFile(settingsPath: string): Record<string, unknown> {
  try {
    if (!existsSync(settingsPath)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[powerline-footer] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }

    return parsed;
  } catch (error) {
    // Settings are user-edited input. Log and keep the extension running with defaults
    // instead of crashing the UI during startup.
    console.debug(`[powerline-footer] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function readCompactionPolicyEnabled(configPath: string): boolean | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!isRecord(parsed) || typeof parsed.enabled !== "boolean") return false;
    return parsed.enabled;
  } catch (error) {
    console.debug(`[powerline-footer] Failed to read compaction policy from ${configPath}:`, error);
    return false;
  }
}

function detectCustomCompactionEnabled(cwd: string): boolean {
  if (!existsSync(getCustomCompactionExtensionPath())) return false;

  const projectSetting = readCompactionPolicyEnabled(join(cwd, ".pi", "compaction-policy.json"));
  if (projectSetting !== undefined) return projectSetting;

  return readCompactionPolicyEnabled(getGlobalCompactionPolicyPath()) ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettings(cwd: string = process.cwd()): Record<string, unknown> {
  return mergeSettings(readSettingsFile(getSettingsPath()), readSettingsFile(getProjectSettingsPath(cwd)));
}

function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("This extension instance is stale");
}

function normalizeShortcut(value: string): string {
  const parts = value.trim().toLowerCase().split("+");
  if (parts.length <= 1) return parts[0] ?? "";

  const modifierRank = new Map<string, number>(SHORTCUT_MODIFIER_ORDER.map((modifier, index) => [modifier, index]));
  const modifiers = parts.slice(0, -1).sort((a, b) => (modifierRank.get(a) ?? 99) - (modifierRank.get(b) ?? 99));
  return [...modifiers, parts[parts.length - 1]].join("+");
}

function reservedShortcuts(): Set<string> {
  const shortcuts = new Set<string>(APP_RESERVED_SHORTCUTS.map(normalizeShortcut));

  for (const definition of Object.values(TUI_KEYBINDINGS) as Array<{ defaultKeys?: string | string[] }>) {
    const defaultKeys = definition.defaultKeys;
    const keys = defaultKeys === undefined ? [] : Array.isArray(defaultKeys) ? defaultKeys : [defaultKeys];
    for (const key of keys) {
      shortcuts.add(normalizeShortcut(key));
    }
  }

  return shortcuts;
}

function isValidShortcutKeyPart(keyPart: string): boolean {
  const lowerKeyPart = keyPart.toLowerCase();

  if (/^[a-z0-9]$/i.test(keyPart)) return true;
  if (/^f([1-9]|1[0-2])$/i.test(keyPart)) return true;
  if (SHORTCUT_NAMED_KEYS.has(lowerKeyPart)) return true;

  return SHORTCUT_SYMBOL_KEYS.has(keyPart);
}

function parseShortcutOverride(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split("+");
  if (parts.some((part) => part.length === 0)) {
    return null;
  }

  const modifierParts = parts.slice(0, -1).map((part) => {
    const modifier = part.toLowerCase();
    return modifier === "cmd" || modifier === "command" ? "super" : modifier;
  });
  if (new Set(modifierParts).size !== modifierParts.length) {
    return null;
  }

  for (const modifier of modifierParts) {
    if (!SHORTCUT_MODIFIERS.has(modifier)) {
      return null;
    }
  }

  const keyPart = parts[parts.length - 1];
  if (!isValidShortcutKeyPart(keyPart)) {
    return null;
  }

  const normalizedKey = SHORTCUT_SYMBOL_KEYS.has(keyPart) ? keyPart : keyPart.toLowerCase();
  const normalizedShortcut = normalizeShortcut([...modifierParts, normalizedKey].join("+"));
  if (shortcutUsesSuper(normalizedShortcut) && !isSupportedSuperShortcut(normalizedShortcut)) {
    return null;
  }

  return normalizedShortcut;
}

function shortcutUsageKey(shortcut: string): string {
  return shortcutConflictKey(normalizeShortcut(shortcut));
}

function findShortcutReplacement(key: PowerlineShortcutKey, used: Set<string>): string | null {
  const preferred = DEFAULT_SHORTCUTS[key];
  if (!used.has(shortcutUsageKey(preferred))) {
    return preferred;
  }

  for (const shortcutKey of SHORTCUT_KEYS) {
    const candidate = DEFAULT_SHORTCUTS[shortcutKey];
    if (!used.has(shortcutUsageKey(candidate))) {
      return candidate;
    }
  }

  return null;
}

function resolveShortcutConfig(settings: Record<string, unknown>): PowerlineShortcuts {
  const resolved: PowerlineShortcuts = { ...DEFAULT_SHORTCUTS };
  const shortcutSettings = settings.powerlineShortcuts;

  if (isRecord(shortcutSettings)) {
    for (const key of SHORTCUT_KEYS) {
      const override = parseShortcutOverride(shortcutSettings[key]);
      if (override) {
        resolved[key] = override;
      }
    }
  }

  const used = new Set(Array.from(reservedShortcuts(), shortcutUsageKey));

  for (const key of SHORTCUT_KEYS) {
    const configured = resolved[key];
    const configuredUsageKey = shortcutUsageKey(configured);

    if (!used.has(configuredUsageKey)) {
      used.add(configuredUsageKey);
      continue;
    }

    const replacement = findShortcutReplacement(key, used);
    if (!replacement) {
      console.debug(`[powerline-footer] Shortcut conflict for ${key}: "${configured}" is already in use`);
      continue;
    }

    console.debug(
      `[powerline-footer] Shortcut conflict for ${key}: "${configured}" replaced with "${replacement}"`,
    );

    resolved[key] = replacement;
    used.add(shortcutUsageKey(replacement));
  }

  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Line Builder
// ═══════════════════════════════════════════════════════════════════════════

/** Render a single segment and return its content with width */
function renderSegmentWithWidth(
  segId: StatusLineSegmentId,
  ctx: SegmentContext
): { content: string; width: number; visible: boolean } {
  const rendered = renderSegment(segId, ctx);
  if (!rendered.visible || !rendered.content) {
    return { content: "", width: 0, visible: false };
  }
  return { content: rendered.content, width: visibleWidth(rendered.content), visible: true };
}

/** Build content string from pre-rendered parts */
function buildContentFromParts(
  parts: string[],
  presetDef: ReturnType<typeof getPreset>,
  ctx: SegmentContext
): string {
  if (parts.length === 0) return "";
  const separatorDef = getSeparator(presetDef.separator);
  const sep = fg(ctx.theme, "separator", separatorDef.left, ctx.colors);
  return " " + parts.join(` ${sep} `) + ansi.reset + " ";
}

/**
 * Responsive segment layout - fits segments into top bar, overflows to secondary row.
 * When terminal is wide enough, secondary segments move up to top bar.
 * When narrow, top bar segments overflow down to secondary row.
 */
function computeResponsiveLayout(
  ctx: SegmentContext,
  presetDef: ReturnType<typeof getPreset>,
  availableWidth: number
): { topContent: string; secondaryContent: string } {
  const separatorDef = getSeparator(presetDef.separator);
  const sepWidth = visibleWidth(separatorDef.left) + 2; // separator + spaces around it
  
  // Get all segments: primary first, then secondary
  const mergedSegments = mergeSegmentsWithCustomItems(presetDef, config.customItems);
  const primaryIds = [...mergedSegments.leftSegments, ...mergedSegments.rightSegments];
  const secondaryIds = mergedSegments.secondarySegments;
  const allSegmentIds = [...primaryIds, ...secondaryIds];
  
  // Render all segments and get their widths
  const renderedSegments: { content: string; width: number }[] = [];
  for (const segId of allSegmentIds) {
    const { content, width, visible } = renderSegmentWithWidth(segId, ctx);
    if (visible) {
      renderedSegments.push({ content, width });
    }
  }
  
  if (renderedSegments.length === 0) {
    return { topContent: "", secondaryContent: "" };
  }
  
  // Calculate how many segments fit in top bar
  // Account for: leading space (1) + trailing space (1) = 2 chars overhead
  const baseOverhead = 2;
  let currentWidth = baseOverhead;
  let topSegments: string[] = [];
  let overflowSegments: { content: string; width: number }[] = [];
  let overflow = false;
  
  for (const seg of renderedSegments) {
    const neededWidth = seg.width + (topSegments.length > 0 ? sepWidth : 0);
    
    if (!overflow && currentWidth + neededWidth <= availableWidth) {
      topSegments.push(seg.content);
      currentWidth += neededWidth;
    } else {
      overflow = true;
      overflowSegments.push(seg);
    }
  }
  
  // Fit overflow segments into secondary row (same width constraint)
  // Stop at first non-fitting segment to preserve ordering
  let secondaryWidth = baseOverhead;
  let secondarySegments: string[] = [];
  
  for (const seg of overflowSegments) {
    const neededWidth = seg.width + (secondarySegments.length > 0 ? sepWidth : 0);
    if (secondaryWidth + neededWidth <= availableWidth) {
      secondarySegments.push(seg.content);
      secondaryWidth += neededWidth;
    } else {
      break;
    }
  }
  
  return {
    topContent: buildContentFromParts(topSegments, presetDef, ctx),
    secondaryContent: buildContentFromParts(secondarySegments, presetDef, ctx),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function powerlineFooter(pi: ExtensionAPI) {
  const startupSettings = readSettings();
  config = parsePowerlineConfig(startupSettings.powerline);
  let resolvedShortcuts = resolveShortcutConfig(startupSettings);

  let enabled = true;
  let sessionStartTime = Date.now();
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let currentThinkingLevel: string | null = null;
  let liveAssistantUsage: SessionAssistantUsage | null = null;
  let isStreaming = false;
  let tuiRef: any = null;
  let restoreFooterStatusRepaintHook: (() => void) | null = null;
  let fixedEditorCompositor: TerminalSplitCompositor | null = null;
  let fixedStatusContainer: any = null;
  let fixedEditorContainer: any = null;
  let fixedWidgetContainerAbove: any = null;
  let fixedWidgetContainerBelow: any = null;
  let terminalInputUnsubscribe: (() => void) | null = null;
  let lastUserPrompt = "";
  let showLastPrompt = true;
  let currentEditor: any = null;
  
  // Cache for the top and secondary powerline widgets.
  let lastLayoutWidth = 0;
  let lastLayoutResult: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;
  let layoutDirty = true;
  let forceNextLayoutRecompute = false;
  let lastEditorInputAt = 0;

  const statusRenderScheduler = createRenderScheduler(() => {
    const msSinceInput = Date.now() - lastEditorInputAt;
    if (layoutDirty && !forceNextLayoutRecompute && msSinceInput < EDITOR_STATUS_DEFER_MS) {
      statusRenderScheduler.schedule(Math.max(0, EDITOR_STATUS_DEFER_MS - msSinceInput));
      return;
    }

    tuiRef?.requestRender();
  }, STATUS_RENDER_DEBOUNCE_MS);

  const resetLayoutCache = () => {
    lastLayoutResult = null;
    layoutDirty = true;
  };

  const requestStatusRender = (delayMs?: number) => {
    layoutDirty = true;
    statusRenderScheduler.schedule(delayMs);
  };

  const requestImmediateStatusRender = (options: { deferDuringTyping?: boolean } = {}) => {
    layoutDirty = true;
    if (options.deferDuringTyping !== false && Date.now() - lastEditorInputAt < EDITOR_STATUS_DEFER_MS) {
      statusRenderScheduler.schedule();
      return;
    }

    forceNextLayoutRecompute = true;
    statusRenderScheduler.cancel();
    statusRenderScheduler.schedule(0);
  };

  const installFooterStatusRepaintHook = (footerData: ReadonlyFooterDataProvider) => {
    restoreFooterStatusRepaintHook?.();
    restoreFooterStatusRepaintHook = null;

    const writableFooterData = footerData as ReadonlyFooterDataProvider & {
      setExtensionStatus?: (key: string, text: string | undefined) => void;
      clearExtensionStatuses?: () => void;
    };
    if (typeof writableFooterData.setExtensionStatus !== "function") return;

    const originalSetExtensionStatus = writableFooterData.setExtensionStatus;
    const originalClearExtensionStatuses = writableFooterData.clearExtensionStatuses;
    const setExtensionStatusAndRepaint = function setExtensionStatusAndRepaint(this: unknown, key: string, text: string | undefined) {
      originalSetExtensionStatus.call(this, key, text);
      requestImmediateStatusRender();
    };
    writableFooterData.setExtensionStatus = setExtensionStatusAndRepaint;

    let clearExtensionStatusesAndRepaint: (() => void) | null = null;
    if (typeof originalClearExtensionStatuses === "function") {
      clearExtensionStatusesAndRepaint = function clearExtensionStatusesAndRepaint(this: unknown) {
        originalClearExtensionStatuses.call(this);
        requestImmediateStatusRender();
      };
      writableFooterData.clearExtensionStatuses = clearExtensionStatusesAndRepaint;
    }

    restoreFooterStatusRepaintHook = () => {
      if (writableFooterData.setExtensionStatus === setExtensionStatusAndRepaint) {
        writableFooterData.setExtensionStatus = originalSetExtensionStatus;
      }
      if (clearExtensionStatusesAndRepaint && writableFooterData.clearExtensionStatuses === clearExtensionStatusesAndRepaint) {
        writableFooterData.clearExtensionStatuses = originalClearExtensionStatuses;
      }
    };
  };

  pi.on("session_start", async (_event, ctx) => {
    sessionStartTime = Date.now();
    currentCtx = ctx;
    customCompactionEnabled = detectCustomCompactionEnabled(ctx.cwd);
    lastUserPrompt = "";
    isStreaming = false;
    liveAssistantUsage = null;

    const settings = readSettings(ctx.cwd);
    resolvedShortcuts = resolveShortcutConfig(settings);
    showLastPrompt = settings.showLastPrompt !== false;
    config = parsePowerlineConfig(settings.powerline);

    // Pi exposes this at runtime, while ExtensionContext 0.80.6 does not declare it yet.
    const getThinkingLevel = Reflect.get(ctx, "getThinkingLevel");
    getThinkingLevelFn = typeof getThinkingLevel === "function"
      ? () => getThinkingLevel.call(ctx)
      : null;
    currentThinkingLevel = getThinkingLevelFn?.() ?? null;

    initVibeManager(ctx);

    if (enabled && ctx.hasUI) {
      setupCustomEditor(ctx);
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    const isTerminalExit = event?.reason === "quit" || event?.reason === "reload";

    if (ctx.hasUI) {
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget("powerline-top", undefined);
      ctx.ui.setWidget("powerline-secondary", undefined);
      ctx.ui.setWidget("powerline-status", undefined);
      ctx.ui.setWidget("powerline-last-prompt", undefined);
    }

    statusRenderScheduler.cancel();
    restoreFooterStatusRepaintHook?.();
    restoreFooterStatusRepaintHook = null;
    teardownFixedEditorCompositor(isTerminalExit ? { resetExtendedKeyboardModes: true } : undefined);
    terminalInputUnsubscribe?.();
    terminalInputUnsubscribe = null;
    currentCtx = null;
    footerDataRef = null;
    getThinkingLevelFn = null;
    currentThinkingLevel = null;
    liveAssistantUsage = null;
    tuiRef = null;
    currentEditor = null;
    resetLayoutCache();
  });

  // Check if a bash command might change git branch
  const mightChangeGitBranch = (cmd: string): boolean => {
    const gitBranchPatterns = [
      /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
      /\bgit\s+stash\s+(pop|apply)/,
    ];
    return gitBranchPatterns.some(p => p.test(cmd));
  };

  // Invalidate git status on file changes, trigger re-render on potential branch changes
  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }
    // Check for bash commands that might change git branch
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (mightChangeGitBranch(cmd)) {
        // Invalidate caches since working tree state changes with branch
        invalidateGitStatus();
        invalidateGitBranch();
        // Small delay to let git update, then re-render
        setTimeout(() => requestStatusRender(), 100);
      }
    }
  });

  // Also catch user escape commands (! prefix)
  // Note: This fires BEFORE execution, so we use a longer delay and multiple re-renders
  // to ensure we catch the update after the command completes.
  pi.on("user_bash", async (event) => {
    if (mightChangeGitBranch(event.command)) {
      // Invalidate immediately so next render fetches fresh data
      invalidateGitStatus();
      invalidateGitBranch();
      // Multiple staggered re-renders to catch fast and slow commands
      setTimeout(() => requestStatusRender(), 100);
      setTimeout(() => requestStatusRender(), 300);
      setTimeout(() => requestStatusRender(), 500);
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    currentCtx = ctx;
    requestStatusRender();
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    currentCtx = ctx;
    currentThinkingLevel = getThinkingLevelFn?.() ?? (typeof event.level === "string" ? event.level : null);
    requestImmediateStatusRender({ deferDuringTyping: false });
  });

  pi.on("session_tree", async (_event, ctx) => {
    currentCtx = ctx;
    currentThinkingLevel = null;
    liveAssistantUsage = null;
    requestImmediateStatusRender({ deferDuringTyping: false });
  });

  // Generate themed working message before agent starts (has access to user's prompt)
  pi.on("before_agent_start", async (event, ctx) => {
    lastUserPrompt = event.prompt;
    if (ctx.hasUI) {
      onVibeBeforeAgentStart(event.prompt, ctx.ui.setWorkingMessage);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    isStreaming = true;
    liveAssistantUsage = null;
    onVibeAgentStart();
    currentCtx = ctx;
  });

  pi.on("message_update", async (event, ctx) => {
    if (isSessionAssistantMessage(event.message)
      && event.message.stopReason !== "error"
      && event.message.stopReason !== "aborted"
      && getUsageTokenTotal(event.message.usage) > 0) {
      liveAssistantUsage = event.message.usage;
      currentCtx = ctx;
      layoutDirty = true;
      statusRenderScheduler.schedule(CONTEXT_STATUS_RENDER_MS);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    currentCtx = ctx;
    if (isSessionAssistantMessage(event.message)) {
      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        liveAssistantUsage = null;
      } else if (getUsageTokenTotal(event.message.usage) > 0) {
        liveAssistantUsage = event.message.usage;
      }
    }
    requestImmediateStatusRender({ deferDuringTyping: false });
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentCtx = ctx;
    requestImmediateStatusRender({ deferDuringTyping: false });
  });

  pi.on("tool_call", async (event, ctx) => {
    if (ctx.hasUI) {
      // Extract recent agent context from session for richer vibe generation
      const agentContext = getRecentAgentContext(ctx);
      onVibeToolCall(event.toolName, event.input, ctx.ui.setWorkingMessage, agentContext);
    }
  });
  
  // Helper to extract recent agent response text (skipping thinking blocks)
  function getRecentAgentContext(ctx: any): string | undefined {
    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
    
    // Find the most recent assistant message
    for (let i = sessionEvents.length - 1; i >= 0; i--) {
      const e = sessionEvents[i];
      if (e.type === "message" && e.message?.role === "assistant") {
        const content = e.message.content;
        if (!Array.isArray(content)) continue;
        
        // Extract text content, skip thinking blocks
        for (const block of content) {
          if (block.type === "text" && block.text) {
            // Return first ~200 chars of non-empty text
            const text = block.text.trim();
            if (text.length > 0) {
              return text.slice(0, 200);
            }
          }
        }
      }
    }
    return undefined;
  }

  function getChatJumpShortcutAction(data: string): ChatJumpShortcutAction | null {
    if (isKeyRelease(data)) return null;
    return CHAT_JUMP_SHORTCUTS.find(({ shortcutKey }) => matchesConfiguredShortcut(data, resolvedShortcuts[shortcutKey]))?.action ?? null;
  }

  function runChatJumpShortcut(ctx: any, action: ChatJumpShortcutAction): void {
    if (action.kind === "bottom") {
      jumpChatToBottom(ctx);
      return;
    }

    jumpToChatMessage(ctx, action.role, action.direction);
  }

  pi.on("agent_end", async (_event, ctx) => {
    isStreaming = false;
    liveAssistantUsage = null;
    currentCtx = ctx;
    if (ctx.hasUI) {
      onVibeAgentEnd(ctx.ui.setWorkingMessage);
    }
    requestStatusRender();
  });

  pi.registerCommand("powerline", {
    description: "Toggle the local powerline footer",
    handler: async (args, ctx) => {
      // Update context reference (command ctx may have more methods)
      currentCtx = ctx;
      
      if (!args?.trim()) {
        // Toggle
        enabled = !enabled;
        if (enabled) {
          setupCustomEditor(ctx);
          ctx.ui.notify("Powerline enabled", "info");
        } else {
          restoreFooterStatusRepaintHook?.();
          restoreFooterStatusRepaintHook = null;
          teardownFixedEditorCompositor();
          terminalInputUnsubscribe?.();
          terminalInputUnsubscribe = null;
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);
          ctx.ui.setWidget("powerline-top", undefined);
          ctx.ui.setWidget("powerline-secondary", undefined);
          ctx.ui.setWidget("powerline-status", undefined);
          ctx.ui.setWidget("powerline-last-prompt", undefined);
          footerDataRef = null;
          tuiRef = null;
          currentEditor = null;
          statusRenderScheduler.cancel();
          resetLayoutCache();
          ctx.ui.notify("Powerline disabled", "info");
        }
        return;
      }

      ctx.ui.notify("Usage: /powerline", "info");
    },
  });

  for (const { shortcutKey, description, action } of CHAT_JUMP_SHORTCUTS) {
    pi.registerShortcut(resolvedShortcuts[shortcutKey] as Parameters<typeof pi.registerShortcut>[0], {
      description,
      handler: async (ctx) => {
        if (!enabled || !ctx.hasUI) return;
        runChatJumpShortcut(ctx, action);
      },
    });
  }

  pi.registerCommand("vibe", {
    description: "Set generated working message theme or model. Usage: /vibe [theme|off|model]", 
    handler: async (args, ctx) => {
      const parts = args?.trim().split(/\s+/) || [];
      const subcommand = parts[0]?.toLowerCase();
      
      if (!args || !args.trim()) {
        ctx.ui.notify(`Vibe: ${getVibeTheme() || "off"} | Model: ${getVibeModel()}`, "info");
        return;
      }
      
      // /vibe model [spec] - show or set model
      if (subcommand === "model") {
        const modelSpec = parts.slice(1).join(" ");
        if (!modelSpec) {
          ctx.ui.notify(`Current vibe model: ${getVibeModel()}`, "info");
          return;
        }
        // Validate format (provider/modelId)
        if (!modelSpec.includes("/")) {
          ctx.ui.notify("Invalid model format. Use: provider/modelId (e.g., openai-codex/gpt-5.4-mini)", "error");
          return;
        }
        const persisted = setVibeModel(modelSpec);
        if (persisted) {
          ctx.ui.notify(`Vibe model set to: ${modelSpec}`, "info");
        } else {
          ctx.ui.notify(`Vibe model set to: ${modelSpec} (not persisted; check settings.json)`, "warning");
        }
        return;
      }
      
      // /vibe off - disable
      if (subcommand === "off") {
        const persisted = setVibeTheme(null);
        if (persisted) {
          ctx.ui.notify("Vibe disabled", "info");
        } else {
          ctx.ui.notify("Vibe disabled (not persisted; check settings.json)", "warning");
        }
        return;
      }
      
      const theme = args.trim();
      const persisted = setVibeTheme(theme);
      ctx.ui.notify(
        persisted ? `Vibe set to: ${theme}` : `Vibe set to: ${theme} (not persisted; check settings.json)`,
        persisted ? "info" : "warning",
      );
    },
  });

  function buildSegmentContext(ctx: any, theme: Theme): SegmentContext {
    const presetDef = getPreset();
    const colors: ColorScheme = presetDef.colors ?? getDefaultColors();

    // Build usage stats and get thinking level from session
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
    let lastAssistant: AssistantMessage | undefined;
    let thinkingLevelFromSession: string | null = null;
    
    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
    for (const e of sessionEvents) {
      if (!isRecord(e)) {
        continue;
      }

      // Check for thinking level change entries
      if (e.type === "thinking_level_change" && typeof e.thinkingLevel === "string") {
        thinkingLevelFromSession = e.thinkingLevel;
      }

      if (e.type !== "message" || !isSessionAssistantMessage(e.message)) {
        continue;
      }

      const m = e.message;
      if (m.stopReason === "error" || m.stopReason === "aborted") {
        continue;
      }
      input += m.usage.input;
      output += m.usage.output;
      cacheRead += m.usage.cacheRead;
      cacheWrite += m.usage.cacheWrite;
      cost += m.usage.cost.total;
      if (getUsageTokenTotal(m.usage) > 0) {
        lastAssistant = m;
      }
    }

    // Calculate context percentage.
    const latestUsage = isStreaming ? liveAssistantUsage ?? lastAssistant?.usage : lastAssistant?.usage;
    const coreContextUsage = isStreaming && liveAssistantUsage ? null : readCoreContextUsage(ctx);
    const contextTokens = coreContextUsage?.contextTokens ?? (latestUsage ? getUsageTokenTotal(latestUsage) : 0);
    const contextWindow = coreContextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const contextPercent = coreContextUsage?.contextPercent ?? (contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0);

    const segmentOptions = mergeSegmentOptions(presetDef.segmentOptions, config.segmentOptions);

    // Get git status (cached)
    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const gitStatus = getGitStatus(gitBranch, segmentOptions.git?.polling);
    const extensionStatuses = footerDataRef?.getExtensionStatuses() ?? new Map();
    const customItemsById = new Map(config.customItems.map((item) => [item.id, item]));
    const hiddenExtensionStatusKeys = collectHiddenExtensionStatusKeys(config.customItems);

    // Check if using OAuth subscription
    const usingSubscription = ctx.model
      ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
      : false;

    const thinkingLevel = currentThinkingLevel ?? thinkingLevelFromSession ?? getThinkingLevelFn?.() ?? "off";

    return {
      model: ctx.model,
      thinkingLevel,
      cwd: ctx.cwd,
      usageStats: { input, output, cacheRead, cacheWrite, cost },
      contextPercent,
      contextWindow,
      autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
      customCompactionEnabled: customCompactionEnabled || extensionStatuses.has(CUSTOM_COMPACTION_STATUS_KEY),
      usingSubscription,
      sessionStartTime,
      git: gitStatus,
      extensionStatuses,
      hiddenExtensionStatusKeys,
      customItemsById,
      options: segmentOptions,
      theme,
      colors,
    };
  }

  /**
   * Get cached responsive layout or compute fresh one.
   * The segment context scans session state, so keep it stable across render bursts.
   */
  function getResponsiveLayout(width: number, theme: Theme): { topContent: string; secondaryContent: string } {
    const now = Date.now();
    const cacheTtl = isStreaming ? STREAMING_LAYOUT_CACHE_TTL_MS : LAYOUT_CACHE_TTL_MS;

    if (lastLayoutResult && lastLayoutWidth === width) {
      const msSinceInput = now - lastEditorInputAt;
      const typingRecently = msSinceInput < EDITOR_STATUS_DEFER_MS;

      if (!forceNextLayoutRecompute && typingRecently && (layoutDirty || now - lastLayoutTimestamp >= cacheTtl)) {
        return lastLayoutResult;
      }

      if (!layoutDirty && now - lastLayoutTimestamp < cacheTtl) {
        return lastLayoutResult;
      }
    }

    const presetDef = getPreset();
    let segmentCtx: SegmentContext;
    try {
      segmentCtx = buildSegmentContext(currentCtx, theme);
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
      currentCtx = null;
      lastLayoutWidth = width;
      lastLayoutResult = { topContent: "", secondaryContent: "" };
      lastLayoutTimestamp = now;
      layoutDirty = false;
      forceNextLayoutRecompute = false;
      return lastLayoutResult;
    }

    lastLayoutWidth = width;
    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, width);
    lastLayoutTimestamp = now;
    layoutDirty = false;
    forceNextLayoutRecompute = false;

    return lastLayoutResult;
  }

  function renderPowerlineStatusLines(width: number): string[] {
    if (!currentCtx || !footerDataRef) return [];

    const statuses = footerDataRef.getExtensionStatuses();
    if (!statuses || statuses.size === 0) return [];
    const hiddenExtensionStatusKeys = collectHiddenExtensionStatusKeys(config.customItems);

    const notifications: string[] = [];
    for (const value of getNotificationExtensionStatuses(statuses, hiddenExtensionStatusKeys)) {
      const lineContent = ` ${value}`;
      if (visibleWidth(lineContent) <= width) {
        notifications.push(lineContent);
      }
    }

    return notifications;
  }

  function renderPowerlineTopLines(width: number, theme: Theme): string[] {
    if (!currentCtx) return [];

    const layout = getResponsiveLayout(width, theme);
    return layout.topContent ? [layout.topContent] : [];
  }

  function renderPowerlineSecondaryLines(width: number, theme: Theme): string[] {
    if (!currentCtx) return [];

    const layout = getResponsiveLayout(width, theme);
    return layout.secondaryContent ? [layout.secondaryContent] : [];
  }

  function renderLastPromptLines(width: number, theme: Theme): string[] {
    if (!showLastPrompt || !lastUserPrompt) return [];

    const colors = getPreset().colors ?? getDefaultColors();
    const prefix = ` ${fg(theme, "separator", "↳", colors)} `;
    const availableWidth = width - visibleWidth(prefix);
    if (availableWidth < 10) return [];

    let promptText = lastUserPrompt.replace(/\s+/g, " ").trim();
    if (!promptText) return [];

    promptText = truncateToWidth(promptText, availableWidth, "…");

    const styledPrompt = fg(theme, "separator", promptText, colors);
    const line = `${prefix}${styledPrompt}`;
    return [truncateToWidth(line, width, "…")];
  }

  function teardownFixedEditorCompositor(options?: { resetExtendedKeyboardModes?: boolean }) {
    const hadCompositor = fixedEditorCompositor !== null;
    fixedEditorCompositor?.dispose(options);
    if (!hadCompositor && options?.resetExtendedKeyboardModes) {
      try {
        process.stdout.write(emergencyTerminalModeReset());
      } catch {
        // Shutdown cleanup cannot surface useful terminal write failures.
      }
    }
    fixedEditorCompositor = null;
    fixedStatusContainer = null;
    fixedEditorContainer = null;
    fixedWidgetContainerAbove = null;
    fixedWidgetContainerBelow = null;
  }

  function findContainerWithChild(tui: any, child: any): { container: any; index: number } | null {
    const children = Array.isArray(tui?.children) ? tui.children : [];
    const index = children.findIndex((candidate: any) => Array.isArray(candidate?.children) && candidate.children.includes(child));
    if (index === -1) return null;

    return { container: children[index], index };
  }

  function installFixedEditorCompositor(ctx: any, tui: any) {
    teardownFixedEditorCompositor();

    if (!ctx.hasUI) return;
    if (!tui?.terminal || typeof tui.terminal.write !== "function") {
      throw new Error("[powerline-footer] Fixed editor compositor could not find tui.terminal.write()");
    }
    if (!currentEditor) {
      throw new Error("[powerline-footer] Fixed editor compositor expected the custom editor to be installed first");
    }

    const editorContainerMatch = findContainerWithChild(tui, currentEditor);
    if (!editorContainerMatch) {
      throw new Error("[powerline-footer] Fixed editor compositor could not find the editor container in TUI children");
    }

    const tuiChildren = Array.isArray(tui.children) ? tui.children : [];
    fixedEditorContainer = editorContainerMatch.container;
    const statusContainerCandidate = tuiChildren[editorContainerMatch.index - 2] ?? null;
    fixedStatusContainer = statusContainerCandidate && typeof statusContainerCandidate.render === "function"
      ? statusContainerCandidate
      : null;
    fixedWidgetContainerAbove = tuiChildren[editorContainerMatch.index - 1] ?? null;
    fixedWidgetContainerBelow = tuiChildren[editorContainerMatch.index + 1] ?? null;

    const fallbackTheme = ctx.ui.theme;
    const readRenderTheme = (): Theme => {
      if (!currentCtx) return fallbackTheme;
      try {
        return currentCtx.ui?.theme ?? fallbackTheme;
      } catch (error) {
        if (!isStaleExtensionContextError(error)) throw error;
        currentCtx = null;
        resetLayoutCache();
        return fallbackTheme;
      }
    };

    let compositor: TerminalSplitCompositor;
    compositor = new TerminalSplitCompositor({
      tui,
      terminal: tui.terminal,
      mouseScroll: true,
      keyboardScrollShortcuts: {
        up: resolvedShortcuts.scrollChatUp,
        down: resolvedShortcuts.scrollChatDown,
      },
      onCopySelection: (text) => copyToClipboard(text),
      getShowHardwareCursor: () => typeof tui.getShowHardwareCursor === "function" && tui.getShowHardwareCursor(),
      renderCluster: (width, terminalRows) => {
        const theme = readRenderTheme();
        const statusContainerLines = fixedStatusContainer
          ? compositor.renderHidden(fixedStatusContainer, width).filter((line) => visibleWidth(line) > 0)
          : [];
        const aboveWidgetLines = fixedWidgetContainerAbove ? compositor.renderHidden(fixedWidgetContainerAbove, width) : [];
        const belowWidgetLines = fixedWidgetContainerBelow ? compositor.renderHidden(fixedWidgetContainerBelow, width) : [];
        return renderFixedEditorCluster({
          width,
          terminalRows,
          statusLines: [...aboveWidgetLines, ...renderPowerlineStatusLines(width), ...statusContainerLines],
          topLines: renderPowerlineTopLines(width, theme),
          editorLines: fixedEditorContainer ? compositor.renderHidden(fixedEditorContainer, width) : [],
          secondaryLines: [...renderPowerlineSecondaryLines(width, theme), ...belowWidgetLines],
          lastPromptLines: renderLastPromptLines(width, theme),
        });
      },
    });

    fixedEditorCompositor = compositor;
    if (fixedStatusContainer?.render) compositor.hideRenderable(fixedStatusContainer);
    if (fixedWidgetContainerAbove?.render) compositor.hideRenderable(fixedWidgetContainerAbove);
    compositor.hideRenderable(fixedEditorContainer);
    if (fixedWidgetContainerBelow?.render) compositor.hideRenderable(fixedWidgetContainerBelow);
    compositor.install();
    tui.requestRender(true);
  }

  function isChatMessageComponentForRole(component: unknown, role: ChatJumpRole): boolean {
    const componentName = typeof component === "object" && component !== null ? component.constructor?.name : undefined;
    if (role === "assistant") {
      return componentName === "AssistantMessageComponent";
    }

    return componentName === "UserMessageComponent" || componentName === "SkillInvocationMessageComponent";
  }

  function renderLineCount(component: unknown, width: number): number {
    if (typeof component !== "object" || component === null) return 0;

    const render = Reflect.get(component, "render");
    if (typeof render !== "function") return 0;

    const lines = render.call(component, width);
    return Array.isArray(lines) ? lines.length : 0;
  }

  function collectMessageStartLines(component: unknown, width: number, role: ChatJumpRole, offset: number): {
    targets: number[];
    lineCount: number;
  } {
    const lineCount = renderLineCount(component, width);
    if (isChatMessageComponentForRole(component, role)) {
      return { targets: [offset], lineCount };
    }

    const children = typeof component === "object" && component !== null ? Reflect.get(component, "children") : null;
    if (!Array.isArray(children) || children.length === 0) {
      return { targets: [], lineCount };
    }

    const targets: number[] = [];
    let childOffset = offset;
    let childrenLineCount = 0;
    for (const child of children) {
      const result = collectMessageStartLines(child, width, role, childOffset);
      targets.push(...result.targets);
      childOffset += result.lineCount;
      childrenLineCount += result.lineCount;
    }

    return { targets, lineCount: Math.max(lineCount, childrenLineCount) };
  }

  function collectChatMessageStartLines(role: ChatJumpRole): number[] {
    const children = Array.isArray(tuiRef?.children) ? tuiRef.children : [];
    const width = Math.max(1, tuiRef?.terminal?.columns ?? 80);
    const targets: number[] = [];
    let offset = 0;

    for (const child of children) {
      const result = collectMessageStartLines(child, width, role, offset);
      targets.push(...result.targets);
      offset += result.lineCount;
    }

    return [...new Set(targets)].sort((a, b) => a - b);
  }

  function jumpToChatMessage(ctx: any, role: ChatJumpRole, direction: ChatJumpDirection): void {
    if (!fixedEditorCompositor) {
      ctx.ui.notify("Fixed editor is not ready", "warning");
      return;
    }

    const targets = collectChatMessageStartLines(role);
    const label = role === "assistant" ? "LLM" : "user";
    if (targets.length === 0) {
      ctx.ui.notify(`No ${label} messages found`, "info");
      return;
    }

    const jumped = direction === "previous"
      ? fixedEditorCompositor.jumpToPreviousRootTarget(targets)
      : fixedEditorCompositor.jumpToNextRootTarget(targets);
    if (!jumped) {
      ctx.ui.notify(`No ${direction} ${label} message`, "info");
    }
  }

  function jumpChatToBottom(ctx: any): void {
    if (!fixedEditorCompositor) {
      ctx.ui.notify("Fixed editor is not ready", "warning");
      return;
    }

    fixedEditorCompositor.jumpToRootBottom();
  }

  function followSubmittedEditorToBottom(): void {
    fixedEditorCompositor?.jumpToRootBottom();
  }

  function setupCustomEditor(ctx: any) {
    if (!enabled) return;

    terminalInputUnsubscribe?.();
    terminalInputUnsubscribe = typeof ctx.ui.onTerminalInput === "function"
      ? ctx.ui.onTerminalInput((data: string) => {
        if (!enabled || !ctx.hasUI || tuiRef?.hasOverlay?.()) return undefined;

        const action = getChatJumpShortcutAction(data);
        if (!action) return undefined;

        runChatJumpShortcut(ctx, action);
        tuiRef?.requestRender();
        return { consume: true };
      })
      : null;

    teardownFixedEditorCompositor();
    ctx.ui.setWidget("powerline-top", undefined);
    ctx.ui.setWidget("powerline-secondary", undefined);
    ctx.ui.setWidget("powerline-status", undefined);
    ctx.ui.setWidget("powerline-last-prompt", undefined);

    const editorFactory = (tui: any, editorTheme: any, keybindings: any) => {
      const editor = new CustomEditor(tui, editorTheme, keybindings);

      let inheritedOnSubmit: unknown;
      Object.defineProperty(editor, "onSubmit", {
        configurable: true,
        get: () => inheritedOnSubmit,
        set(handler: unknown) {
          inheritedOnSubmit = typeof handler === "function"
            ? (text: string) => {
              followSubmittedEditorToBottom();
              handler(text);
            }
            : handler;
        },
      });

      currentEditor = editor;
      const originalHandleInput = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        lastEditorInputAt = Date.now();

        const action = getChatJumpShortcutAction(data);
        if (action) {
          runChatJumpShortcut(ctx, action);
          return;
        }

        originalHandleInput(data);
      };

      const originalRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {
        if (width < 10) return originalRender(width);

        const editorColors = getPreset().colors ?? getDefaultColors();
        const border = (value: string) => fg(editorTheme, "border", value, editorColors);
        const promptPrefix = ` ${fg(editorTheme, "model", ">", editorColors)} `;
        const contentWidth = Math.max(1, width - 3);
        const lines = originalRender(contentWidth);
        if (lines.length === 0) return lines;

        let bottomBorderIndex = lines.length - 1;
        for (let index = lines.length - 1; index >= 1; index--) {
          const stripped = lines[index]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
          if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
            bottomBorderIndex = index;
            break;
          }
        }

        const result = [" " + border("─".repeat(width - 2))];
        for (let index = 1; index < bottomBorderIndex; index++) {
          result.push(`${index === 1 ? promptPrefix : "   "}${lines[index] || ""}`);
        }
        if (bottomBorderIndex === 1) {
          result.push(`${promptPrefix}${" ".repeat(contentWidth)}`);
        }
        result.push(" " + border("─".repeat(width - 2)));
        return [...result, ...lines.slice(bottomBorderIndex + 1)];
      };

      return editor;
    };

    ctx.ui.setEditorComponent(editorFactory);
    ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      footerDataRef = footerData;
      tuiRef = tui;
      installFooterStatusRepaintHook(footerData);
      const unsubscribe = footerData.onBranchChange(() => requestStatusRender());

      return {
        dispose() {
          unsubscribe();
          restoreFooterStatusRepaintHook?.();
          restoreFooterStatusRepaintHook = null;
        },
        invalidate() {
          requestStatusRender();
        },
        render(): string[] {
          return [];
        },
      };
    });

    if (tuiRef) installFixedEditorCompositor(ctx, tuiRef);
  }
}
