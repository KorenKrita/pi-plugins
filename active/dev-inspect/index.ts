import type { ExtensionAPI, ExtensionCommandContext, Theme, ToolInfo } from "@earendil-works/pi-coding-agent";
import {
  buildSessionContext,
  convertToLlm,
  formatSkillsForPrompt,
  parseSkillBlock,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Box, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ─── Entry types ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_ENTRY = "dev-inspect.system-prompt";
const TOOL_SCHEMAS_ENTRY = "dev-inspect.tool-schemas";
const CONTEXT_MAP_ENTRY = "dev-inspect.context-map";
const LLM_STATS_ENTRY = "dev-inspect.llm-stats";

// ─── Helpers ────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function countLines(text: string) {
  const t = text.replace(/\n+$/, "");
  return t.length === 0 ? 0 : t.split("\n").length;
}

function shortNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

function safeJson(v: unknown) {
  try { return JSON.stringify(v) ?? "undefined"; } catch { return "[unserializable]"; }
}

function messageText(msg: unknown): string {
  if (!isRecord(msg) || !("content" in msg)) return "";
  const c = (msg as { content?: unknown }).content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.map(b => isRecord(b) && (b as any).type === "text" && typeof (b as any).text === "string" ? (b as any).text : "").join("\n");
}

function contentSize(content: unknown) {
  if (typeof content === "string") return { textChars: content.length, images: 0 };
  if (!Array.isArray(content)) return { textChars: 0, images: 0 };
  let textChars = 0, images = 0;
  for (const b of content) {
    if (!isRecord(b)) continue;
    if ((b as any).type === "text" && typeof (b as any).text === "string") textChars += (b as any).text.length;
    if ((b as any).type === "image") images++;
  }
  return { textChars, images };
}

// ─── /show-sysprompt ────────────────────────────────────────────────────────

function formatToolSchemas(tools: ToolInfo[]): string {
  if (tools.length === 0) return "No active tools.";
  return tools.map(tool => {
    const params = (tool.parameters as any)?.properties;
    const required = new Set<string>(Array.isArray((tool.parameters as any)?.required) ? (tool.parameters as any).required : []);
    const names = params ? Object.keys(params) : [];
    const header = `${tool.name} - ${tool.description}`;
    if (names.length === 0) return `${header}\n  (no parameters)`;
    const lines = names.map(name => {
      const prop = params[name];
      const presence = required.has(name) ? "required" : "optional";
      const desc = prop?.description ? ` - ${prop.description}` : "";
      return `  ${name}: ${prop?.type ?? "any"} [${presence}]${desc}`;
    });
    return `${header}\n${lines.join("\n")}`;
  }).join("\n\n");
}

function registerShowSysprompt(pi: ExtensionAPI) {
  pi.registerEntryRenderer(SYSTEM_PROMPT_ENTRY, (entry, { expanded }, theme) => {
    const content = (entry.data as any)?.content ?? "";
    const lineCount = content.length === 0 ? 0 : content.split("\n").length;
    const header = expanded
      ? `${theme.fg("accent", theme.bold("System prompt"))}${theme.fg("dim", " (Ctrl+o to collapse)")}`
      : `${theme.fg("accent", theme.bold("System prompt"))}${theme.fg("dim", ` (${lineCount} lines, Ctrl+o to expand)`)}`;
    const box = new Box(1, 1, v => theme.bg("customMessageBg", v));
    box.addChild(new Text(expanded ? `${header}\n\n${content}` : header, 0, 0));
    return box;
  });

  pi.registerEntryRenderer(TOOL_SCHEMAS_ENTRY, (entry, { expanded }, theme) => {
    const content = (entry.data as any)?.content ?? "";
    const lineCount = content.length === 0 ? 0 : content.split("\n").length;
    const header = expanded
      ? `${theme.fg("accent", theme.bold("Available tools"))}${theme.fg("dim", " (Ctrl+o to collapse)")}`
      : `${theme.fg("accent", theme.bold("Available tools"))}${theme.fg("dim", ` (${lineCount} lines, Ctrl+o to expand)`)}`;
    const box = new Box(1, 1, v => theme.bg("customMessageBg", v));
    box.addChild(new Text(expanded ? `${header}\n\n${content}` : header, 0, 0));
    return box;
  });

  pi.registerCommand("show-sysprompt", {
    description: "Show the effective system prompt and active tool schemas.",
    async handler(_args, ctx) {
      await ctx.waitForIdle();
      const activeTools = new Set(pi.getActiveTools());
      pi.appendEntry(SYSTEM_PROMPT_ENTRY, { content: ctx.getSystemPrompt() });
      pi.appendEntry(TOOL_SCHEMAS_ENTRY, {
        content: formatToolSchemas(pi.getAllTools().filter(t => activeTools.has(t.name))),
      });
    },
  });
}

