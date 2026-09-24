import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface TokenStatsData {
  text: string;
}

// ── TPS gate constants (aligned with @monotykamary/pi-tps 1.3.3) ─────────────
const STALL_THRESHOLD_MS = 500; // min inter-update gap counted as an inference stall
const MIN_STREAM_MS = 1;
const MIN_STREAM_UPDATES = 5;
const MIN_INTER_CHUNK_MS = 1;
const MIN_GENERATION_MS = 200;
const ACTIVE_TIME_THRESHOLD_MS = 200;
const STALL_REDUCTION_DENOM = 2;
const STALL_DOMINANCE_RATIO = 0.85;
// 5× the fastest known commercial inference (~2k tok/s Cerebras). Beyond this
// the measurement is certainly a buffer-flush/dispatch artifact.
const MAX_PLAUSIBLE_TPS = 10_000;

interface ModelInfo {
  provider: string;
  modelId: string;
}

export default function (pi: ExtensionAPI) {
  // ── per-turn state (reset on turn_start) ──
  let turnStart = 0;
  let lastUpdateAt = 0; // stall clock; re-seeded on message_start / message_end
  let firstTokenAt: number | null = null; // TTFT, captured once per turn
  let msgStart: number | null = null;
  let generationMs = 0; // message_start → message_end, summed
  let updateCount = 0; // streaming updates AFTER the TTFT one
  let firstStreamAt: number | null = null; // first non-TTFT update
  let lastStreamAt = 0;
  let stallMs = 0;
  let stallCount = 0;
  let inStall = false;
  let toolCount = 0;
  let isToolCall = false;
  // usage aggregates
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalTokens = 0;
  let cost = 0;
  let reasoning = 0;
  let hasReasoning = false;
  let hasUsage = false;
  let model: ModelInfo | null = null;
  let stopReason: string | null = null;

  // Per-model TPS cap: highest reliable (primary-branch) TPS observed for
  // "provider:modelId". Tool-call turns get clamped to it — their short
  // outputs over tiny windows inflate easily. In-memory only, like pi-tps.
  const tpsCaps = new Map<string, number>();

  pi.registerEntryRenderer<TokenStatsData>("token-stats", (entry, _options, theme) => {
    const data = entry.data ?? { text: "" };
    return new Text(theme.fg("dim", data.text), 1, 0);
  });

  pi.on("turn_start", async () => {
    const now = performance.now();
    turnStart = now;
    lastUpdateAt = now;
    firstTokenAt = null;
    msgStart = null;
    generationMs = 0;
    updateCount = 0;
    firstStreamAt = null;
    lastStreamAt = 0;
    stallMs = 0;
    stallCount = 0;
    inStall = false;
    toolCount = 0;
    isToolCall = false;
    input = 0;
    output = 0;
    cacheRead = 0;
    cacheWrite = 0;
    totalTokens = 0;
    cost = 0;
    reasoning = 0;
    hasReasoning = false;
    hasUsage = false;
    model = null;
    stopReason = null;
  });

  pi.on("message_start", async (event) => {
    if (event.message.role !== "assistant") return;
    const now = performance.now();
    msgStart = now;
    // Reset the stall clock so tool-execution gaps before this message are
    // never counted as inference stalls.
    lastUpdateAt = now;
    inStall = false;
  });

  pi.on("message_update", async (event) => {
    if (turnStart === 0) return;
    if (event.message.role !== "assistant") return;
    const now = performance.now();

    // First update of the turn = first real token → TTFT. Seed the stall clock
    // and bail: the gap from message_start is provider parsing overhead, and
    // this update is not part of the inter-update streaming span.
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
      stallMs += gap; // full gap counts; threshold is a detection gate, not a discount
    } else {
      inStall = false;
    }
    lastUpdateAt = now;
  });

  pi.on("tool_execution_start", async () => {
    isToolCall = true;
  });

  pi.on("tool_execution_end", async () => {
    toolCount++;
  });

  pi.on("message_end", async (event) => {
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
    hasUsage = true;
    input += usage.input ?? 0;
    output += usage.output ?? 0;
    cacheRead += usage.cacheRead ?? 0;
    cacheWrite += usage.cacheWrite ?? 0;
    totalTokens += usage.totalTokens ?? 0;
    cost += usage.cost?.total ?? 0;
    if (typeof usage.reasoning === "number") {
      reasoning += usage.reasoning;
      hasReasoning = true;
    }
  });

  pi.on("turn_end", async () => {
    if (turnStart === 0) return;
    const ts = turnStart;
    turnStart = 0;

    // pi-tps null conditions: no usage, no output, no first token, no model.
    if (!hasUsage || output <= 0 || firstTokenAt === null || !model) return;

    const totalMs = performance.now() - ts;
    const ttftMs = firstTokenAt - ts;
    const streamMs = updateCount > 0 && firstStreamAt !== null ? lastStreamAt - firstStreamAt : null;

    const { tps: measured, isPrimary } = computeTps(output, streamMs, generationMs, stallMs, updateCount);
    const tps = applyModelCap(
      tpsCaps,
      `${model.provider}:${model.modelId}`,
      measured,
      isPrimary,
      isToolCall,
    );

    const parts: string[] = [];
    if (stopReason === "length" || stopReason === "error" || stopReason === "aborted") {
      parts.push(stopReason.toUpperCase());
    }
    parts.push(`IN ${fmtTokens(input)}`);
    parts.push(`OUT ${fmtTokens(output)}`);
    if (hasReasoning && reasoning > 0) parts.push(`THINK ${fmtTokens(reasoning)}`);
    if (cacheRead + cacheWrite > 0) {
      const totalIn = cacheRead + input + cacheWrite;
      const hitRate = totalIn > 0 ? Math.round((cacheRead / totalIn) * 100) : 0;
      parts.push(`HIT ${fmtTokens(cacheRead)} (${hitRate}%)`);
      parts.push(`MISS ${fmtTokens(cacheWrite)}`);
    }
    if (toolCount > 0) parts.push(`TOOLS ${toolCount}`);
    parts.push(`TTFT ${fmtDuration(ttftMs)}`);
    parts.push(fmtDuration(totalMs));
    if (tps !== null) parts.push(`${isPrimary ? "" : "~"}${tps.toFixed(1)} t/s`);
    else parts.push("— t/s");
    if (stallMs > 0) parts.push(`stall ${fmtDuration(stallMs)}×${stallCount}`);
    if (cost > 0) {
      parts.push(fmtCost(cost));
      const rate = computeRateUsdPerM(cost, totalTokens);
      if (rate !== null) parts.push(`$${rate.toFixed(2)}/M`);
    }

    pi.appendEntry<TokenStatsData>("token-stats", { text: parts.join(" │ ") });
  });
}

