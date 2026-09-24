import {
  getAgentDir,
  type ExtensionAPI,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type AutocompleteItem,
  type AutocompleteProvider,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CONFIG_VERSION,
  buildManagedCommands,
  filterCommandSuggestions,
  getExtensionDisplayName,
  isSlashCommandNameCompletion,
  parseConfig,
  type CommandMetadata,
  type CommandSource,
  type ManagedCommand,
} from "./core.ts";

const CONFIG_PATH = join(getAgentDir(), "command-blacklist.json");
const SOURCE_ORDER: CommandSource[] = ["extension", "prompt", "skill", "builtin", "unavailable"];
const SOURCE_LABELS: Record<CommandSource, string> = {
  builtin: "内置命令 (builtin)",
  extension: "扩展命令 (extension)",
  prompt: "提示词模板 (prompt)",
  skill: "技能命令 (skill)",
  unavailable: "当前不可用 (unavailable)",
};

interface HeaderRow {
  kind: "header";
  source: CommandSource;
}

interface OwnerRow {
  kind: "owner";
  owner: string;
}

interface CommandRow {
  kind: "command";
  command: ManagedCommand;
}

type Row = HeaderRow | OwnerRow | CommandRow;

async function loadConfig(): Promise<Set<string>> {
  try {
    const text = await readFile(CONFIG_PATH, "utf8");
    return new Set(parseConfig(JSON.parse(text)).commands);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw new Error(`读取 ${CONFIG_PATH} 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveConfig(commands: ReadonlySet<string>): Promise<void> {
  const config = parseConfig({ version: CONFIG_VERSION, commands: [...commands] });
  const tempPath = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;

  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, CONFIG_PATH);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error(`写入 ${CONFIG_PATH} 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createRows(commands: ManagedCommand[]): Row[] {
  const rows: Row[] = [];
  for (const source of SOURCE_ORDER) {
    const group = commands.filter((command) => command.source === source);
    if (group.length === 0) continue;
    rows.push({ kind: "header", source });

    if (source !== "extension") {
      rows.push(...group.map((command): CommandRow => ({ kind: "command", command })));
      continue;
    }

    let currentOwner: string | undefined;
    for (const command of group) {
      const owner = command.owner ?? "未知扩展";
      if (owner !== currentOwner) {
        rows.push({ kind: "owner", owner });
        currentOwner = owner;
      }
      rows.push({ kind: "command", command });
    }
  }
  return rows;
}

class CommandBlacklistView implements Component {
  private readonly rows: Row[];
  private readonly commandRowIndexes: number[];
  private selected = 0;
  private saving = false;
  private status = "未保存的更改只在按 Ctrl+S 后生效";

  constructor(
    commands: ManagedCommand[],
    private readonly draft: Set<string>,
    private readonly tui: TUI,
    private readonly theme: {
      fg(color: "accent" | "muted" | "dim" | "success" | "error" | "warning", text: string): string;
      bold(text: string): string;
    },
    private readonly onSave: (commands: ReadonlySet<string>) => Promise<void>,
    private readonly onClose: () => void,
  ) {
    this.rows = createRows(commands);
    this.commandRowIndexes = this.rows.flatMap((row, index) => (row.kind === "command" ? [index] : []));
  }

  handleInput(data: string): void {
    if (this.saving) return;

    if (matchesKey(data, "ctrl+s")) {
      this.saving = true;
      this.status = "正在保存…";
      this.tui.requestRender();
      void this.onSave(this.draft)
        .then(() => this.onClose())
        .catch((error) => {
          this.saving = false;
          this.status = error instanceof Error ? error.message : String(error);
          this.tui.requestRender();
        });
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      this.onClose();
      return;
    }

    if (this.commandRowIndexes.length === 0) return;

    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1);
    } else if (matchesKey(data, Key.down)) {
      this.selected = Math.min(this.commandRowIndexes.length - 1, this.selected + 1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.selected = Math.max(0, this.selected - 10);
    } else if (matchesKey(data, Key.pageDown)) {
      this.selected = Math.min(this.commandRowIndexes.length - 1, this.selected + 10);
    } else if (matchesKey(data, Key.enter)) {
      const row = this.rows[this.commandRowIndexes[this.selected]];
      if (row?.kind === "command") {
        if (this.draft.has(row.command.name)) this.draft.delete(row.command.name);
        else this.draft.add(row.command.name);
        this.status = `已修改 /${row.command.name}，按 Ctrl+S 保存`;
      }
    } else {
      return;
    }

    this.tui.requestRender();
  }

  render(width: number): string[] {
    const selectedRow = this.commandRowIndexes[this.selected] ?? 0;
    const viewportSize = Math.max(4, this.tui.terminal.rows - 7);
    const maxStart = Math.max(0, this.rows.length - viewportSize);
    const start = Math.min(maxStart, Math.max(0, selectedRow - Math.floor(viewportSize / 2)));
    const visibleRows = this.rows.slice(start, start + viewportSize);

    const output = [
      truncateToWidth(this.theme.fg("accent", this.theme.bold("命令候选黑名单")), width),
      truncateToWidth(this.theme.fg("dim", `配置：${CONFIG_PATH}`), width),
      "",
    ];

    if (visibleRows.length === 0) {
      output.push(this.theme.fg("warning", "没有发现可管理的 / 命令"));
    } else {
      for (let offset = 0; offset < visibleRows.length; offset += 1) {
        const rowIndex = start + offset;
        const row = visibleRows[offset];
        if (row.kind === "header") {
          output.push(truncateToWidth(this.theme.fg("muted", this.theme.bold(SOURCE_LABELS[row.source])), width));
          continue;
        }
        if (row.kind === "owner") {
          output.push(truncateToWidth(`  ${this.theme.fg("accent", this.theme.bold(row.owner))}`, width));
          continue;
        }

        const focused = rowIndex === selectedRow;
        const marker = focused ? this.theme.fg("accent", "›") : " ";
        const checkbox = this.draft.has(row.command.name)
          ? this.theme.fg("warning", "[x]")
          : this.theme.fg("dim", "[ ]");
        const command = focused
          ? this.theme.fg("accent", `/${row.command.name}`)
          : `/${row.command.name}`;
        const indentation = row.command.source === "extension" ? "      " : "  ";
        output.push(truncateToWidth(`${marker}${indentation}${checkbox} ${command}`, width));
      }
    }

    const statusColor = this.status.includes("失败") ? "error" : this.saving ? "warning" : "dim";
    output.push("");
    output.push(truncateToWidth(this.theme.fg(statusColor, this.status), width));
    output.push(
      truncateToWidth(
        this.theme.fg("dim", "↑↓/PgUp/PgDn 移动 · Enter 勾选 · Ctrl+S 保存 · Esc 取消"),
        width,
      ),
    );
    return output;
  }

  invalidate(): void {}
}

function commandMetadataMap(commands: SlashCommandInfo[]): Map<string, CommandMetadata> {
  return new Map(
    commands.map((command) => [
      command.name,
      {
        source: command.source,
        owner: command.source === "extension" ? getExtensionDisplayName(command.sourceInfo) : undefined,
      },
    ]),
  );
}

export default function commandBlacklistExtension(pi: ExtensionAPI) {
  let blockedCommands = new Set<string>();
  let unfilteredProvider: AutocompleteProvider | undefined;

  pi.registerCommand("commandBlacklist", {
    description: "管理 / 命令候选黑名单",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/commandBlacklist 仅支持 TUI 模式", "error");
        return;
      }
      if (!unfilteredProvider) {
        ctx.ui.notify("命令候选提供器尚未初始化，请执行 /reload 后重试", "error");
        return;
      }

      try {
        blockedCommands = await loadConfig();
        const controller = new AbortController();
        const suggestions = await unfilteredProvider.getSuggestions(["/"], 0, 1, {
          signal: controller.signal,
        });
        const items: AutocompleteItem[] = suggestions?.items ?? [];
        const commands = buildManagedCommands(
          items,
          commandMetadataMap(pi.getCommands()),
          blockedCommands,
          new Set(["commandBlacklist"]),
        );
        const draft = new Set(blockedCommands);

        await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
          new CommandBlacklistView(
            commands,
            draft,
            tui,
            theme,
            async (nextCommands) => {
              await saveConfig(nextCommands);
              blockedCommands = new Set(nextCommands);
              ctx.ui.notify(`已保存 ${blockedCommands.size} 条命令黑名单`, "info");
            },
            () => done(undefined),
          ),
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      blockedCommands = await loadConfig();
    } catch (error) {
      blockedCommands = new Set();
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }

    ctx.ui.addAutocompleteProvider((current) => {
      unfilteredProvider = current;
      return {
        triggerCharacters: current.triggerCharacters,
        async getSuggestions(lines, cursorLine, cursorCol, options) {
          const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
          if (!isSlashCommandNameCompletion(lines, cursorLine, cursorCol)) return suggestions;
          return filterCommandSuggestions(suggestions, blockedCommands);
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },
        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
          return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
      };
    });
  });
}