// ─── /llm-stats ─────────────────────────────────────────────────────────────

type LlmRow = {
  index: number; delta: string; model: string; start: string;
  fresh: number; cacheRead: number; cacheWrite: number; input: number; output: number;
  stop: string; tools: string;
};

function registerLlmStats(pi: ExtensionAPI) {
  pi.registerEntryRenderer(LLM_STATS_ENTRY, (entry, _s, theme) => {
    const rows: LlmRow[] = Array.isArray((entry.data as any)?.rows) ? (entry.data as any).rows : [];
    const box = new Box(1, 1, v => theme.bg("customMessageBg", v));
    if (rows.length === 0) {
      box.addChild(new Text(theme.fg("accent", theme.bold("LLM stats")) + "\n\nNo assistant messages with usage.", 0, 0));
      return box;
    }
    const showCW = rows.some(r => r.cacheWrite !== 0);
    const pad = (s: string, w: number, right = false) => right ? s.padStart(w) : s.padEnd(w);
    const w = {
      idx: Math.max(1, `${rows.length}`.length),
      delta: Math.max(5, ...rows.map(r => r.delta.length)),
      model: Math.max(5, ...rows.map(r => r.model.length)),
      start: Math.max(5, ...rows.map(r => r.start.length)),
      fresh: Math.max(5, ...rows.map(r => shortNum(r.fresh).length)),
      cr: Math.max(6, ...rows.map(r => shortNum(r.cacheRead).length)),
      cw: Math.max(6, ...rows.map(r => shortNum(r.cacheWrite).length)),
      inp: Math.max(5, ...rows.map(r => shortNum(r.input).length)),
      out: Math.max(6, ...rows.map(r => shortNum(r.output).length)),
      stop: Math.max(4, ...rows.map(r => r.stop.length)),
    };
    const hdr = [pad("#", w.idx, true), pad("delta", w.delta, true), pad("model", w.model),
      pad("start", w.start), pad("fresh", w.fresh, true), "+", pad("cacheR", w.cr, true),
      ...(showCW ? ["+", pad("cacheW", w.cw, true)] : []), "=",
      pad("input", w.inp, true), pad("output", w.out, true), pad("stop", w.stop), "tools"].join("  ");
    const body = rows.map(r => [
      pad(`${r.index}`, w.idx, true), pad(r.delta, w.delta, true), pad(r.model, w.model),
      pad(r.start, w.start), pad(shortNum(r.fresh), w.fresh, true), "+", pad(shortNum(r.cacheRead), w.cr, true),
      ...(showCW ? ["+", pad(shortNum(r.cacheWrite), w.cw, true)] : []), "=",
      pad(shortNum(r.input), w.inp, true), pad(shortNum(r.output), w.out, true), pad(r.stop, w.stop), r.tools,
    ].join("  ")).join("\n");
    box.addChild(new Text(`${theme.fg("accent", theme.bold("LLM stats"))}\n\n${hdr}\n${body}`, 0, 0));
    return box;
  });

  pi.registerCommand("llm-stats", {
    description: "Show per-call token usage for assistant responses in the current branch.",
    async handler(_args, ctx) {
      await ctx.waitForIdle();
      let lastTs: number | undefined;
      const rows: LlmRow[] = [];
      let prevMsg: unknown;
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (!isRecord(msg)) continue;
        const isAst = msg.role === "assistant";
        const ts = isAst && typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : undefined;
        if (!isAst || !isRecord(msg.usage)) { if (isAst) lastTs = ts; prevMsg = msg; continue; }
        const u = msg.usage as any;
        const fresh = typeof u.input === "number" ? u.input : 0;
        const cacheRead = typeof u.cacheRead === "number" ? u.cacheRead : 0;
        const cacheWrite = typeof u.cacheWrite === "number" ? u.cacheWrite : 0;
        const output = typeof u.output === "number" ? u.output : 0;
        const delta = ts && lastTs ? `+${Math.max(0, Math.round((ts - lastTs) / 1000))}s`
          : ts ? new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
        const initiator = isRecord(prevMsg) ? ((prevMsg as any).role === "user" ? "user" : (prevMsg as any).role === "toolResult" ? "tools" : "other") : "other";
        const toolNames = Array.isArray(msg.content)
          ? (msg.content as any[]).filter(b => isRecord(b) && (b as any).type === "toolCall" && typeof (b as any).name === "string").map(b => (b as any).name).join(",") || "-"
          : "-";
        rows.push({
          index: rows.length + 1, delta,
          model: `${typeof msg.provider === "string" ? msg.provider : "?"}/${typeof msg.model === "string" ? msg.model : "?"}`,
          start: initiator, fresh, cacheRead, cacheWrite, input: fresh + cacheRead + cacheWrite, output,
          stop: typeof msg.stopReason === "string" ? msg.stopReason : "-", tools: toolNames,
        });
        lastTs = ts; prevMsg = msg;
      }
      pi.appendEntry(LLM_STATS_ENTRY, { rows });
    },
  });
}

