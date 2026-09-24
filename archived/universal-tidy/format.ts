import { homedir } from "node:os";

export interface ToolContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

const TARGET_KEYS = [
  "path",
  "file",
  "command",
  "query",
  "url",
  "pattern",
  "action",
  "name",
] as const;

const COUNT_KEYS: Array<{ key: string; noun: string }> = [
  { key: "totalResults", noun: "result" },
  { key: "resultCount", noun: "result" },
  { key: "matches", noun: "match" },
  { key: "matchCount", noun: "match" },
  { key: "files", noun: "file" },
  { key: "fileCount", noun: "file" },
  { key: "items", noun: "item" },
  { key: "itemCount", noun: "item" },
  { key: "count", noun: "result" },
];

const SECRET_KEY = /(?:secret|token|password|passwd|api.?key|authorization|cookie)/i;
const HASHLINE_PREFIX = /^[A-Za-z0-9_-]{2,4}│/;
const HOME = homedir();

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHashlinePrefix(value: string): string {
  return value.replace(HASHLINE_PREFIX, "");
}

export function shortPath(value: string): string {
  if (!value) return "";
  return value === HOME || value.startsWith(`${HOME}/`) ? `~${value.slice(HOME.length)}` : value;
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string") return compactWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const primitives = value
      .slice(0, 3)
      .map(displayValue)
      .filter((item): item is string => Boolean(item));
    if (primitives.length > 0) {
      return primitives.join(", ") + (value.length > primitives.length ? ` +${value.length - primitives.length}` : "");
    }
  }
  return undefined;
}

function argsRecord(args: unknown): Record<string, unknown> | undefined {
  return args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : undefined;
}

export function summarizeReasoning(args: unknown): string {
  const record = argsRecord(args);
  return typeof record?.reasoning === "string" ? compactWhitespace(record.reasoning) : "";
}

export function summarizeTarget(args: unknown, toolName = ""): string {
  const record = argsRecord(args);
  if (!record) return "";

  if (/grep|find|search/i.test(toolName) && typeof record.pattern === "string") {
    const pattern = compactWhitespace(record.pattern);
    const path = typeof record.path === "string" ? shortPath(compactWhitespace(record.path)) : "";
    return path ? `“${pattern}” in ${path}` : `“${pattern}”`;
  }

  for (const key of TARGET_KEYS) {
    const value = displayValue(record[key]);
    if (!value) continue;
    return key === "path" || key === "file" ? shortPath(value) : value;
  }

  for (const [key, rawValue] of Object.entries(record)) {
    if (SECRET_KEY.test(key) || key === "reasoning" || key === "description") continue;
    const value = displayValue(rawValue);
    if (value) return `${key}=${value}`;
  }

  return "";
}

export function secondaryDetail(toolName: string, args: unknown, hasReasoning: boolean): string {
  const record = argsRecord(args);
  if (!record) return "";
  if (hasReasoning) return summarizeTarget(args, toolName);

  const parts: string[] = [];
  if (typeof record.offset === "number") parts.push(`from line ${record.offset}`);
  if (typeof record.limit === "number") parts.push(`limit ${record.limit}`);
  if (typeof record.numResults === "number") parts.push(`limit ${record.numResults}`);
  return parts.join(" · ");
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as ToolContentBlock[])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

function countSummary(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const record = details as Record<string, unknown>;
  for (const { key, noun } of COUNT_KEYS) {
    const value = record[key];
    const count = typeof value === "number"
      ? value
      : Array.isArray(value)
        ? value.length
        : undefined;
    if (count === undefined || !Number.isFinite(count)) continue;
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }
  return undefined;
}

function diffSummary(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const diff = (details as { diff?: unknown }).diff;
  if (typeof diff !== "string" || !diff.trim()) return undefined;
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return `+${additions}/-${deletions}`;
}

export function summarizeResult(
  content: unknown,
  isError = false,
  details?: unknown,
  toolName = "",
  args?: unknown,
  ): string {
  const text = textFromContent(content);
  const cleanLines = text
    .split(/\r?\n/)
    .map(stripHashlinePrefix)
    .filter((line) => line.trim().length > 0);
  const firstLine = compactWhitespace(cleanLines[0] ?? "");

  if (isError) return firstLine || "error";

  const structured = countSummary(details);
  if (structured) return structured;

  if (/edit|replace|patch/i.test(toolName)) {
    const diff = diffSummary(details);
    if (diff) return diff;
  }

  if (/^read$/i.test(toolName)) {
    const count = text ? text.split(/\r?\n/).length : 0;
    return `${count} line${count === 1 ? "" : "s"}`;
  }

  if (/bash|shell|exec|command/i.test(toolName)) {
    const exitCode = details && typeof details === "object"
      ? (details as { exitCode?: unknown }).exitCode
      : undefined;
    return typeof exitCode === "number" && exitCode !== 0 ? `exit ${exitCode}` : "done";
  }

  const record = argsRecord(args);
  if (/write|create/i.test(toolName) && typeof record?.content === "string") {
    const value = record.content;
    const count = value.length === 0 ? 0 : value.split("\n").length - (value.endsWith("\n") ? 1 : 0);
    return `${count} line${count === 1 ? "" : "s"}`;
  }

  const images = Array.isArray(content)
    ? (content as ToolContentBlock[]).filter((block) => block?.type === "image").length
    : 0;
  if (images > 0 && !firstLine) return `${images} image${images === 1 ? "" : "s"}`;
  if (cleanLines.length > 1) return `${cleanLines.length} lines`;
  if (firstLine.length > 72) return "done";
  return firstLine || "done";
}

export function fullTextResult(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as ToolContentBlock[])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n");
}

export function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return "";
  if (milliseconds < 1000) return "<1s";
  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1000)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${minutes}m`;
}
