import { describe, expect, test } from "bun:test";
import {
  buildManagedCommands,
  filterCommandSuggestions,
  getExtensionDisplayName,
  isSlashCommandNameCompletion,
  parseConfig,
} from "./core.ts";

describe("command blacklist core", () => {
  test("filters only exact blocked command names", () => {
    const result = filterCommandSuggestions(
      {
        prefix: "/mod",
        items: [
          { value: "model", label: "model" },
          { value: "models", label: "models" },
        ],
      },
      new Set(["model"]),
    );

    expect(result).toEqual({ prefix: "/mod", items: [{ value: "models", label: "models" }] });
  });

  test("returns null when every suggestion is blocked", () => {
    expect(
      filterCommandSuggestions(
        { prefix: "/", items: [{ value: "model", label: "model" }] },
        new Set(["model"]),
      ),
    ).toBeNull();
  });

  test("recognizes command-name completion but not command arguments", () => {
    expect(isSlashCommandNameCompletion(["/mod"], 0, 4)).toBe(true);
    expect(isSlashCommandNameCompletion(["/model gpt"], 0, 10)).toBe(false);
    expect(isSlashCommandNameCompletion(["hello /mod"], 0, 10)).toBe(false);
  });

  test("validates, deduplicates, and sorts config", () => {
    expect(parseConfig({ version: 1, commands: ["settings", "model", "model"] })).toEqual({
      version: 1,
      commands: ["model", "settings"],
    });
    expect(() => parseConfig({ version: 1, commands: ["/model"] })).toThrow("不应包含开头的 /");
  });

  test("groups discovered commands by provenance and keeps stale blocked entries", () => {
    const commands = buildManagedCommands(
      [
        { value: "model", label: "model", description: "Select model" },
        { value: "commandBlacklist", label: "commandBlacklist", description: "[u] 管理" },
        { value: "skill:read", label: "skill:read", description: "[u] Read URLs" },
      ],
      new Map([
        ["commandBlacklist", { source: "extension", owner: "command-blacklist" }],
        ["skill:read", { source: "skill" }],
      ]),
      new Set(["old-command"]),
    );

    expect(commands.map(({ name, source }) => ({ name, source }))).toEqual([
      { name: "commandBlacklist", source: "extension" },
      { name: "skill:read", source: "skill" },
      { name: "model", source: "builtin" },
      { name: "old-command", source: "unavailable" },
    ]);
  });

  test("uses command metadata as the source of extension commands", () => {
    const commands = buildManagedCommands(
      [{ value: "otherExtension", label: "otherExtension", description: "Other extension command" }],
      new Map([["otherExtension", { source: "extension", owner: "other-extension" }]]),
      new Set(),
    );

    expect(commands).toEqual([
      {
        name: "otherExtension",
        description: "Other extension command",
        source: "extension",
        owner: "other-extension",
      },
    ]);
  });

  test("excludes the blacklist manager command itself", () => {
    const commands = buildManagedCommands(
      [
        { value: "model", label: "model", description: "Select model" },
        { value: "commandBlacklist", label: "commandBlacklist", description: "Manage blacklist" },
      ],
      new Map([["commandBlacklist", { source: "extension", owner: "command-blacklist" }]]),
      new Set(),
      new Set(["commandBlacklist"]),
    );

    expect(commands.map((command) => command.name)).toEqual(["model"]);
  });

  test("derives concrete extension names from sourceInfo", () => {
    expect(
      getExtensionDisplayName({
        path: "/agent/npm/node_modules/@ff-labs/pi-fff/src/index.ts",
        source: "npm:@ff-labs/pi-fff",
        baseDir: "/agent/npm/node_modules/@ff-labs/pi-fff",
      }),
    ).toBe("@ff-labs/pi-fff");

    expect(
      getExtensionDisplayName({
        path: "/agent/git/github.com/KorenKrita/pi-context/src/context.ts",
        source: "git:github.com/KorenKrita/pi-context",
        baseDir: "/agent/git/github.com/KorenKrita/pi-context",
      }),
    ).toBe("KorenKrita/pi-context");

    expect(
      getExtensionDisplayName({
        path: "/agent/extensions/fixed-input/index.ts",
        source: "auto",
        baseDir: "/agent",
      }),
    ).toBe("fixed-input");

    expect(
      getExtensionDisplayName({
        path: "/agent/extensions/dev-inspect.ts",
        source: "auto",
        baseDir: "/agent",
      }),
    ).toBe("dev-inspect.ts");
  });
});