// ─── /show-context ──────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;
const ESTIMATED_IMAGE_CHARS = 4800;
const LINES_PER_CELL = 10;
const BRAILLE_BASE = 0x2800;
const LEFT_DOTS = [0, 64, 68, 70, 71] as const;
const RIGHT_DOTS = [0, 128, 160, 176, 184] as const;

type TokenRowId = "system-base" | "startup-context" | "advertised-skills" | "tool-definitions" |
  "user-messages" | "loaded-skills" | "assistant-text" | "assistant-thinking" |
  "tool-calls" | "tool-results" | "compactions" | "branch-summaries" | "bash-executions" | "custom-messages" | "media";

const TOKEN_ROWS: { id: TokenRowId; section: "prefix" | "messages"; label: string; unit: string }[] = [
  { id: "system-base", section: "prefix", label: "System prompt · base", unit: "section" },
  { id: "startup-context", section: "prefix", label: "Startup context files", unit: "file" },
  { id: "advertised-skills", section: "prefix", label: "Advertised skills", unit: "skill" },
  { id: "tool-definitions", section: "prefix", label: "Tool definitions", unit: "tool" },
  { id: "user-messages", section: "messages", label: "User messages", unit: "message" },
  { id: "loaded-skills", section: "messages", label: "Loaded skill bodies", unit: "skill" },
  { id: "assistant-text", section: "messages", label: "Assistant text", unit: "block" },
  { id: "assistant-thinking", section: "messages", label: "Assistant thinking", unit: "block" },
  { id: "tool-calls", section: "messages", label: "Tool calls", unit: "call" },
  { id: "tool-results", section: "messages", label: "Tool results", unit: "result" },
  { id: "compactions", section: "messages", label: "Compactions", unit: "summary" },
  { id: "branch-summaries", section: "messages", label: "Branch summaries", unit: "summary" },
  { id: "bash-executions", section: "messages", label: "User shell runs", unit: "run" },
  { id: "custom-messages", section: "messages", label: "Custom messages", unit: "message" },
  { id: "media", section: "messages", label: "Images / media", unit: "image" },
];

type EvidenceKind = "startup-context" | "advertised-skill" | "loaded-skill-body" | "tool-read";
type FileEvidence = {
  path: string; displayPath: string; totalLines: number; missing: boolean;
  sources: { kind: EvidenceKind; range: { startLine: number; endLine: number }; ordinal: number; media?: boolean }[];
  order: number;
};
type ToolTokenBreakdown = { toolName: string; tokens: number; count: number };
type TokenBreakdownRow = { id: TokenRowId; section: "prefix" | "messages"; label: string; tokens: number; count: number; unit: string; tools?: ToolTokenBreakdown[] };
type ContextTokenBreakdown = { estimatedTokens: number; contextWindow: number | null; piTokens: number | null; rows: TokenBreakdownRow[] };
type ContextMapData = { linesPerCell: number; tokens?: ContextTokenBreakdown; files: FileEvidence[] };

