import { loadThemeConfig } from "./theme.ts";

export interface IconSet {
  model: string;
  folder: string;
  branch: string;
  git: string;
  tokens: string;
  context: string;
  time: string;
  cache: string;
  input: string;
  output: string;
  auto: string;
}

export const SEP_DOT = " · ";

const THINKING_TEXT_NERD: Record<string, string> = {
  minimal: "\u{F0E7} min",
  low: "\u{F10C} low",
  medium: "\u{F192} med",
  high: "\u{F111} high",
  xhigh: "\u{F06D} xhi",
};

const NERD_ICONS: IconSet = {
  model: "\uEC19",
  folder: "\uF115",
  branch: "\uF126",
  git: "\uF1D3",
  tokens: "\uE26B",
  context: "\uE70F",
  time: "\uF017",
  cache: "\uF1C0",
  input: "\uF090",
  output: "\uF08B",
  auto: "\u{F0068}",
};

function sanitizeUserIconOverrides(value: unknown): Partial<IconSet> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const sanitized: Partial<IconSet> = {};
  const overrides = value as Record<string, unknown>;
  for (const key of Object.keys(NERD_ICONS) as Array<keyof IconSet>) {
    const icon = overrides[key];
    if (typeof icon === "string") sanitized[key] = icon;
  }
  return sanitized;
}

export function getThinkingText(level: string): string | undefined {
  return THINKING_TEXT_NERD[level];
}

export function getIcons(): IconSet {
  return {
    ...NERD_ICONS,
    ...sanitizeUserIconOverrides(loadThemeConfig().icons),
  };
}
