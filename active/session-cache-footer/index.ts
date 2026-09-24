import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

const STALL_THRESHOLD_MS = 500;
const MIN_STREAM_MS = 1;
const MIN_STREAM_UPDATES = 5;
const MIN_INTER_CHUNK_MS = 1;
const MIN_GENERATION_MS = 200;
const ACTIVE_TIME_THRESHOLD_MS = 200;
const STALL_REDUCTION_DENOM = 2;
const STALL_DOMINANCE_RATIO = 0.85;
const MAX_PLAUSIBLE_TPS = 10_000;
const DISPLAY_MODE_CONFIG_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "session-cache-footer.json",
);

type StatsDisplayMode = "hidden" | "aggregate" | "step";

interface TokenStatsData {
  text: string;
  endedAt?: number;
  contextPercent?: number | null;
  scope?: "step" | "aggregate";
}
interface StatsTheme {
  dim: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
  warning: (text: string) => string;
}

/** A faint rule followed by two preferred rows of semantic metric groups. */
class StatsBlock implements Component {
  constructor(
    private readonly rows: readonly (readonly (readonly string[])[])[],
    private readonly dim: (text: string) => string,
  ) {}

  render(width: number): string[] {
    // Avoid writing into the last terminal column, which can create a wrapped rule fragment.
    const ruleWidth = Math.max(0, width - 2);
    const rule = ruleWidth > 0 ? [this.dim("─".repeat(ruleWidth))] : [];
    const paddingX = width >= 3 ? 1 : 0;
    const contentWidth = Math.max(0, width - paddingX * 2);
    if (contentWidth === 0) return rule;

    const groupSeparator = this.dim(" │ ");
    const fieldSeparator = this.dim(" · ");
    const lines: string[] = [];
    let current = "";

    const flush = () => {
      if (current) lines.push(current);
      current = "";
    };

    for (const row of this.rows) {
      for (const fields of row) {
        const group = fields.join(fieldSeparator);
        if (visibleWidth(group) <= contentWidth) {
          const candidate = current ? `${current}${groupSeparator}${group}` : group;
          if (visibleWidth(candidate) <= contentWidth) {
            current = candidate;
          } else {
            flush();
            current = group;
          }
          continue;
        }

        // A semantic group that cannot fit gets split only between complete fields.
        flush();
        let fragment = "";
        for (const field of fields) {
          // An individual field wider than the terminal is the only unavoidable hard-trim case.
          const safeField =
            visibleWidth(field) <= contentWidth ? field : truncateToWidth(field, contentWidth, "");
          const candidate = fragment ? `${fragment}${fieldSeparator}${safeField}` : safeField;
          if (fragment && visibleWidth(candidate) > contentWidth) {
            lines.push(fragment);
            fragment = safeField;
          } else {
            fragment = candidate;
          }
        }
        if (fragment) lines.push(fragment);
      }

      // Preserve the requested two-row hierarchy even when both rows fit on one line.
      flush();
    }

    const padding = " ".repeat(paddingX);
    return [...rule, ...lines.map((line) => `${padding}${line}`)];
  }

  invalidate(): void {}
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
    .format(timestamp)
    .toLowerCase();
}