function normPath(cwd: string, p: string) { return isAbsolute(p) ? resolve(p) : resolve(cwd, p); }
function dispPath(cwd: string, p: string) { const r = relative(cwd, p); return (!r || r.startsWith("..") || isAbsolute(r)) ? p : r; }

function collectTokens(pi: ExtensionAPI, ctx: ExtensionCommandContext, messages: any[]): ContextTokenBreakdown {
  const totals = new Map<TokenRowId, { chars: number; count: number }>();
  const toolCallTotals = new Map<string, { chars: number; count: number }>();
  const toolResultTotals = new Map<string, { chars: number; count: number }>();
  for (const d of TOKEN_ROWS) totals.set(d.id, { chars: 0, count: 0 });
  const add = (id: TokenRowId, chars: number, count = 0) => { const t = totals.get(id); if (t) { t.chars += Math.max(0, chars); t.count += count; } };

  const opts = ctx.getSystemPromptOptions();
  const sp = ctx.getSystemPrompt();
  const ctxSection = contextFilesSection(opts.contextFiles ?? []);
  const skillsSection = formatSkillsForPrompt(opts.skills ?? []);
  let baseChars = sp.length;
  if (ctxSection && sp.includes(ctxSection)) { baseChars -= ctxSection.length; add("startup-context", ctxSection.length, opts.contextFiles?.length ?? 0); }
  if (skillsSection && sp.includes(skillsSection)) { baseChars -= skillsSection.length; add("advertised-skills", skillsSection.length, (opts.skills ?? []).filter((s: any) => !s.disableModelInvocation).length); }
  add("system-base", baseChars, baseChars > 0 ? 1 : 0);

  const activeTools = new Set(pi.getActiveTools());
  const tools = pi.getAllTools().filter(t => activeTools.has(t.name)).map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
  add("tool-definitions", tools.length > 0 ? safeJson(tools).length : 0, tools.length);

  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    if (msg.role === "user") {
      const { textChars, images } = contentSize(msg.content);
      const sb = parseSkillBlock(messageText(msg));
      if (sb) { const uc = Math.min(textChars, sb.userMessage?.length ?? 0); add("loaded-skills", textChars - uc, 1); if (uc > 0) add("user-messages", uc, 1); }
      else add("user-messages", textChars, 1);
      add("media", images * ESTIMATED_IMAGE_CHARS, images);
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const b of msg.content as any[]) {
        if (!isRecord(b)) continue;
        if (b.type === "text" && typeof b.text === "string") add("assistant-text", (b.text as string).length, 1);
        if (b.type === "thinking" && typeof b.thinking === "string") add("assistant-thinking", (b.thinking as string).length, 1);
        if (b.type === "toolCall") { const n = typeof b.name === "string" ? b.name : "unknown"; const c = n.length + safeJson(b.arguments).length; add("tool-calls", c, 1); const t = toolCallTotals.get(n) ?? { chars: 0, count: 0 }; t.chars += c; t.count++; toolCallTotals.set(n, t); }
      }
    } else if (msg.role === "toolResult") {
      const { textChars, images } = contentSize(msg.content);
      add("tool-results", textChars, 1);
      const tn = typeof msg.toolName === "string" ? msg.toolName : "unknown"; const t = toolResultTotals.get(tn) ?? { chars: 0, count: 0 }; t.chars += textChars; t.count++; toolResultTotals.set(tn, t);
      add("media", images * ESTIMATED_IMAGE_CHARS, images);
    } else if (msg.role === "compactionSummary") { add("compactions", convertedChars(msg), 1); }
    else if (msg.role === "branchSummary") { add("branch-summaries", convertedChars(msg), 1); }
    else if (msg.role === "bashExecution" && !(msg as any).excludeFromContext) { add("bash-executions", convertedChars(msg), 1); }
    else if (msg.role === "custom") { const { textChars, images } = contentSize(msg.content); add("custom-messages", textChars, 1); add("media", images * ESTIMATED_IMAGE_CHARS, images); }
  }

  const splitTools = (m: Map<string, { chars: number; count: number }>, catTokens: number): ToolTokenBreakdown[] => {
    const entries = [...m.entries()].sort((a, b) => b[1].chars - a[1].chars);
    const totalC = entries.reduce((s, [, t]) => s + t.chars, 0);
    let cum = 0, alloc = 0;
    return entries.map(([name, t], i) => { cum += t.chars; const boundary = totalC === 0 ? 0 : i === entries.length - 1 ? catTokens : Math.round((cum / totalC) * catTokens); const tk = Math.max(0, boundary - alloc); alloc = boundary; return { toolName: name, tokens: tk, count: t.count }; });
  };

  const rows = TOKEN_ROWS.map(d => {
    const t = totals.get(d.id) ?? { chars: 0, count: 0 };
    const tokens = Math.ceil(t.chars / CHARS_PER_TOKEN);
    const tools = d.id === "tool-calls" ? splitTools(toolCallTotals, tokens) : d.id === "tool-results" ? splitTools(toolResultTotals, tokens) : undefined;
    return { ...d, tokens, count: t.count, ...(tools && tools.length > 0 ? { tools } : {}) };
  });
  const usage = ctx.getContextUsage();
  return { estimatedTokens: rows.reduce((s, r) => s + r.tokens, 0), contextWindow: usage?.contextWindow ?? (ctx as any).model?.contextWindow ?? null, piTokens: usage?.tokens ?? null, rows };
}

