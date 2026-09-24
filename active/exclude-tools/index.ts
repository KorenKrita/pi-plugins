// Honor `excludeTools` from ~/.pi/agent/settings.json.
// Pi core only reads this list from the CLI flag `--exclude-tools`; the
// settings.json key is otherwise ignored. This extension bridges the gap by
// deactivating the listed tools on every session start / reload.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function loadExcluded(): Set<string> {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8");
    const list = JSON.parse(raw).excludeTools;
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const excluded = loadExcluded();
    if (excluded.size === 0) return;
    const active = pi.getActiveTools();
    const next = active.filter((name) => !excluded.has(name));
    if (next.length !== active.length) pi.setActiveTools(next);
  });
}