function styleTokenStats(
  data: TokenStatsData,
  styles: StatsTheme,
): string[][][] {
  const defaults: Record<string, string> = {
    STATUS: "OK",
    IN: "0",
    OUT: "0",
    THINK: "0",
    HIT: "0 (0%)",
    MISS: "0",
    TOOLS: "0",
    TTFT: "—",
    DURATION: "0.0s",
    TPS: "—/s",
    STALL: "0.0s ×0",
    COST: "$0.00000",
    RATE: "$0.00/M",
    MODEL_TIME: "0.0s",
    TOOL_TIME: "0.0s",
    CALLS: "0",
    RETRIES: "—",
    TOOL_FAILED: "0",
    CONTEXT: "—/—",
    SAVED: "$0.00000",
    REASON: "—",
    SLOWEST_TOOL: "—",
    PEAK_PARALLEL: "0",
    HTTP_STATUS: "—",
    RATE_RESET: "—",
    CONTEXT_DELTA: "—",
  };
  const values = new Map<string, string>();
  for (const part of data.text.split(" │ ")) {
    const match = part.match(/^([A-Z_]+) (.+)$/);
    if (match) {
      values.set(match[1]!, match[2]!);
      continue;
    }

    // Preserve stats written by the original unlabeled renderer.
    if (/^(LENGTH|ERROR|ABORTED)$/.test(part)) values.set("STATUS", part);
    else if (part.startsWith("stall ")) values.set("STALL", part.slice("stall ".length));
    else if (/^(?:~?\d+(?:\.\d+)?|—) t\/s$/.test(part)) {
      values.set("TPS", part.replace(" t/s", "/s"));
    } else if (part.startsWith("$") && part.endsWith("/M")) values.set("RATE", part);
    else if (part.startsWith("$")) values.set("COST", part);
    else if (/^(?:\d+(?:\.\d+)?s|\d+m \d+s|\d+h \d+m)$/.test(part)) {
      values.set("DURATION", part);
    }
  }

  const value = (label: string) => values.get(label) ?? defaults[label]!;
  const contextValue =
    values.get("CONTEXT") ??
    (values.has("WINDOW") ? `—/${values.get("WINDOW")}` : defaults.CONTEXT);
  const labeled = (label: string, content: string) => `${styles.dim(label)} ${content}`;
  const currency = (content: string) =>
    content.startsWith("$") ? `${styles.dim("$")}${content.slice(1)}` : content;
  const statusValue = value("STATUS");
  const styledStatus =
    statusValue === "ERROR"
      ? styles.error(statusValue)
      : statusValue === "ABORTED" || statusValue === "LENGTH"
        ? styles.warning(statusValue)
        : styles.success(statusValue);
  const httpStatusValue = value("HTTP_STATUS");
  const httpStatusNumber = Number(httpStatusValue);
  const styledHttpStatus =
    !Number.isInteger(httpStatusNumber)
      ? httpStatusValue
      : httpStatusNumber === 429
        ? styles.warning(httpStatusValue)
        : httpStatusNumber >= 400
          ? styles.error(httpStatusValue)
          : httpStatusNumber >= 300
            ? styles.warning(httpStatusValue)
            : styles.success(httpStatusValue);
  const contextStyle =
    typeof data.contextPercent === "number" && data.contextPercent > 90
      ? styles.error
      : typeof data.contextPercent === "number" && data.contextPercent > 70
        ? styles.warning
        : undefined;
  const styledContext = contextStyle ? contextStyle(contextValue) : contextValue;
  const contextDelta = value("CONTEXT_DELTA");
  const styledContextDelta = contextStyle ? contextStyle(contextDelta) : contextDelta;
  const cacheMatch = value("HIT").match(/^(\S+)(?: \((\d+)%\))?$/);
  const cacheRead = cacheMatch?.[1] ?? "0";
  const cacheHit = `${cacheMatch?.[2] ?? "0"}%`;
  const clock = data.endedAt === undefined ? "--:--" : formatClock(data.endedAt);

  const groups = [
    [`${styles.dim("◷")} ${clock}`, labeled("duration", value("DURATION"))],
    [
      labeled("ttft", value("TTFT")),
      labeled("tps", value("TPS")),
      labeled("model time", value("MODEL_TIME")),
      labeled("tool time", value("TOOL_TIME")),
    ],
    [
      `${styles.dim("↓")} ${labeled("in", value("IN"))}`,
      `${styles.dim("↑")} ${labeled("out", value("OUT"))}`,
      labeled("think", value("THINK")),
    ],
    [
      `${styles.dim("cache")} ${labeled("read", cacheRead)}`,
      labeled("written", value("MISS")),
      labeled("hit", cacheHit),
      labeled("saved", currency(value("SAVED"))),
    ],
    [labeled("status", styledStatus), labeled("reason", value("REASON"))],
    [
      labeled("tools", value("TOOLS")),
      labeled("failed", value("TOOL_FAILED")),
      labeled("slowest", value("SLOWEST_TOOL")),
      labeled("peak", value("PEAK_PARALLEL")),
    ],
    [
      labeled("calls", value("CALLS")),
      labeled("retries", value("RETRIES")),
      labeled("http", styledHttpStatus),
      labeled("reset", value("RATE_RESET")),
    ],
    [labeled("stall", value("STALL"))],
    [
      labeled("context", styledContext),
      `${styles.dim("Δ")} ${styledContextDelta}`,
    ],
    [
      labeled("cost", currency(value("COST"))),
      labeled("rate", currency(value("RATE"))),
    ],
  ];

  return [groups.slice(0, 4), groups.slice(4)];
}

interface ModelInfo {
  provider: string;
  modelId: string;
}

interface AggregateStats {
  startedAt: number;
  turns: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  cacheSavings: number;
  toolCount: number;
  toolFailed: number;
  modelCalls: number;
  generationMs: number;
  toolTimeMs: number;
  stallMs: number;
  stallCount: number;
  ttftMs: number | null;
  peakParallel: number;
  slowestToolName: string | null;
  slowestToolMs: number;
  httpStatus: number | null;
  rateLimitReset: string;
  status: string;
  stopReason: string | null;
  contextStartTokens: number | null;
  contextTokens: number | null;
  contextWindow: number;
  contextPercent: number | null;
}

