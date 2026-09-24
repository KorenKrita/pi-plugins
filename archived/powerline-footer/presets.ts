import type { PresetDef } from "./types.ts";
import { getDefaultColors } from "./theme.ts";

const STATUS_LINE_PRESET: PresetDef = {
  leftSegments: ["model", "thinking", "path", "git"],
  rightSegments: ["context_pct", "token_in", "token_out", "token_total", "cache_read", "cache_write", "cost", "time_spent"],
  secondarySegments: ["extension_statuses"],
  separator: "slash",
  colors: getDefaultColors(),
  segmentOptions: {
    model: { showThinkingLevel: false },
    path: { mode: "abbreviated", maxLength: 60 },
    git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
  },
};

export function getPreset(): PresetDef {
  return STATUS_LINE_PRESET;
}
