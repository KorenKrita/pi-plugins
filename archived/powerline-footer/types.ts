import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export type ColorValue = ThemeColor | `#${string}`;
export type ThemeLike = Pick<Theme, "fg">;

export type SemanticColor =
  | "model"
  | "path"
  | "gitDirty"
  | "gitClean"
  | "gitUnstaged"
  | "gitStaged"
  | "gitUntracked"
  | "thinking"
  | "thinkingMinimal"
  | "thinkingLow"
  | "thinkingMedium"
  | "context"
  | "contextWarn"
  | "contextError"
  | "cost"
  | "time"
  | "tokens"
  | "separator"
  | "border";

export type ColorScheme = Partial<Record<SemanticColor, ColorValue>>;

export type BuiltinStatusLineSegmentId =
  | "model"
  | "thinking"
  | "path"
  | "git"
  | "context_pct"
  | "token_in"
  | "token_out"
  | "token_total"
  | "cache_read"
  | "cache_write"
  | "cost"
  | "time_spent"
  | "extension_statuses";

export type StatusLineSegmentId = BuiltinStatusLineSegmentId | `custom:${string}`;
export type StatusLineSeparatorStyle = "slash";

export interface StatusLineSegmentOptions {
  model?: { showThinkingLevel?: boolean };
  path?: {
    mode?: "basename" | "abbreviated" | "full";
    maxLength?: number;
  };
  git?: {
    showBranch?: boolean;
    showStaged?: boolean;
    showUnstaged?: boolean;
    showUntracked?: boolean;
    polling?: "full" | "branch" | "off";
  };
}

export type CustomItemPosition = "left" | "right" | "secondary";

export interface CustomStatusItem {
  id: string;
  statusKey: string;
  position: CustomItemPosition;
  color?: ColorValue;
  prefix?: string;
  hideWhenMissing: boolean;
  excludeFromExtensionStatuses: boolean;
}

export interface PresetDef {
  leftSegments: BuiltinStatusLineSegmentId[];
  rightSegments: BuiltinStatusLineSegmentId[];
  secondarySegments?: BuiltinStatusLineSegmentId[];
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
  colors?: ColorScheme;
}

export interface SeparatorDef {
  left: string;
  right: string;
}

export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SegmentContext {
  model: { id: string; name?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  thinkingLevel: string;
  cwd?: string;
  usageStats: UsageStats;
  contextPercent: number;
  contextWindow: number;
  autoCompactEnabled: boolean;
  customCompactionEnabled: boolean;
  usingSubscription: boolean;
  sessionStartTime: number;
  git: GitStatus;
  extensionStatuses: ReadonlyMap<string, string>;
  hiddenExtensionStatusKeys: ReadonlySet<string>;
  customItemsById: ReadonlyMap<string, CustomStatusItem>;
  options: StatusLineSegmentOptions;
  theme: ThemeLike;
  colors: ColorScheme;
}

export interface RenderedSegment {
  content: string;
  visible: boolean;
}

export interface StatusLineSegment {
  id: BuiltinStatusLineSegmentId;
  render(ctx: SegmentContext): RenderedSegment;
}
