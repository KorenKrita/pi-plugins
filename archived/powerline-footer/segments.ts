import { basename } from "node:path";
import type { BuiltinStatusLineSegmentId, RenderedSegment, SegmentContext, SemanticColor, StatusLineSegment, StatusLineSegmentId } from "./types.ts";
import { normalizeCompactExtensionStatus, normalizeExtensionStatusValue } from "./powerline-config.ts";
import { applyColor, fg, rainbow } from "./theme.ts";
import { getIcons, getThinkingText, SEP_DOT } from "./icons.ts";

function color(ctx: SegmentContext, semantic: SemanticColor, text: string): string {
  return fg(ctx.theme, semantic, text, ctx.colors);
}

function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

function formatTokens(value: number): string {
  if (value < 1000) return value.toString();
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`;
  return `${Math.round(value / 1000000)}M`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

const modelSegment: StatusLineSegment = {
  id: "model",
  render(ctx) {
    const icons = getIcons();
    const options = ctx.options.model ?? {};
    let modelName = ctx.model?.name || ctx.model?.id || "no-model";
    if (modelName.startsWith("Claude ")) modelName = modelName.slice(7);

    let content = withIcon(icons.model, modelName);
    if (options.showThinkingLevel !== false && ctx.model?.reasoning) {
      const level = ctx.thinkingLevel || "off";
      const thinkingText = level === "off" ? undefined : getThinkingText(level);
      if (thinkingText) content += `${SEP_DOT}${thinkingText}`;
    }

    return { content: color(ctx, "model", content), visible: true };
  },
};

const thinkingSegment: StatusLineSegment = {
  id: "thinking",
  render(ctx) {
    const level = ctx.thinkingLevel || "off";
    // Keep think:off visible because this footer intentionally shows the complete active mode state.
    const label = ({ off: "off", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xhigh" } as Record<string, string>)[level] || level;
    const content = `think:${label}`;

    if (level === "high" || level === "xhigh") return { content: rainbow(content), visible: true };
    if (level === "minimal") return { content: color(ctx, "thinkingMinimal", content), visible: true };
    if (level === "low") return { content: color(ctx, "thinkingLow", content), visible: true };
    if (level === "medium") return { content: color(ctx, "thinkingMedium", content), visible: true };
    return { content: color(ctx, "thinking", content), visible: true };
  },
};

const pathSegment: StatusLineSegment = {
  id: "path",
  render(ctx) {
    const icons = getIcons();
    const options = ctx.options.path ?? {};
    const mode = options.mode ?? "basename";
    let displayPath = ctx.cwd ?? process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE;

    if (mode === "basename") {
      displayPath = basename(displayPath) || displayPath;
    } else {
      if (home && displayPath.startsWith(home)) displayPath = `~${displayPath.slice(home.length)}`;
      if (displayPath.startsWith("/work/")) displayPath = displayPath.slice(6);
      if (mode === "abbreviated") {
        const maxLength = options.maxLength ?? 40;
        if (displayPath.length > maxLength) displayPath = `…${displayPath.slice(-(maxLength - 1))}`;
      }
    }

    return { content: color(ctx, "path", withIcon(icons.folder, displayPath)), visible: true };
  },
};

const gitSegment: StatusLineSegment = {
  id: "git",
  render(ctx) {
    const icons = getIcons();
    const options = ctx.options.git ?? {};
    const { branch, staged, unstaged, untracked } = ctx.git;
    const dirty = staged > 0 || unstaged > 0 || untracked > 0;
    if (!branch && !dirty) return { content: "", visible: false };

    const branchColor: SemanticColor = dirty ? "gitDirty" : "gitClean";
    let content = options.showBranch !== false && branch ? color(ctx, branchColor, withIcon(icons.branch, branch)) : "";
    const indicators: string[] = [];
    if (options.showUnstaged !== false && unstaged > 0) indicators.push(color(ctx, "gitUnstaged", `*${unstaged}`));
    if (options.showStaged !== false && staged > 0) indicators.push(color(ctx, "gitStaged", `+${staged}`));
    if (options.showUntracked !== false && untracked > 0) indicators.push(color(ctx, "gitUntracked", `?${untracked}`));

    if (indicators.length > 0) {
      const indicatorText = indicators.join(" ");
      content = content
        ? `${content} ${indicatorText}`
        : color(ctx, branchColor, icons.git ? `${icons.git} ` : "") + indicatorText;
    }

    return content ? { content, visible: true } : { content: "", visible: false };
  },
};

const tokenInSegment: StatusLineSegment = {
  id: "token_in",
  render(ctx) {
    const { input } = ctx.usageStats;
    if (!input) return { content: "", visible: false };
    return { content: color(ctx, "tokens", withIcon(getIcons().input, formatTokens(input))), visible: true };
  },
};

const tokenOutSegment: StatusLineSegment = {
  id: "token_out",
  render(ctx) {
    const { output } = ctx.usageStats;
    if (!output) return { content: "", visible: false };
    return { content: color(ctx, "tokens", withIcon(getIcons().output, formatTokens(output))), visible: true };
  },
};

const tokenTotalSegment: StatusLineSegment = {
  id: "token_total",
  render(ctx) {
    const { input, output, cacheRead, cacheWrite } = ctx.usageStats;
    const total = input + output + cacheRead + cacheWrite;
    if (!total) return { content: "", visible: false };
    return { content: color(ctx, "tokens", withIcon(getIcons().tokens, formatTokens(total))), visible: true };
  },
};

const contextPctSegment: StatusLineSegment = {
  id: "context_pct",
  render(ctx) {
    if (ctx.customCompactionEnabled) return { content: "", visible: false };

    const icons = getIcons();
    const autoIcon = ctx.autoCompactEnabled && icons.auto ? ` ${icons.auto}` : "";
    const text = `${ctx.contextPercent.toFixed(1)}%/${formatTokens(ctx.contextWindow)}${autoIcon}`;
    let semantic: SemanticColor = "context";
    if (ctx.contextPercent > 90) semantic = "contextError";
    else if (ctx.contextPercent > 70) semantic = "contextWarn";
    return { content: color(ctx, semantic, withIcon(icons.context, text)), visible: true };
  },
};

const cacheReadSegment: StatusLineSegment = {
  id: "cache_read",
  render(ctx) {
    const { cacheRead } = ctx.usageStats;
    if (!cacheRead) return { content: "", visible: false };
    const icons = getIcons();
    return { content: color(ctx, "tokens", [icons.cache, icons.input, formatTokens(cacheRead)].filter(Boolean).join(" ")), visible: true };
  },
};

const cacheWriteSegment: StatusLineSegment = {
  id: "cache_write",
  render(ctx) {
    const { cacheWrite } = ctx.usageStats;
    if (!cacheWrite) return { content: "", visible: false };
    const icons = getIcons();
    return { content: color(ctx, "tokens", [icons.cache, icons.output, formatTokens(cacheWrite)].filter(Boolean).join(" ")), visible: true };
  },
};

const costSegment: StatusLineSegment = {
  id: "cost",
  render(ctx) {
    const { cost } = ctx.usageStats;
    if (!cost && !ctx.usingSubscription) return { content: "", visible: false };
    return { content: color(ctx, "cost", ctx.usingSubscription ? "(sub)" : `$${cost.toFixed(2)}`), visible: true };
  },
};

const timeSpentSegment: StatusLineSegment = {
  id: "time_spent",
  render(ctx) {
    const elapsed = Date.now() - ctx.sessionStartTime;
    if (elapsed < 1000) return { content: "", visible: false };
    return { content: color(ctx, "time", withIcon(getIcons().time, formatDuration(elapsed))), visible: true };
  },
};

const extensionStatusesSegment: StatusLineSegment = {
  id: "extension_statuses",
  render(ctx) {
    if (ctx.extensionStatuses.size === 0) return { content: "", visible: false };

    const parts: string[] = [];
    for (const [statusKey, value] of ctx.extensionStatuses.entries()) {
      if (ctx.hiddenExtensionStatusKeys.has(statusKey)) continue;
      const normalized = value ? normalizeCompactExtensionStatus(value) : null;
      if (normalized) parts.push(normalized);
    }

    return parts.length > 0
      ? { content: color(ctx, "path", parts.join(` ${SEP_DOT} `)), visible: true }
      : { content: "", visible: false };
  },
};

export const SEGMENTS: Record<BuiltinStatusLineSegmentId, StatusLineSegment> = {
  model: modelSegment,
  thinking: thinkingSegment,
  path: pathSegment,
  git: gitSegment,
  context_pct: contextPctSegment,
  token_in: tokenInSegment,
  token_out: tokenOutSegment,
  token_total: tokenTotalSegment,
  cache_read: cacheReadSegment,
  cache_write: cacheWriteSegment,
  cost: costSegment,
  time_spent: timeSpentSegment,
  extension_statuses: extensionStatusesSegment,
};

function renderCustomSegment(id: `custom:${string}`, ctx: SegmentContext): RenderedSegment {
  const custom = ctx.customItemsById.get(id.slice("custom:".length));
  if (!custom) return { content: "", visible: false };

  const rawStatus = ctx.extensionStatuses.get(custom.statusKey);
  const normalizedStatus = rawStatus ? normalizeExtensionStatusValue(rawStatus) : null;
  if (!normalizedStatus) {
    return custom.hideWhenMissing ? { content: "", visible: false } : { content: custom.prefix ?? custom.id, visible: true };
  }

  let content = custom.prefix ? `${custom.prefix}${SEP_DOT}${normalizedStatus}` : normalizedStatus;
  if (custom.color) content = applyColor(ctx.theme, custom.color, content);
  return { content, visible: true };
}

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
  if (id.startsWith("custom:")) return renderCustomSegment(id as `custom:${string}`, ctx);
  return SEGMENTS[id as BuiltinStatusLineSegmentId]?.render(ctx) ?? { content: "", visible: false };
}