function convertedChars(msg: unknown) { return convertToLlm([msg] as any).reduce((s, i) => s + contentSize(i.content).textChars, 0); }

function contextFilesSection(files: { path: string; content: string }[]) {
  if (files.length === 0) return "";
  let s = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
  for (const f of files) s += `<project_instructions path="${f.path}">\n${f.content}\n</project_instructions>\n\n`;
  return `${s}</project_context>\n`;
}

function collectFileMap(pi: ExtensionAPI, ctx: ExtensionCommandContext): ContextMapData {
  const cwd = ctx.cwd;
  const files = new Map<string, FileEvidence>();
  let ordinal = 0, order = 0;

  const getFile = (path: string, fallbackLines: number, totalOverride?: number) => {
    const norm = normPath(cwd, path);
    const existing = files.get(norm);
    if (existing) return existing;
    const totalLines = totalOverride !== undefined ? Math.max(1, totalOverride) : existsSync(norm) ? Math.max(1, countLines(readFileSync(norm, "utf8"))) : Math.max(1, fallbackLines);
    const missing = !existsSync(norm);
    const f: FileEvidence = { path: norm, displayPath: dispPath(cwd, norm), totalLines, missing, sources: [], order: order++ };
    files.set(norm, f);
    return f;
  };
  const addEv = (path: string, kind: EvidenceKind, startLine: number, endLine: number, media?: boolean, totalOverride?: number) => {
    const f = getFile(path, endLine, totalOverride);
    f.sources.push({ kind, range: { startLine, endLine }, ordinal: ordinal++, ...(media ? { media } : {}) });
  };

  const opts = ctx.getSystemPromptOptions();
  for (const cf of opts.contextFiles ?? []) addEv(cf.path, "startup-context", 1, Math.max(1, countLines(cf.content)));

  const skillRangesCache = new Map<string, { body: { startLine: number; endLine: number } }>();
  const getSkillBody = (path: string) => {
    const cached = skillRangesCache.get(path);
    if (cached) return cached.body;
    if (!existsSync(path)) { const r = { body: { startLine: 1, endLine: 1 } }; skillRangesCache.set(path, r); return r.body; }
    const lines = readFileSync(path, "utf8").split("\n");
    if (lines[0]?.trim() !== "---") { const r = { body: { startLine: 1, endLine: Math.max(1, lines.length) } }; skillRangesCache.set(path, r); return r.body; }
    const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    const bodyStart = endIdx === -1 ? 1 : Math.min(lines.length, endIdx + 2);
    const r = { body: { startLine: bodyStart, endLine: Math.max(bodyStart, lines.length) } };
    skillRangesCache.set(path, r);
    return r.body;
  };

  for (const skill of (opts.skills ?? []).filter((s: any) => !s.disableModelInvocation)) {
    const norm = normPath(cwd, skill.filePath);
    if (!existsSync(norm)) continue;
    const lines = readFileSync(norm, "utf8").split("\n");
    const endIdx = lines[0]?.trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") : -1;
    addEv(skill.filePath, "advertised-skill", 1, endIdx === -1 ? 1 : endIdx + 1);
  }

  const readCalls = new Map<string, { path: string; offset?: number; limit?: number }>();
  const messages = buildSessionContext(ctx.sessionManager.getEntries() as SessionEntry[], ctx.sessionManager.getLeafId()).messages;
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const b of msg.content as any[]) {
        if (isRecord(b) && b.type === "toolCall" && b.name === "read" && typeof b.id === "string" && isRecord(b.arguments) && typeof (b.arguments as any).path === "string") {
          const args = b.arguments as any;
          readCalls.set(b.id as string, { path: args.path, ...(typeof args.offset === "number" ? { offset: args.offset } : {}), ...(typeof args.limit === "number" ? { limit: args.limit } : {}) });
        }
      }
    }
    if (msg.role === "toolResult" && msg.toolName === "read" && typeof msg.toolCallId === "string" && !msg.isError) {
      const call = readCalls.get(msg.toolCallId as string);
      if (!call) continue;
      const hasMedia = Array.isArray(msg.content) && (msg.content as any[]).some(b => isRecord(b) && (b as any).type === "image");
      if (hasMedia) { addEv(call.path, "tool-read", 1, 10, true, 1); continue; }
      const startLine = Math.max(1, call.offset ?? 1);
      let lc = countLines(messageText(msg));
      if (typeof call.limit === "number") lc = Math.min(lc, call.limit);
      if (lc > 0) addEv(call.path, "tool-read", startLine, startLine + lc - 1);
    }
    if (msg.role === "user") {
      const sb = parseSkillBlock(messageText(msg));
      if (sb && !sb.location.includes("${")) {
        const body = getSkillBody(sb.location);
        addEv(sb.location, "loaded-skill-body", body.startLine, body.endLine);
      }
    }
  }

  const sorted = [...files.values()].sort((a, b) => {
    const group = (f: FileEvidence) => f.sources.some(s => s.kind === "startup-context") ? 0 : f.sources.some(s => s.kind === "advertised-skill") ? 1 : 2;
    const gd = group(a) - group(b);
    if (gd !== 0) return gd;
    if (group(a) < 2) return a.order - b.order;
    return Math.max(...b.sources.map(s => s.ordinal)) - Math.max(...a.sources.map(s => s.ordinal)) || a.displayPath.localeCompare(b.displayPath);
  });
  return { linesPerCell: LINES_PER_CELL, tokens: collectTokens(pi, ctx, messages), files: sorted };
}