/**
 * Three-branch TPS gate, aligned with pi-tps buildTelemetry():
 * - Primary: ≥5 non-TTFT updates, avg inter-chunk gap ≥1ms, effective stream
 *   window (streamMs − stalls) ≥200ms and stall-free-majority → pure
 *   generation speed over the streaming window minus stalls.
 * - Fallback: ≥2 updates and generation window ≥200ms → full generation
 *   window minus stalls (includes TTFT, underestimates by design); when
 *   stalls dominate, only half the stall time is subtracted and the window
 *   is floored at 200ms.
 * - Null: burst delivery / degenerate timing → structurally unidentifiable.
 * Anything above MAX_PLAUSIBLE_TPS is nulled as a measurement artifact.
 */
export function computeTps(
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

/**
 * Dynamic per-model TPS cap (pi-tps parity): primary-branch measurements
 * raise the cap first; tool-call turns are then clamped to it, or nulled
 * when the model has no reliable measurement yet.
 */
export function applyModelCap(
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
    return cap !== undefined ? Math.min(tps, cap) : null;
  }
  return tps;
}

/** Blended $/M-tokens rate: costUsd / (totalTokens / 1e6), 2-decimal rounded. */
export function computeRateUsdPerM(costUsd: number, totalTokens: number): number | null {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return null;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  const rate = costUsd / (totalTokens / 1_000_000);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return Math.round(rate * 100) / 100;
}

/** 567 → "567", 1234 → "1.2k", 2000 → "2k", 1_500_000 → "1.5M" */
export function fmtTokens(n: number): string {
  const scaled = (v: number, suffix: string) => {
    const s = v.toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}${suffix}`;
  };
  if (n >= 1e9) return scaled(n / 1e9, "B");
  if (n >= 1e6) return scaled(n / 1e6, "M");
  if (n >= 1e3) return scaled(n / 1e3, "k");
  return `${n}`;
}

/** <60s → "2.3s"; <60m → "1m 30s"; else → "2h 15m" */
export function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtCost(n: number): string {
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
