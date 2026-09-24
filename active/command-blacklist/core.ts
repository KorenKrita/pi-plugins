import type { AutocompleteItem, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { basename, dirname, sep } from "node:path";

export const CONFIG_VERSION = 1 as const;

export type CommandSource = "builtin" | "extension" | "prompt" | "skill" | "unavailable";

export interface CommandBlacklistConfig {
  version: typeof CONFIG_VERSION;
  commands: string[];
}

export interface ManagedCommand {
  name: string;
  description?: string;
  source: CommandSource;
  owner?: string;
}

export interface CommandMetadata {
  source: Exclude<CommandSource, "builtin" | "unavailable">;
  owner?: string;
}

interface ExtensionSourceInfo {
  path: string;
  source: string;
  baseDir?: string;
}

function packageName(specifier: string): string {
  const versionSeparator = specifier.lastIndexOf("@");
  if (versionSeparator <= 0) return specifier;
  if (specifier.startsWith("@") && versionSeparator < specifier.indexOf("/")) return specifier;
  return specifier.slice(0, versionSeparator);
}

export function getExtensionDisplayName(sourceInfo: ExtensionSourceInfo): string {
  if (sourceInfo.source.startsWith("npm:")) {
    return packageName(sourceInfo.source.slice("npm:".length));
  }

  if (sourceInfo.source.startsWith("git:")) {
    return sourceInfo.source.slice("git:".length).replace(/^github\.com\//, "").replace(/@[^/]+$/, "");
  }

  const marker = `${sep}extensions${sep}`;
  const markerIndex = sourceInfo.path.lastIndexOf(marker);
  if (markerIndex >= 0) {
    const extensionPath = sourceInfo.path.slice(markerIndex + marker.length);
    return /^index\.[cm]?[jt]sx?$/.test(basename(extensionPath))
      ? dirname(extensionPath)
      : extensionPath;
  }

  const fileName = basename(sourceInfo.path);
  if (/^index\.[cm]?[jt]sx?$/.test(fileName)) return basename(dirname(sourceInfo.path));
  return fileName || sourceInfo.source;
}

export function isSlashCommandNameCompletion(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): boolean {
  const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
  return beforeCursor.startsWith("/") && !beforeCursor.includes(" ");
}

export function filterCommandSuggestions(
  suggestions: AutocompleteSuggestions | null,
  blockedCommands: ReadonlySet<string>,
): AutocompleteSuggestions | null {
  if (!suggestions) return null;

  const items = suggestions.items.filter((item) => !blockedCommands.has(item.value));
  return items.length > 0 ? { ...suggestions, items } : null;
}

export function parseConfig(value: unknown): CommandBlacklistConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("配置根节点必须是 JSON 对象");
  }

  const record = value as Record<string, unknown>;
  if (record.version !== CONFIG_VERSION) {
    throw new Error(`配置 version 必须是 ${CONFIG_VERSION}`);
  }
  if (!Array.isArray(record.commands)) {
    throw new Error("配置 commands 必须是字符串数组");
  }

  const commands = record.commands.map((command, index) => {
    if (typeof command !== "string" || command.trim() === "") {
      throw new Error(`commands[${index}] 必须是非空字符串`);
    }
    if (command.startsWith("/")) {
      throw new Error(`commands[${index}] 不应包含开头的 /`);
    }
    return command;
  });

  return {
    version: CONFIG_VERSION,
    commands: [...new Set(commands)].sort((a, b) => a.localeCompare(b)),
  };
}

export function buildManagedCommands(
  items: AutocompleteItem[],
  metadata: ReadonlyMap<string, CommandMetadata>,
  blockedCommands: ReadonlySet<string>,
  excludedCommands: ReadonlySet<string> = new Set(),
): ManagedCommand[] {
  const byName = new Map<string, ManagedCommand>();

  for (const item of items) {
    if (excludedCommands.has(item.value)) continue;

    const commandMetadata = metadata.get(item.value);
    byName.set(item.value, {
      name: item.value,
      description: item.description,
      source: commandMetadata?.source ?? "builtin",
      owner: commandMetadata?.owner,
    });
  }

  for (const name of blockedCommands) {
    if (!excludedCommands.has(name) && !byName.has(name)) {
      byName.set(name, { name, source: "unavailable" });
    }
  }

  const sourceOrder: Record<CommandSource, number> = {
    extension: 0,
    prompt: 1,
    skill: 2,
    builtin: 3,
    unavailable: 4,
  };

  return [...byName.values()].sort((a, b) => {
    const sourceDifference = sourceOrder[a.source] - sourceOrder[b.source];
    if (sourceDifference !== 0) return sourceDifference;
    const ownerDifference = (a.owner ?? "").localeCompare(b.owner ?? "");
    return ownerDifference || a.name.localeCompare(b.name);
  });
}