function createAggregateStats(): AggregateStats {
  return {
    startedAt: performance.now(),
    turns: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    cacheSavings: 0,
    toolCount: 0,
    toolFailed: 0,
    modelCalls: 0,
    generationMs: 0,
    toolTimeMs: 0,
    stallMs: 0,
    stallCount: 0,
    ttftMs: null,
    peakParallel: 0,
    slowestToolName: null,
    slowestToolMs: 0,
    httpStatus: null,
    rateLimitReset: "—",
    status: "OK",
    stopReason: null,
    contextStartTokens: null,
    contextTokens: null,
    contextWindow: 0,
    contextPercent: null,
  };
}

interface SessionEntryLike {
  type: string;
  message?: {
    role: string;
    usage?: {
      input?: number;
      output?: number;
      cost?: { total?: number };
    };
  };
}

function computeTps(
  outputTokens: number,
  streamMs: number | null,
  generationMs: number,
  stallMs: number,
  updates: number,
): { tps: number | null; isPrimary: boolean } {
  let tps: number | null = null;
  let isPrimary = false;
  const avgGap = streamMs !== null && updates > 1 ? streamMs / (updates - 1) : 0;

  if (
    streamMs !== null &&
    streamMs >= MIN_STREAM_MS &&
    updates >= MIN_STREAM_UPDATES &&
    avgGap >= MIN_INTER_CHUNK_MS &&
    stallMs < streamMs &&
    streamMs - stallMs >= MIN_GENERATION_MS &&
    stallMs < streamMs - stallMs
  ) {
    tps = Math.round((outputTokens / ((streamMs - stallMs) / 1000)) * 10) / 10;
    isPrimary = true;
  } else if (updates >= 2 && generationMs >= MIN_GENERATION_MS) {
    const activeMs = generationMs - stallMs;
    const stallsDominate =
      activeMs < ACTIVE_TIME_THRESHOLD_MS || stallMs > generationMs * STALL_DOMINANCE_RATIO;
    const effectiveGenMs = stallsDominate
      ? Math.max(generationMs - stallMs / STALL_REDUCTION_DENOM, MIN_GENERATION_MS)
      : Math.max(activeMs, MIN_GENERATION_MS);
    tps = Math.round((outputTokens / (effectiveGenMs / 1000)) * 10) / 10;
  }

  if (tps !== null && tps > MAX_PLAUSIBLE_TPS) {
    tps = null;
    isPrimary = false;
  }
  return { tps, isPrimary };
}

function applyModelCap(
  caps: Map<string, number>,
  modelKey: string,
  tps: number | null,
  isPrimary: boolean,
  isToolCall: boolean,
): number | null {
  if (isPrimary && tps !== null) {
    const current = caps.get(modelKey);
    if (current === undefined || tps > current) caps.set(modelKey, tps);
  }
  if (isToolCall && tps !== null) {
    const cap = caps.get(modelKey);
    return cap !== undefined ? Math.min(tps, cap) : tps;
  }
  return tps;
}

function computeRateUsdPerM(costUsd: number, totalTokens: number): number | null {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return null;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  const rate = costUsd / (totalTokens / 1_000_000);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return Math.round(rate * 100) / 100;
}

interface CachePricing {
  input: number;
  cacheRead: number;
  tiers?: Array<{ inputTokensAbove: number; input: number; cacheRead: number }>;
}

function computeCacheSavings(
  model: { cost: CachePricing },
  usage: { input: number; cacheRead: number; cacheWrite: number },
): number {
  if (usage.cacheRead <= 0) return 0;
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates = model.cost;
  let matchedThreshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }
  const savings = ((rates.input - rates.cacheRead) / 1_000_000) * usage.cacheRead;
  return Number.isFinite(savings) ? Math.max(0, savings) : 0;
}

function computeIntervalUnionMs(intervals: readonly [number, number][]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals]
    .map(([start, end]) => [Math.min(start, end), Math.max(start, end)] as [number, number])
    .sort(([left], [right]) => left - right);
  let [, currentEnd] = sorted[0]!;
  let currentStart = sorted[0]![0];
  let total = 0;

  for (let index = 1; index < sorted.length; index++) {
    const [start, end] = sorted[index]!;
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  return total + currentEnd - currentStart;
}

function sanitizeMetricValue(text: string, maxWidth = 32): string {
  const clean = text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[│·]/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? truncateToWidth(clean, maxWidth, "") : "—";
}