function osc8(text: string, url: string) { return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`; }
function fileUrl(path: string, startLine?: number) {
  const { TERM_PROGRAM } = process.env;
  if (TERM_PROGRAM === "vscode" && startLine !== undefined) return `vscode://file${path}:${startLine}:1`;
  const frag = startLine === undefined ? "" : `#L${startLine}`;
  return `${pathToFileURL(path).href}${frag}`;
}

function tokenRowColor(id: TokenRowId, text: string, theme: Theme) {
  const map: Record<string, string> = {
    "system-base": "borderAccent", "startup-context": "accent", "advertised-skills": "warning",
    "tool-definitions": "toolTitle", "user-messages": "success", "loaded-skills": "mdLink",
    "assistant-text": "toolOutput", "assistant-thinking": "muted", "tool-calls": "syntaxFunction",
    "tool-results": "syntaxString", "compactions": "error", "branch-summaries": "syntaxType",
    "bash-executions": "bashMode", "custom-messages": "customMessageLabel", "media": "mdLinkUrl",
  };
  return theme.fg(map[id] ?? "dim", text);
}

function renderContextMap(data: ContextMapData, width: number, theme: Theme): string {
  const lines: string[] = [];
  // Token breakdown
  if (data.tokens) {
    const t = data.tokens;
    const pct = t.contextWindow ? (t.estimatedTokens / t.contextWindow * 100).toFixed(1) : undefined;
    const cap = t.contextWindow ? ` / ${shortNum(t.contextWindow)} (${pct}%)` : "";
    const meter = t.piTokens === null ? "Pi meter unavailable" : `Pi meter ${shortNum(t.piTokens)}${t.contextWindow ? ` (${(t.piTokens / t.contextWindow * 100).toFixed(1)}%)` : ""}`;
    lines.push(...wrapTextWithAnsi(`${theme.fg("accent", theme.bold("Context token breakdown"))}  ≈${shortNum(t.estimatedTokens)}${cap} · ${meter}`, width));
    lines.push(...wrapTextWithAnsi(theme.fg("dim", "Estimated as chars ÷ 4 · each image ≈1.2k · provider framing excluded"), width));
    // bar
    const barW = Math.max(1, width - 2);
    const total = t.contextWindow ?? t.estimatedTokens;
    let cum = 0, used = 0;
    const segs = t.rows.map(r => { cum += r.tokens; const boundary = Math.min(barW, Math.round((cum / total) * barW)); const cells = Math.max(0, boundary - used); used = boundary; return tokenRowColor(r.id, "█".repeat(cells), theme); }).join("");
    lines.push(`[${segs}${theme.fg("dim", "░".repeat(Math.max(0, barW - used)))}]`, "");
    for (const section of ["prefix", "messages"] as const) {
      const sRows = t.rows.filter(r => r.section === section);
      const sTokens = sRows.reduce((s, r) => s + r.tokens, 0);
      lines.push(`${theme.bold(section === "prefix" ? "Prompt prefix" : "Effective messages")} ${theme.fg("dim", `≈${shortNum(sTokens)}`)}`);
      for (const r of sRows) {
        const p = t.estimatedTokens === 0 ? 0 : (r.tokens / t.estimatedTokens * 100);
        lines.push(`  ${tokenRowColor(r.id, "■", theme)} ${r.label.padEnd(23)} ≈${shortNum(r.tokens).padStart(7)} ${`${p.toFixed(1)}%`.padStart(6)} ${theme.fg("dim", `${r.count} ${r.unit}${r.count === 1 ? "" : "s"}`.padStart(13))}`);
        for (const [ti, tool] of (r.tools ?? []).entries()) {
          const tp = t.estimatedTokens === 0 ? 0 : (tool.tokens / t.estimatedTokens * 100);
          const branch = ti === (r.tools!.length - 1) ? "└──" : "├──";
          lines.push(`    ${branch} ${tool.toolName.slice(0, 19).padEnd(19)} ${theme.fg("dim", `≈${shortNum(tool.tokens).padStart(7)} ${`${tp.toFixed(1)}%`.padStart(6)} ${`${tool.count} ${r.unit}${tool.count === 1 ? "" : "s"}`.padStart(13)}`)}`);
        }
      }
      lines.push("");
    }
  }
  // File map
  if (data.files.length === 0) { lines.push("No file-backed context evidence."); return lines.join("\n"); }
  const maxOrd = Math.max(0, ...data.files.flatMap(f => f.sources.map(s => s.ordinal)));
  lines.push(`${theme.fg("accent", theme.bold("Context read map"))} One cell = ${data.linesPerCell} lines · ${data.files.length} files total`);
  lines.push(`${theme.fg("dim", "Read count:")}  ${theme.fg("dim", "⣀")} 1  ${theme.fg("dim", "⣤")} 2  ${theme.fg("dim", "⣶")} 3  ${theme.fg("dim", "⣿")} 4+`);
  lines.push(`${theme.fg("dim", "Type:")} ${theme.fg("borderAccent", "system prompt")}  ${theme.fg("accent", "skill loaded")} Read tool: [ ${theme.fg("warning", "recent")} / ${theme.fg("toolTitle", "mid")} / ${theme.fg("dim", "old")} ]`, "");

  const wide = width >= 100;
  const pathW = 50;
  for (const file of data.files) {
    const cellCount = Math.max(1, Math.ceil(file.totalLines / LINES_PER_CELL));
    const cells: string[] = [];
    for (let i = 0; i < cellCount; i++) {
      const start = i * LINES_PER_CELL + 1, mid = Math.min(file.totalLines, start + LINES_PER_CELL / 2 - 1), end = Math.min(file.totalLines, start + LINES_PER_CELL - 1);
      const overlapping = file.sources.filter(s => s.range.startLine <= end && s.range.endLine >= start);
      if (overlapping.length === 0) { cells.push(theme.bg("selectedBg", theme.fg("dim", " "))); continue; }
      const mediaCount = overlapping.filter(s => s.media).length;
      const lc = mediaCount + overlapping.filter(s => !s.media && s.range.startLine <= mid && s.range.endLine >= start).length;
      const rc = mediaCount + overlapping.filter(s => !s.media && s.range.startLine <= end && s.range.endLine > mid).length;
      const glyph = String.fromCodePoint(BRAILLE_BASE + (LEFT_DOTS[Math.min(lc, 4)] ?? 0) + (RIGHT_DOTS[Math.min(rc, 4)] ?? 0));
      const strongest = overlapping.reduce((best, s) => { const pd = (s.kind === "tool-read" ? 3 : s.kind === "loaded-skill-body" ? 2 : 1) - (best.kind === "tool-read" ? 3 : best.kind === "loaded-skill-body" ? 2 : 1); return pd > 0 ? s : pd < 0 ? best : s.ordinal > best.ordinal ? s : best; });
      const color = strongest.kind === "startup-context" || strongest.kind === "advertised-skill" ? "borderAccent" : strongest.kind === "loaded-skill-body" ? "accent" : maxOrd <= 0 ? "toolOutput" : strongest.ordinal / maxOrd > 0.66 ? "warning" : strongest.ordinal / maxOrd > 0.33 ? "toolTitle" : "dim";
      cells.push(osc8(theme.bg("selectedBg", theme.fg(color, glyph)), fileUrl(file.path, start)));
    }
    const barWidth = Math.max(1, (wide ? width - pathW - 3 : width - 2));
    const wrapped: string[] = [];
    for (let i = 0; i < cells.length; i += barWidth) {
      const isFirst = i === 0, isLast = i + barWidth >= cells.length;
      wrapped.push(`${isFirst ? "[" : "↳"}${cells.slice(i, i + barWidth).join("")}${isLast ? "]" : "↴"}`);
    }
    if (wrapped.length === 0) wrapped.push("[]");
    const dp = file.displayPath.length <= pathW ? file.displayPath : `${file.displayPath.slice(0, 23)}…/…${file.displayPath.slice(-22)}`;
    if (wide) {
      const name = file.missing ? theme.fg("warning", dp) : dp;
      lines.push(`${" ".repeat(Math.max(0, pathW - dp.length))}${osc8(name, fileUrl(file.path))} ${wrapped[0]}`);
      for (const chunk of wrapped.slice(1)) lines.push(`${" ".repeat(pathW)} ${chunk}`);
    } else {
      lines.push(file.missing ? theme.fg("warning", osc8(dp, fileUrl(file.path))) : osc8(dp, fileUrl(file.path)));
      for (const chunk of wrapped) lines.push(chunk);
    }
  }
  return lines.join("\n");
}

function registerShowContext(pi: ExtensionAPI) {
  pi.registerEntryRenderer<ContextMapData>(CONTEXT_MAP_ENTRY, (entry, _opts, theme) => {
    const data = entry.data;
    const box = new Box(1, 1);
    if (data && Array.isArray((data as any).files) && typeof (data as any).linesPerCell === "number") {
      box.addChild({ render: w => renderContextMap(data as ContextMapData, w, theme).split("\n"), invalidate() {} });
    } else {
      box.addChild(new Text("Invalid context map data.", 0, 0));
    }
    return box;
  });

  pi.registerCommand("show-context", {
    description: "Show token and file coverage breakdowns for the current model context.",
    async handler(_args, ctx) {
      await ctx.waitForIdle();
      pi.appendEntry(CONTEXT_MAP_ENTRY, collectFileMap(pi, ctx));
    },
  });
}

// ─── Extension entry point ──────────────────────────────────────────────────

export default function devInspectExtension(pi: ExtensionAPI) {
  registerShowSysprompt(pi);
  registerLlmStats(pi);
  registerShowContext(pi);
}