function formatResetWait(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "now";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${seconds ? `${seconds}s` : ""}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h${remainingMinutes ? `${remainingMinutes}m` : ""}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d${remainingHours ? `${remainingHours}h` : ""}`;
}

function formatRateLimitReset(headers: Record<string, string>, now: number): string {
  const normalized = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const names = [
    "retry-after",
    "x-ratelimit-reset-requests",
    "ratelimit-reset",
    "x-ratelimit-reset",
    "anthropic-ratelimit-requests-reset",
    "x-ratelimit-reset-tokens",
    "anthropic-ratelimit-tokens-reset",
  ];

  for (const name of names) {
    const rawValue = normalized.get(name);
    if (typeof rawValue !== "string" || !rawValue.trim()) continue;
    const raw = rawValue.trim();
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const resetAt =
        name === "retry-after" || numeric < 1_000_000_000
          ? now + numeric * 1000
          : numeric > 10_000_000_000
            ? numeric
            : numeric * 1000;
      return formatResetWait(resetAt - now);
    }

    const compact = raw.toLowerCase().replace(/\s+/g, "");
    if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(compact)) {
      const unitMs = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
      let durationMs = 0;
      for (const match of compact.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
        durationMs += Number(match[1]) * unitMs[match[2] as keyof typeof unitMs];
      }
      return formatResetWait(durationMs);
    }

    const parsedAt = Date.parse(raw);
    if (Number.isFinite(parsedAt)) return formatResetWait(parsedAt - now);
    return sanitizeMetricValue(raw, 24);
  }
  return "—";
}

function formatTurnTokens(n: number): string {
  const scaled = (value: number, suffix: string) => {
    const text = value.toFixed(1);
    return `${text.endsWith(".0") ? text.slice(0, -2) : text}${suffix}`;
  };
  if (n >= 1e9) return scaled(n / 1e9, "B");
  if (n >= 1e6) return scaled(n / 1e6, "M");
  if (n >= 1e3) return scaled(n / 1e3, "k");
  return `${n}`;
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(5)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function registerTokenStats(pi: ExtensionAPI, getDisplayMode: () => StatsDisplayMode) {
  let runDisplayMode = getDisplayMode();
  let aggregate = createAggregateStats();
  let turnStart = 0;
  let lastUpdateAt = 0;
  let firstTokenAt: number | null = null;
  let msgStart: number | null = null;
  let generationMs = 0;
  let updateCount = 0;
  let firstStreamAt: number | null = null;
  let lastStreamAt = 0;
  let stallMs = 0;
  let stallCount = 0;
  let inStall = false;
  let toolCount = 0;
  let toolFailed = 0;
  let modelCalls = 0;
  let isToolCall = false;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalTokens = 0;
  let cost = 0;
  let cacheSavings = 0;
  let reasoning = 0;
  let contextWindow = 0;
  let model: ModelInfo | null = null;
  let stopReason: string | null = null;
  let contextStartTokens: number | null = null;
  let peakParallel = 0;
  let slowestToolName: string | null = null;
  let slowestToolMs = 0;
  let httpStatus: number | null = null;
  let rateLimitReset = "—";
  const toolStarts = new Map<string, { startedAt: number; toolName: string }>();
  const toolIntervals: Array<[number, number]> = [];
  const tpsCaps = new Map<string, number>();
  pi.registerEntryRenderer<TokenStatsData>("token-stats", (entry, _options, theme) => {
    const data = entry.data ?? { text: "" };
    const styles: StatsTheme = {
      dim: (text) => theme.fg("dim", text),
      success: (text) => theme.fg("success", text),
      error: (text) => theme.fg("error", text),
      warning: (text) => theme.fg("warning", text),
    };
    return new StatsBlock(
      styleTokenStats(data, styles),
      (text) => `\x1b[2m${styles.dim(text)}\x1b[22m`,
    );
  });

  pi.on("agent_start", () => {
    runDisplayMode = getDisplayMode();
    aggregate = createAggregateStats();
  });

  pi.on("turn_start", async (_event, ctx) => {
    const now = performance.now();
    const initialContextUsage = ctx.getContextUsage();
    turnStart = now;
    lastUpdateAt = now;
    firstTokenAt = null;
    msgStart = null;
    generationMs = 0;
    toolIntervals.length = 0;
    updateCount = 0;
    firstStreamAt = null;
    lastStreamAt = 0;
    stallMs = 0;
    stallCount = 0;
    inStall = false;
    toolCount = 0;
    toolFailed = 0;
    modelCalls = 0;
    isToolCall = false;
    input = 0;
    output = 0;
    cacheRead = 0;
    cacheWrite = 0;
    totalTokens = 0;
    cost = 0;
    cacheSavings = 0;
    reasoning = 0;
    contextWindow = 0;
    contextStartTokens =
      typeof initialContextUsage?.tokens === "number" ? initialContextUsage.tokens : null;
    peakParallel = 0;
    slowestToolName = null;
    slowestToolMs = 0;
    httpStatus = null;
    rateLimitReset = "—";
    model = null;
    stopReason = null;
    toolStarts.clear();
  });

  pi.on("message_start", async (event) => {
    if (event.message.role !== "assistant") return;
    const now = performance.now();
    msgStart = now;
    lastUpdateAt = now;
    inStall = false;
  });

  pi.on("message_update", async (event) => {
    if (turnStart === 0 || event.message.role !== "assistant") return;
    const now = performance.now();

    if (firstTokenAt === null) {
      firstTokenAt = now;
      lastUpdateAt = now;
      return;
    }

    updateCount++;
    if (firstStreamAt === null) firstStreamAt = now;
    lastStreamAt = now;

    const gap = now - lastUpdateAt;
    if (gap >= STALL_THRESHOLD_MS) {
      if (!inStall) stallCount++;
      inStall = true;
      stallMs += gap;
    } else {
      inStall = false;
    }
    lastUpdateAt = now;
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    modelCalls++;
    contextWindow = ctx.model?.contextWindow ?? contextWindow;
  });

  pi.on("after_provider_response", async (event) => {
    httpStatus = Number.isInteger(event.status) ? event.status : null;
    rateLimitReset = formatRateLimitReset(event.headers, Date.now());
  });

  pi.on("tool_execution_start", async (event) => {
    isToolCall = true;
    toolStarts.set(event.toolCallId, {
      startedAt: performance.now(),
      toolName: sanitizeMetricValue(event.toolName, 20),
    });
    peakParallel = Math.max(peakParallel, toolStarts.size);
  });

  pi.on("tool_execution_end", async (event) => {
    const endedAt = performance.now();
    const started = toolStarts.get(event.toolCallId);
    if (started) {
      const elapsedMs = endedAt - started.startedAt;
      toolIntervals.push([started.startedAt, endedAt]);
      if (elapsedMs > slowestToolMs) {
        slowestToolName = started.toolName;
        slowestToolMs = elapsedMs;
      }
    }
    toolStarts.delete(event.toolCallId);
    toolCount++;
    if (event.isError) toolFailed++;
  });

  pi.on("message_end", async (event, ctx) => {
    const msg = event.message;
    if (!msg || msg.role !== "assistant") return;
    const now = performance.now();

    if (msgStart !== null) {
      generationMs += now - msgStart;
      msgStart = null;
    }
    lastUpdateAt = now;
    stopReason = msg.stopReason ?? stopReason;
    if (!model && msg.provider && msg.model) {
      model = { provider: msg.provider, modelId: msg.model };
    }

    const usage = msg.usage;
    if (!usage) return;
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    cacheRead += usage.cacheRead ?? 0;
    cacheWrite += usage.cacheWrite ?? 0;
    totalTokens += usage.totalTokens ?? 0;
    cost += usage.cost?.total ?? 0;
    if (typeof usage.reasoning === "number") {
      reasoning += usage.reasoning;
    }

    const registryModel =
      msg.provider && msg.model ? ctx.modelRegistry?.find?.(msg.provider, msg.model) : undefined;
    if (registryModel) {
      contextWindow = registryModel.contextWindow;
      cacheSavings += computeCacheSavings(registryModel, usage);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (turnStart === 0) return;
    const startedAt = turnStart;
    turnStart = 0;
    const endedAt = performance.now();
    const totalMs = endedAt - startedAt;
    const activeToolIntervals = Array.from(toolStarts.values(), (started) => {
      const elapsedMs = endedAt - started.startedAt;
      if (elapsedMs > slowestToolMs) {
        slowestToolName = started.toolName;
        slowestToolMs = elapsedMs;
      }
      return [started.startedAt, endedAt] as [number, number];
    });
    const toolTimeMs = computeIntervalUnionMs([...toolIntervals, ...activeToolIntervals]);
    const ttftMs = firstTokenAt === null ? null : firstTokenAt - startedAt;
    const streamMs =
      updateCount > 0 && firstStreamAt !== null ? lastStreamAt - firstStreamAt : null;
    const measurement =
      output > 0 && firstTokenAt !== null
        ? computeTps(output, streamMs, generationMs, stallMs, updateCount)
        : { tps: null, isPrimary: false };
    const tps = model
      ? applyModelCap(
          tpsCaps,
          `${model.provider}:${model.modelId}`,
          measurement.tps,
          measurement.isPrimary,
          isToolCall,
        )
      : measurement.tps;
    const totalIn = cacheRead + input + cacheWrite;
    const hitRate = totalIn > 0 ? Math.round((cacheRead / totalIn) * 100) : 0;
    const rate = computeRateUsdPerM(cost, totalTokens);
    const contextUsage = ctx.getContextUsage();
    const resolvedContextWindow = contextUsage?.contextWindow ?? contextWindow;
    const contextTokens =
      typeof contextUsage?.tokens === "number" ? contextUsage.tokens : null;
    const contextUsed = contextTokens === null ? "?" : formatTurnTokens(contextTokens);
    const contextDisplay = `${contextUsed}/${
      resolvedContextWindow > 0 ? formatTurnTokens(resolvedContextWindow) : "—"
    }`;
    const contextDelta =
      contextTokens === null || contextStartTokens === null
        ? "—"
        : contextTokens === contextStartTokens
          ? "0"
          : `${contextTokens > contextStartTokens ? "+" : "−"}${formatTurnTokens(
              Math.abs(contextTokens - contextStartTokens),
            )}`;
    const contextPercent =
      typeof contextUsage?.percent === "number"
        ? contextUsage.percent
        : contextTokens !== null && resolvedContextWindow > 0
          ? (contextTokens / resolvedContextWindow) * 100
          : null;
    const status =
      stopReason === "length" || stopReason === "error" || stopReason === "aborted"
        ? stopReason.toUpperCase()
        : "OK";

    const slowestTool =
      slowestToolName === null ? "—" : `${slowestToolName} ${formatDuration(slowestToolMs)}`;
    const parts = [
      `STATUS ${status}`,
      `IN ${formatTurnTokens(input)}`,
      `OUT ${formatTurnTokens(output)}`,
      `THINK ${formatTurnTokens(reasoning)}`,
      `HIT ${formatTurnTokens(cacheRead)} (${hitRate}%)`,
      `MISS ${formatTurnTokens(cacheWrite)}`,
      `TOOLS ${toolCount}`,
      `TTFT ${ttftMs === null ? "—" : formatDuration(ttftMs)}`,
      `DURATION ${formatDuration(totalMs)}`,
      `TPS ${tps !== null ? `${measurement.isPrimary ? "" : "~"}${tps.toFixed(1)}/s` : "—/s"}`,
      `STALL ${formatDuration(stallMs)} ×${stallCount}`,
      `COST ${formatCost(cost)}`,
      `RATE $${(rate ?? 0).toFixed(2)}/M`,
      `MODEL_TIME ${formatDuration(generationMs)}`,
      `TOOL_TIME ${formatDuration(toolTimeMs)}`,
      `CALLS ${modelCalls}`,
      "RETRIES —",
      `TOOL_FAILED ${toolFailed}`,
      `SLOWEST_TOOL ${slowestTool}`,
      `PEAK_PARALLEL ${peakParallel}`,
      `HTTP_STATUS ${httpStatus ?? "—"}`,
      `RATE_RESET ${rateLimitReset}`,
      `CONTEXT ${contextDisplay}`,
      `CONTEXT_DELTA ${contextDelta}`,
      `SAVED ${formatCost(cacheSavings)}`,
      `REASON ${stopReason ?? "—"}`,
    ];

    const data: TokenStatsData = {
      text: parts.join(" │ "),
      endedAt: Date.now(),
      contextPercent,
      scope: "step",
    };

    aggregate.turns++;
    aggregate.input += input;
    aggregate.output += output;
    aggregate.reasoning += reasoning;
    aggregate.cacheRead += cacheRead;
    aggregate.cacheWrite += cacheWrite;
    aggregate.totalTokens += totalTokens;
    aggregate.cost += cost;
    aggregate.cacheSavings += cacheSavings;
    aggregate.toolCount += toolCount;
    aggregate.toolFailed += toolFailed;
    aggregate.modelCalls += modelCalls;
    aggregate.generationMs += generationMs;
    aggregate.toolTimeMs += toolTimeMs;
    aggregate.stallMs += stallMs;
    aggregate.stallCount += stallCount;
    aggregate.ttftMs ??= ttftMs;
    aggregate.peakParallel = Math.max(aggregate.peakParallel, peakParallel);
    if (slowestToolMs > aggregate.slowestToolMs) {
      aggregate.slowestToolName = slowestToolName;
      aggregate.slowestToolMs = slowestToolMs;
    }
    aggregate.httpStatus = httpStatus;
    aggregate.rateLimitReset = rateLimitReset;
    if (status !== "OK") aggregate.status = status;
    aggregate.stopReason = stopReason;
    aggregate.contextStartTokens ??= contextStartTokens;
    aggregate.contextTokens = contextTokens;
    aggregate.contextWindow = resolvedContextWindow;
    aggregate.contextPercent = contextPercent;

    if (runDisplayMode === "step") pi.appendEntry<TokenStatsData>("token-stats", data);
  });
  pi.on("agent_end", () => {
    if (runDisplayMode !== "aggregate" || aggregate.turns === 0) return;

    const totalIn = aggregate.cacheRead + aggregate.input + aggregate.cacheWrite;
    const hitRate = totalIn > 0 ? Math.round((aggregate.cacheRead / totalIn) * 100) : 0;
    const activeGenerationMs = Math.max(0, aggregate.generationMs - aggregate.stallMs);
    const tps =
      aggregate.output > 0 && activeGenerationMs >= MIN_GENERATION_MS
        ? aggregate.output / (activeGenerationMs / 1000)
        : null;
    const rate = computeRateUsdPerM(aggregate.cost, aggregate.totalTokens);
    const contextUsed =
      aggregate.contextTokens === null ? "?" : formatTurnTokens(aggregate.contextTokens);
    const contextDisplay = `${contextUsed}/${
      aggregate.contextWindow > 0 ? formatTurnTokens(aggregate.contextWindow) : "—"
    }`;
    const contextDelta =
      aggregate.contextTokens === null || aggregate.contextStartTokens === null
        ? "—"
        : aggregate.contextTokens === aggregate.contextStartTokens
          ? "0"
          : `${aggregate.contextTokens > aggregate.contextStartTokens ? "+" : "−"}${formatTurnTokens(
              Math.abs(aggregate.contextTokens - aggregate.contextStartTokens),
            )}`;
    const slowestTool =
      aggregate.slowestToolName === null
        ? "—"
        : `${aggregate.slowestToolName} ${formatDuration(aggregate.slowestToolMs)}`;
    const parts = [
      `STATUS ${aggregate.status}`,
      `IN ${formatTurnTokens(aggregate.input)}`,
      `OUT ${formatTurnTokens(aggregate.output)}`,
      `THINK ${formatTurnTokens(aggregate.reasoning)}`,
      `HIT ${formatTurnTokens(aggregate.cacheRead)} (${hitRate}%)`,
      `MISS ${formatTurnTokens(aggregate.cacheWrite)}`,
      `TOOLS ${aggregate.toolCount}`,
      `TTFT ${aggregate.ttftMs === null ? "—" : formatDuration(aggregate.ttftMs)}`,
      `DURATION ${formatDuration(performance.now() - aggregate.startedAt)}`,
      `TPS ${tps === null || tps > MAX_PLAUSIBLE_TPS ? "—/s" : `~${tps.toFixed(1)}/s`}`,
      `STALL ${formatDuration(aggregate.stallMs)} ×${aggregate.stallCount}`,
      `COST ${formatCost(aggregate.cost)}`,
      `RATE $${(rate ?? 0).toFixed(2)}/M`,
      `MODEL_TIME ${formatDuration(aggregate.generationMs)}`,
      `TOOL_TIME ${formatDuration(aggregate.toolTimeMs)}`,
      `CALLS ${aggregate.modelCalls}`,
      "RETRIES —",
      `TOOL_FAILED ${aggregate.toolFailed}`,
      `SLOWEST_TOOL ${slowestTool}`,
      `PEAK_PARALLEL ${aggregate.peakParallel}`,
      `HTTP_STATUS ${aggregate.httpStatus ?? "—"}`,
      `RATE_RESET ${aggregate.rateLimitReset}`,
      `CONTEXT ${contextDisplay}`,
      `CONTEXT_DELTA ${contextDelta}`,
      `SAVED ${formatCost(aggregate.cacheSavings)}`,
      `REASON ${aggregate.stopReason ?? "—"}`,
    ];

    pi.appendEntry<TokenStatsData>("token-stats", {
      text: parts.join(" │ "),
      endedAt: Date.now(),
      contextPercent: aggregate.contextPercent,
      scope: "aggregate",
    });
  });
}

function collectSessionUsage(entries: readonly SessionEntryLike[]) {
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    input += entry.message.usage?.input ?? 0;
    output += entry.message.usage?.output ?? 0;
    cost += entry.message.usage?.cost?.total ?? 0;
  }
  return { input, output, cost };
}

function formatFooterTokens(count: number): string {
  if (count < 1_000) return count.toString();
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function formatCwd(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function isStatsDisplayMode(value: unknown): value is StatsDisplayMode {
  return value === "hidden" || value === "aggregate" || value === "step";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadDisplayMode(): Promise<{ mode: StatsDisplayMode; warning?: string }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(DISPLAY_MODE_CONFIG_PATH, "utf8"));
    const mode =
      parsed && typeof parsed === "object" && "displayMode" in parsed
        ? (parsed as { displayMode?: unknown }).displayMode
        : undefined;
    if (!isStatsDisplayMode(mode)) {
      return {
        mode: "aggregate",
        warning: `配置 ${DISPLAY_MODE_CONFIG_PATH} 的 displayMode 无效，已使用 aggregate`,
      };
    }
    return { mode };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      try {
        await saveDisplayMode("aggregate");
        return { mode: "aggregate" };
      } catch (saveError) {
        return {
          mode: "aggregate",
          warning: `创建配置 ${DISPLAY_MODE_CONFIG_PATH} 失败，已使用 aggregate：${errorMessage(saveError)}`,
        };
      }
    }
    return {
      mode: "aggregate",
      warning: `读取配置 ${DISPLAY_MODE_CONFIG_PATH} 失败，已使用 aggregate：${errorMessage(error)}`,
    };
  }
}

async function saveDisplayMode(mode: StatsDisplayMode): Promise<void> {
  const temporaryPath = `${DISPLAY_MODE_CONFIG_PATH}.${process.pid}.tmp`;
  await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ displayMode: mode }, null, 2)}\n`, "utf8");
    await rename(temporaryPath, DISPLAY_MODE_CONFIG_PATH);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export default async function sessionCacheFooter(pi: ExtensionAPI) {
  const loadedConfig = await loadDisplayMode();
  let displayMode = loadedConfig.mode;
  const modeLabels: Record<StatsDisplayMode, string> = {
    hidden: "不展示",
    aggregate: "单轮聚合展示",
    step: "每步独立展示",
  };

  pi.registerShortcut("ctrl+shift+l", {
    description: "Cycle token stats display mode",
    handler: async (ctx) => {
      const nextMode =
        displayMode === "step" ? "hidden" : displayMode === "hidden" ? "aggregate" : "step";
      try {
        await saveDisplayMode(nextMode);
        displayMode = nextMode;
        ctx.ui.notify(`下一整轮统计展示：${modeLabels[displayMode]}`, "info");
      } catch (error) {
        ctx.ui.notify(
          `统计展示切换失败，无法写入 ${DISPLAY_MODE_CONFIG_PATH}：${errorMessage(error)}`,
          "error",
        );
      }
    },
  });

  registerTokenStats(pi, () => displayMode);
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    if (loadedConfig.warning) ctx.ui.notify(loadedConfig.warning, "warning");

    const settings = SettingsManager.create(ctx.cwd, undefined, {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const autoCompactEnabled = settings.getCompactionEnabled();

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const {
            input: totalInput,
            output: totalOutput,
            cost: totalCost,
          } = collectSessionUsage(ctx.sessionManager.getEntries());

          const contextUsage = ctx.getContextUsage();
          const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent =
            contextUsage?.percent === null ? "?" : contextPercentValue.toFixed(1);

          let cwd = formatCwd(
            ctx.sessionManager.getCwd(),
            process.env.HOME || process.env.USERPROFILE,
          );
          const branch = footerData.getGitBranch();
          if (branch) cwd = `${cwd} (${branch})`;

          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) cwd = `${cwd} • ${sessionName}`;

          const statsParts: string[] = [];
          if (totalInput) statsParts.push(`↑${formatFooterTokens(totalInput)}`);
          if (totalOutput) statsParts.push(`↓${formatFooterTokens(totalOutput)}`);

          const model = ctx.model;
          const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
          if (totalCost || usingSubscription) {
            statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
          }

          const autoIndicator = autoCompactEnabled ? " (auto)" : "";
          const contextDisplay =
            contextPercent === "?"
              ? `?/${formatFooterTokens(contextWindow)}${autoIndicator}`
              : `${contextPercent}%/${formatFooterTokens(contextWindow)}${autoIndicator}`;
          const contextPart =
            contextPercentValue > 90
              ? theme.fg("error", contextDisplay)
              : contextPercentValue > 70
                ? theme.fg("warning", contextDisplay)
                : contextDisplay;
          statsParts.push(contextPart);

          let statsLeft = statsParts.join(" ");
          let statsLeftWidth = visibleWidth(statsLeft);
          if (statsLeftWidth > width) {
            statsLeft = truncateToWidth(statsLeft, width, "...");
            statsLeftWidth = visibleWidth(statsLeft);
          }

          const modelName = model?.id || "no-model";
          const thinkingLevel = pi.getThinkingLevel();
          const rightWithoutProvider = model?.reasoning
            ? thinkingLevel === "off"
              ? `${modelName} • thinking off`
              : `${modelName} • ${thinkingLevel}`
            : modelName;

          let right = rightWithoutProvider;
          const minimumPadding = 2;
          if (footerData.getAvailableProviderCount() > 1 && model) {
            right = `(${model.provider}) ${rightWithoutProvider}`;
            if (statsLeftWidth + minimumPadding + visibleWidth(right) > width) {
              right = rightWithoutProvider;
            }
          }

          const availableForRight = width - statsLeftWidth - minimumPadding;
          if (statsLeftWidth + minimumPadding + visibleWidth(right) > width) {
            right = availableForRight > 0 ? truncateToWidth(right, availableForRight, "") : "";
          }

          const padding = " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(right)));
          const statsLine = theme.fg("dim", statsLeft) + theme.fg("dim", padding + right);
          const cwdLine = truncateToWidth(theme.fg("dim", cwd), width, theme.fg("dim", "..."));
          const lines = [cwdLine, statsLine];

          const statuses = footerData.getExtensionStatuses();
          if (statuses.size > 0) {
            const statusLine = Array.from(statuses.entries())
              .sort(([left], [rightKey]) => left.localeCompare(rightKey))
              .map(([, text]) => sanitizeStatusText(text))
              .join(" ");
            lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
          }

          return lines;
        },
      };
    });
  });
}
