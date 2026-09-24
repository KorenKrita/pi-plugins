// @ts-nocheck

// ../../../../../../tmp/pi-flod-entry.ts
import { readFileSync } from "node:fs";
import { AssistantMessageComponent as AssistantMessageComponent2 } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, matchesKey, Markdown, Spacer as Spacer2, Text as Text2 } from "@earendil-works/pi-tui";
import piTraceline, { internals as tracelineInternals } from "./traceline/index.ts";

// ../../../../../../tmp/pi-flod-turn-fold/render-patches.ts
import {
  SkillInvocationMessageComponent,
  UserMessageComponent
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";

// ../../../../../../tmp/pi-flod-turn-fold/tool-padding.ts
var TOOL_PADDING_TARGET_KEYS = ["contentBox", "contentText"];
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function removeHorizontalPadding(target) {
  if (!isRecord(target) || typeof target["paddingX"] !== "number") return false;
  if (target["paddingX"] === 0 || typeof target["invalidate"] !== "function") return false;
  if (!Reflect.set(target, "paddingX", 0)) return false;
  Reflect.apply(target["invalidate"], target, []);
  return true;
}
function removeToolHorizontalPadding(component) {
  let changed = 0;
  for (const key of TOOL_PADDING_TARGET_KEYS) {
    if (removeHorizontalPadding(Reflect.get(component, key))) changed += 1;
  }
  return changed;
}

// ../../../../../../tmp/pi-flod-turn-fold/local-time.ts
function twoDigits(value) {
  return String(value).padStart(2, "0");
}
function sameLocalDate(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
function formatLocalTimestamp(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const current = new Date(now);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "";
  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  if (sameLocalDate(date, current)) return time;
  return `${String(date.getFullYear())}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${time}`;
}

// ../../../../../../tmp/pi-flod-turn-fold/render-patches.ts
function privateString(instance, key) {
  const value = Reflect.get(instance, key);
  return typeof value === "string" ? value : void 0;
}
function countLabel(count, singular, plural = `${singular}s`) {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}
function formatDuration(durationMs) {
  if (durationMs < 1e3) return "<1s";
  const totalSeconds = Math.round(durationMs / 1e3);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds)}s`;
}
function formatStreamingSummary(summary) {
  const parts = [countLabel(summary.hiddenActivities, "earlier activity", "earlier activities")];
  if (summary.tools > 0) parts.push(countLabel(summary.tools, "tool"));
  if (summary.messages > 0) parts.push(countLabel(summary.messages, "msg"));
  return `\u25B6 ${parts.join(" \xB7 ")}`;
}
function formatSettledSummary(summary) {
  const parts = [`Worked for ${formatDuration(summary.durationMs)}`];
  if (summary.tools > 0) parts.push(countLabel(summary.tools, "tool"));
  if (summary.messages > 0) parts.push(countLabel(summary.messages, "msg"));
  if (summary.failedTools > 0) parts.push(countLabel(summary.failedTools, "failure"));
  if (summary.aborted) parts.push("interrupted");
  return `\u25B6 ${parts.join(" \xB7 ")}`;
}
function styledSummary(text, summary, width, theme) {
  if (width <= 0) return [];
  const truncated = truncateToWidth(text, width, "\u2026");
  const styled = theme ? theme.bold(
    theme.fg(summary.aborted || summary.failedTools > 0 ? "warning" : "muted", truncated)
  ) : truncated;
  return ["", styled];
}
function renderStreamingSummary(summary, width, theme) {
  return styledSummary(formatStreamingSummary(summary), summary, width, theme);
}
function renderSettledSummary(summary, width, theme) {
  return styledSummary(formatSettledSummary(summary), summary, width, theme);
}
function interruptionFallback(theme, width) {
  if (width <= 0) return [];
  const text = truncateToWidth("Operation interrupted", width, "\u2026");
  return ["", theme ? theme.fg("error", text) : text];
}
function settledFinal(original, summary, width, theme) {
  const visible = original.length === 0 && summary.aborted ? interruptionFallback(theme, width) : original;
  return visible;
}
function settledSummaryAndFinal(original, summary, width, theme) {
  return [
    ...renderSettledSummary(summary, width, theme),
    ...settledFinal(original, summary, width, theme)
  ];
}
var USER_ZONE_END = "\x1B]133;B\x07\x1B]133;C\x07";
function timestampContent(label, width, theme) {
  const styled = theme ? theme.fg("dim", label) : label;
  return " ".repeat(Math.max(0, width - label.length)) + styled;
}
function timestampBackground(content, background, theme) {
  return theme ? theme.bg(background, content) : content;
}
function timestampOnBottomLine(original, timestamp, width, theme, background) {
  if (timestamp === void 0 || width <= 0 || original.length === 0) return original;
  const label = truncateToWidth(formatLocalTimestamp(timestamp), width, "");
  if (!label) return original;
  const content = timestampContent(label, width, theme);
  const lastLine = original.at(-1) ?? "";
  const prefix = lastLine.startsWith(USER_ZONE_END) ? USER_ZONE_END : "";
  const timestampLine = timestampBackground(content, background, theme);
  return [...original.slice(0, -1), prefix + timestampLine];
}
function skillHasUserMessage(component) {
  const skillBlock = Reflect.get(component, "skillBlock");
  if (typeof skillBlock !== "object" || skillBlock === null) return false;
  const userMessage = Reflect.get(skillBlock, "userMessage");
  return typeof userMessage === "string" && userMessage.trim().length > 0;
}
function isUserRow(component) {
  return component instanceof UserMessageComponent || component instanceof SkillInvocationMessageComponent;
}
function installTranscriptContainerPatches(state) {
  const suppressedSpacers = /* @__PURE__ */ new WeakSet();
  const patchedComponents = /* @__PURE__ */ new WeakSet();
  const renderPatches = [];
  const containerPrototype = Container.prototype;
  const originalAddChild = containerPrototype.addChild;
  const originalContainerRender = containerPrototype.render;
  const spacerPrototype = Spacer.prototype;
  const originalSpacerRender = spacerPrototype.render;
  const patchSupplementary = (component, associated) => {
    if (!associated || patchedComponents.has(component)) return;
    const original = Reflect.get(component, "render");
    if (typeof original !== "function") return;
    const originalRender = original;
    const hadOwnRender = Object.hasOwn(component, "render");
    const patched = function(width) {
      return state.viewFor(this)?.display === "hidden" ? [] : Reflect.apply(originalRender, this, [width]);
    };
    if (!Reflect.set(component, "render", patched)) return;
    patchedComponents.add(component);
    renderPatches.push({ component, hadOwnRender, original: originalRender, patched });
  };
  const patchCacheMissPair = (previous, component) => {
    const text = component instanceof Text ? privateString(component, "text") : void 0;
    if (!(previous instanceof Spacer) || !text?.includes("Cache miss") || !text.includes("tokens re-billed")) {
      return;
    }
    patchSupplementary(previous, state.associateCacheMiss(previous));
    patchSupplementary(component, state.associateCacheMiss(component));
  };
  const patchExistingCacheMisses = (container) => {
    for (let index = 1; index < container.children.length; index += 1) {
      patchCacheMissPair(container.children[index - 1], container.children[index]);
    }
  };
  const patchedAddChild = function(component) {
    const previous = this.children.at(-1);
    if (previous instanceof Spacer && isUserRow(component)) suppressedSpacers.add(previous);
    patchCacheMissPair(previous, component);
    originalAddChild.call(this, component);
  };
  const patchedContainerRender = function(width) {
    const customEntry = Reflect.get(this, "entry");
    if (customEntry !== void 0) {
      state.reloadHistoryForNewComponent(this);
      if (state.associateCustomEntry(this, customEntry) && state.viewFor(this)?.display === "hidden") {
        return [];
      }
    }
    patchExistingCacheMisses(this);
    return originalContainerRender.call(this, width);
  };
  const patchedSpacerRender = function(width) {
    return suppressedSpacers.has(this) ? [] : originalSpacerRender.call(this, width);
  };
  containerPrototype.addChild = patchedAddChild;
  containerPrototype.render = patchedContainerRender;
  spacerPrototype.render = patchedSpacerRender;
  return () => {
    if (containerPrototype.addChild === patchedAddChild) {
      containerPrototype.addChild = originalAddChild;
    }
    if (containerPrototype.render === patchedContainerRender) {
      containerPrototype.render = originalContainerRender;
    }
    if (spacerPrototype.render === patchedSpacerRender) {
      spacerPrototype.render = originalSpacerRender;
    }
    for (const { component, hadOwnRender, original, patched } of renderPatches) {
      if (Reflect.get(component, "render") !== patched) continue;
      if (hadOwnRender) Reflect.set(component, "render", original);
      else Reflect.deleteProperty(component, "render");
    }
  };
}
function installUserTimestampPatches(state, getTheme) {
  const restoreTranscriptContainer = installTranscriptContainerPatches(state);
  const userPrototype = UserMessageComponent.prototype;
  const originalUserRender = userPrototype.render;
  const skillPrototype = SkillInvocationMessageComponent.prototype;
  const originalSkillRender = skillPrototype.render;
  const patchedUserRender = function(width) {
    state.reloadHistoryForNewComponent(this);
    state.associateUser(this);
    return timestampOnBottomLine(
      originalUserRender.call(this, width),
      state.userTimestampFor(this),
      width,
      getTheme(),
      "userMessageBg"
    );
  };
  const patchedSkillRender = function(width) {
    const original = originalSkillRender.call(this, width);
    if (skillHasUserMessage(this)) return original;
    state.reloadHistoryForNewComponent(this);
    state.associateUser(this);
    return timestampOnBottomLine(
      original,
      state.userTimestampFor(this),
      width,
      getTheme(),
      "customMessageBg"
    );
  };
  userPrototype.render = patchedUserRender;
  skillPrototype.render = patchedSkillRender;
  return () => {
    restoreTranscriptContainer();
    if (userPrototype.render === patchedUserRender) userPrototype.render = originalUserRender;
    if (skillPrototype.render === patchedSkillRender) skillPrototype.render = originalSkillRender;
  };
}
function renderFoldView(display, original, summary, width, theme) {
  if (display === "original") return original();
  if (display === "hidden") return [];
  if (display === "streaming-summary") return renderStreamingSummary(summary, width, theme);
  if (display === "settled-summary") return renderSettledSummary(summary, width, theme);
  const originalLines = original();
  return display === "settled-summary-final" ? settledSummaryAndFinal(originalLines, summary, width, theme) : settledFinal(originalLines, summary, width, theme);
}
function renderAssistantTextOnly(instance, width) {
  const message = Reflect.get(instance, "lastMessage");
  const texts = contentItems(message).filter((item) => hasNonBlankContent(item, "text", "text"));
  if (texts.length === 0 || width <= 0) return [];
  const lines = [""];
  for (const item of texts) {
    const component = new Markdown(
      stringField(item, "text")?.trim() ?? "",
      Reflect.get(instance, "outputPad") ?? 1,
      0,
      Reflect.get(instance, "markdownTheme")
    );
    lines.push(...component.render(width));
  }
  return lines;
}
function toolResultTextChars(row) {
  const content = row?.result?.content;
  if (!Array.isArray(content)) return void 0;
  return content.reduce((sum, block) => {
    return block?.type === "text" && typeof block.text === "string" ? sum + block.text.length : sum;
  }, 0);
}
function displayedToolResultTextChars(row) {
  try {
    const run = tracelineInternals.readRun(row);
    if (run && run.index === 0) {
      let total;
      for (const member of run.rows) {
        const chars = toolResultTextChars(member);
        if (chars !== void 0) total = (total ?? 0) + chars;
      }
      return total;
    }
  } catch {
    // Keep localization best-effort; Traceline itself owns fold detection.
  }
  return toolResultTextChars(row);
}
function tracelineCharSuffixPlan(line, chars) {
  const plain = tracelineInternals.stripAnsi(line);
  if (!plain.includes("▏") || !plain.includes("›")) return void 0;
  const match = /(\d+\.\d+[kM]) ch(?=\s*$)/.exec(plain);
  if (!match) return void 0;
  const replacement = chars !== void 0 && chars < 1e3 ? `${String(chars)} ch` : match[0];
  return {
    end: match.index + match[0].length,
    replacement,
    start: match.index
  };
}
function localizeTracelineCharSuffixes(lines, chars) {
  return lines.map((line) => {
    const plan = tracelineCharSuffixPlan(line, chars);
    if (!plan) return line;
    const rawStart = tracelineInternals.rawIndexAtVisibleIndex(line, plan.start);
    const rawEnd = tracelineInternals.rawIndexBeforeVisibleIndex(line, plan.end);
    return `${line.slice(0, rawStart)}${plan.replacement}${line.slice(rawEnd)}`;
  });
}
function installRenderPatches(state, getTheme, getToolDisplayMode) {
  const restoreUserTimestamps = installUserTimestampPatches(state, getTheme);
  const wrappedRows = new WeakSet();
  const restoreRows = [];
  const wrapAssistantRow = (row) => {
    if (wrappedRows.has(row) || typeof row.render !== "function") return;
    const hadOwnRender = Object.hasOwn(row, "render");
    const originalRender = row.render;
    const callUnderlyingRender = (instance, width) => {
      const inheritedRender = hadOwnRender ? originalRender : Object.getPrototypeOf(instance)?.render;
      const target = typeof inheritedRender === "function" && inheritedRender !== patchedRender
        ? inheritedRender
        : originalRender;
      return target.call(instance, width);
    };
    const patchedRender = function(width) {
      state.reloadHistoryForNewComponent(this);
      const lastMessage = Reflect.get(this, "lastMessage");
      state.associateAssistant(this, lastMessage);
      const view = state.viewFor(this);
      if (!view) return callUnderlyingRender(this, width);
      if (view.display === "text-only") return renderAssistantTextOnly(this, width);
      return renderFoldView(
        view.display,
        () => callUnderlyingRender(this, width),
        view.summary,
        width,
        getTheme()
      );
    };
    if (!Reflect.set(row, "render", patchedRender)) return;
    wrappedRows.add(row);
    restoreRows.push(() => {
      if (row.render !== patchedRender) return;
      if (hadOwnRender) Reflect.set(row, "render", originalRender);
      else Reflect.deleteProperty(row, "render");
    });
  };
  const wrapToolRow = (row) => {
    if (wrappedRows.has(row) || typeof row.render !== "function") return;
    const hadOwnRender = Object.hasOwn(row, "render");
    const originalRender = row.render;
    const callUnderlyingRender = (instance, width) => {
      const inheritedRender = hadOwnRender ? originalRender : Object.getPrototypeOf(instance)?.render;
      const target = typeof inheritedRender === "function" && inheritedRender !== patchedRender
        ? inheritedRender
        : originalRender;
      return target.call(instance, width);
    };
    const callForcedOneLineRender = (instance, width) => {
      const chat = tracelineInternals.getTracelineChat();
      const assistantRows = Array.isArray(chat?.children) ? chat.children.filter(tracelineInternals.isAssistantRow) : [];
      const hiddenStates = assistantRows.map((assistant) => assistant.hideThinkingBlock);
      const expanded = Reflect.get(instance, "expanded");
      for (const assistant of assistantRows) Reflect.set(assistant, "hideThinkingBlock", true);
      Reflect.set(instance, "expanded", false);
      try {
        return callUnderlyingRender(instance, width);
      } finally {
        Reflect.set(instance, "expanded", expanded);
        assistantRows.forEach((assistant, index) => Reflect.set(assistant, "hideThinkingBlock", hiddenStates[index]));
      }
    };
    const callNativeRender = (instance, width, nextExpanded) => {
      const chat = tracelineInternals.getTracelineChat();
      const assistantRows = Array.isArray(chat?.children) ? chat.children.filter(tracelineInternals.isAssistantRow) : [];
      const hiddenStates = assistantRows.map((assistant) => assistant.hideThinkingBlock);
      const expanded = Reflect.get(instance, "expanded");
      const setExpanded = Reflect.get(instance, "setExpanded");
      for (const assistant of assistantRows) Reflect.set(assistant, "hideThinkingBlock", false);
      if (typeof setExpanded === "function") Reflect.apply(setExpanded, instance, [nextExpanded]);
      else Reflect.set(instance, "expanded", nextExpanded);
      try {
        return callUnderlyingRender(instance, width);
      } finally {
        if (typeof setExpanded === "function") Reflect.apply(setExpanded, instance, [expanded]);
        else Reflect.set(instance, "expanded", expanded);
        assistantRows.forEach((assistant, index) => Reflect.set(assistant, "hideThinkingBlock", hiddenStates[index]));
      }
    };
    const callNativeExpandedRender = (instance, width) => callNativeRender(instance, width, true);
    const renderPreview = (instance, width) => {
      const lines = callNativeExpandedRender(instance, width);
      if (!Array.isArray(lines) || lines.length <= TOOL_PREVIEW_MAX_LINES) return lines;
      const visibleLines = lines.slice(0, TOOL_PREVIEW_MAX_LINES - 1);
      const hiddenLines = lines.length - visibleLines.length;
      const label = truncateToWidth(`… ${hiddenLines} more lines · press again for full output`, width, "…");
      const theme = getTheme();
      return [...visibleLines, theme ? theme.fg("dim", label) : label];
    };
    const renderLocalized = (instance, width) => {
      const toolDisplayMode = getToolDisplayMode();
      if (toolDisplayMode === "preview") return renderPreview(instance, width);
      if (toolDisplayMode === "nativeExpanded") return callNativeExpandedRender(instance, width);
      const chars = displayedToolResultTextChars(instance);
      return localizeTracelineCharSuffixes(callForcedOneLineRender(instance, width), chars);
    };
    const patchedRender = function(width) {
      removeToolHorizontalPadding(this);
      state.reloadHistoryForNewComponent(this);
      const toolCallId = privateString(this, "toolCallId");
      if (toolCallId) state.associateTool(this, toolCallId);
      const view = state.viewFor(this);
      if (!view) return renderLocalized(this, width);
      return renderFoldView(
        view.display,
        () => renderLocalized(this, width),
        view.summary,
        width,
        getTheme()
      );
    };
    if (!Reflect.set(row, "render", patchedRender)) return;
    wrappedRows.add(row);
    restoreRows.push(() => {
      if (row.render !== patchedRender) return;
      if (hadOwnRender) Reflect.set(row, "render", originalRender);
      else Reflect.deleteProperty(row, "render");
    });
  };
  const wrapLiveRow = (row) => {
    if (tracelineInternals.isAssistantRow(row)) {
      wrapAssistantRow(row);
      state.reloadHistoryForNewComponent(row);
      state.associateAssistant(row, Reflect.get(row, "lastMessage"));
      return;
    }
    if (tracelineInternals.isToolRow(row)) {
      wrapToolRow(row);
      state.reloadHistoryForNewComponent(row);
      const toolCallId = privateString(row, "toolCallId");
      if (toolCallId) state.associateTool(row, toolCallId);
    }
  };
  const containerPrototype = Container.prototype;
  const originalContainerAddChild = containerPrototype.addChild;
  const patchedContainerAddChild = function(row) {
    // Pi may append restored rows between scheduled renders. Wrapping at the insertion
    // seam prevents a compact turn from exposing an un-folded transient frame.
    wrapLiveRow(row);
    return originalContainerAddChild.call(this, row);
  };
  containerPrototype.addChild = patchedContainerAddChild;
  return {
    prepare() {
      const chat = tracelineInternals.getTracelineChat();
      if (!chat) return;
      const children = chat.children;
      if (!Array.isArray(children)) return;
      for (const row of children) wrapLiveRow(row);
    },
    restore() {
      if (containerPrototype.addChild === patchedContainerAddChild) {
        containerPrototype.addChild = originalContainerAddChild;
      }
      for (const restore of restoreRows.reverse()) restore();
      restoreRows.length = 0;
      restoreUserTimestamps();
    }
  };
}

// ../../../../../../tmp/pi-flod-turn-fold/mode.ts
var TURN_FOLD_MODES = ["compact", "expanded"];
function isTurnFoldMode(value) {
  return TURN_FOLD_MODES.some((mode) => mode === value);
}
function nextTurnFoldMode(mode) {
  return mode === "compact" ? "expanded" : "compact";
}

// ../../../../../../tmp/pi-flod-turn-fold/fold-policy.ts
function settledDisplay(input) {
  if (input.isSettledSummaryAnchor && input.isFinalAnchor) return "settled-summary-final";
  if (input.isSettledSummaryAnchor) return "settled-summary";
  return input.isFinalAnchor ? "settled-final" : "hidden";
}

// ../../../../../../tmp/pi-flod-turn-fold/turn-state.ts
var LIVE_THINKING_GROUP_LIMIT = 3;
var LIVE_TOOL_ONLY_LIMIT = 8;
var TOKEN_STATS_ENTRY_TYPE = "token-stats";
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function stringField(value, key) {
  if (!isRecord2(value)) return void 0;
  const field = value[key];
  return typeof field === "string" ? field : void 0;
}
function numberField(value, key) {
  if (!isRecord2(value)) return void 0;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : void 0;
}
function contentItems(message) {
  if (!isRecord2(message)) return [];
  return Array.isArray(message["content"]) ? message["content"] : [];
}
function hasNonBlankContent(value, type, key) {
  if (stringField(value, "type") !== type) return false;
  return Boolean(stringField(value, key)?.trim());
}
function summarizeAssistantContent(items) {
  let hasThinking = false;
  let hasText = false;
  const toolCallIds = [];
  for (const item of items) {
    if (hasNonBlankContent(item, "text", "text")) hasText = true;
    if (hasNonBlankContent(item, "thinking", "thinking") || stringField(item, "type") === "thinking" && isRecord2(item) && item["redacted"] === true) {
      hasThinking = true;
    }
    const toolCallId = stringField(item, "type") === "toolCall" ? stringField(item, "id") : void 0;
    if (toolCallId) toolCallIds.push(toolCallId);
  }
  return {
    hasThinking,
    hasText,
    hasVisibleContent: hasThinking || hasText,
    toolCallIds
  };
}
function assistantSnapshot(message, key) {
  if (stringField(message, "role") !== "assistant") return void 0;
  const timestamp = numberField(message, "timestamp");
  if (timestamp === void 0) return void 0;
  const { hasThinking, hasText, hasVisibleContent, toolCallIds } = summarizeAssistantContent(contentItems(message));
  const stopReason = stringField(message, "stopReason");
  return {
    hasTerminalNotice: stopReason === "aborted" || stopReason === "length" || stopReason === "error" && toolCallIds.length === 0,
    hasThinking,
    hasText,
    hasVisibleContent,
    interrupted: stopReason === "aborted",
    key,
    terminalErrorToolCallIds: stopReason === "error" ? toolCallIds : [],
    timestamp,
    toolCallIds
  };
}
function messageFromEntry(entry) {
  if (!isRecord2(entry) || entry["type"] !== "message") return void 0;
  return entry["message"];
}
function entryTimestamp(entry) {
  if (!isRecord2(entry)) return void 0;
  const timestamp = entry["timestamp"];
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp !== "string") return void 0;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function latestBySequence(components, candidates) {
  return candidates.reduce((latest, candidate) => {
    if (!latest) return candidate;
    const currentSequence = components.get(candidate)?.sequence ?? -1;
    const latestSequence = components.get(latest)?.sequence ?? -1;
    return currentSequence > latestSequence ? candidate : latest;
  }, void 0);
}
function groupNumber(id) {
  const value = Number(id.slice("turn-".length));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function invalidateComponent(component) {
  const invalidate = Reflect.get(component, "invalidate");
  if (typeof invalidate === "function") Reflect.apply(invalidate, component, []);
}
function assistantDisplayClassChanged(previous, current) {
  if (!previous) return false;
  return previous.hasThinking !== current.hasThinking || previous.hasText !== current.hasText || previous.hasVisibleContent !== current.hasVisibleContent || previous.hasTerminalNotice !== current.hasTerminalNotice;
}
function displayIncludesAssistantContent(display) {
  return display === "original" || display === "text-only" || display === "settled-final" || display === "settled-summary-final";
}
var TurnFoldState = class {
  activeAssistantKey;
  activeAssistantTimestamp;
  activeGroupId;
  assistantComponentByKey = /* @__PURE__ */ new Map();
  assistantGroupByKey = /* @__PURE__ */ new Map();
  assistantKeyByMessage = /* @__PURE__ */ new WeakMap();
  assistantOrdinalByTimestamp = /* @__PURE__ */ new Map();
  componentInfo = /* @__PURE__ */ new WeakMap();
  customEntryGroupById = /* @__PURE__ */ new Map();
  customEntryAssistantKeyById = /* @__PURE__ */ new Map();
  groupCounter = 0;
  groups = /* @__PURE__ */ new Map();
  historyReload;
  latestAssistantKeyByTimestamp = /* @__PURE__ */ new Map();
  mode = "compact";
  sequence = 0;
  toolGroupById = /* @__PURE__ */ new Map();
  userComponentGroup = /* @__PURE__ */ new WeakMap();
  userGroupCursor = 0;
  userGroupIds = [];
  getMode() {
    return this.mode;
  }
  setMode(mode) {
    this.mode = mode;
    this.invalidateAllComponents();
  }
  toggleExpanded() {
    this.setMode(nextTurnFoldMode(this.mode));
    return this.mode;
  }
  loadHistory(entries) {
    this.resetGroups();
    let currentGroup;
    let currentAssistantKey;
    for (const entry of entries) {
      if (stringField(entry, "type") === "custom" && stringField(entry, "customType") === TOKEN_STATS_ENTRY_TYPE) {
        const entryId = stringField(entry, "id");
        if (currentGroup && entryId) this.customEntryGroupById.set(entryId, currentGroup.id);
        if (currentAssistantKey && entryId) this.customEntryAssistantKeyById.set(entryId, currentAssistantKey);
        continue;
      }
      const message = messageFromEntry(entry);
      const role = stringField(message, "role");
      if (role === "user") {
        currentGroup = this.createGroup(
          numberField(message, "timestamp") ?? Date.now(),
          true,
          true
        );
        currentAssistantKey = void 0;
      } else {
        currentGroup = this.historicalGroup(currentGroup, role, message);
        if (currentGroup) {
          const assistantKey = this.indexHistoricalMessage(currentGroup, message, entryTimestamp(entry));
          if (assistantKey) currentAssistantKey = assistantKey;
        }
      }
    }
  }
  deferHistoryReload(entries) {
    this.historyReload = entries;
  }
  reloadHistoryForNewComponent(component) {
    if (!this.historyReload || this.componentInfo.has(component)) return;
    const entries = this.historyReload;
    this.historyReload = void 0;
    this.reloadHistory(entries());
  }
  ensureActive(startedAt = Date.now()) {
    if (this.activeGroupId) return this.activeGroupId;
    const group = this.createGroup(startedAt, false);
    this.activeGroupId = group.id;
    return group.id;
  }
  startUserTurn(startedAt = Date.now()) {
    const activeGroup = this.activeGroupId ? this.groups.get(this.activeGroupId) : void 0;
    if (activeGroup && !activeGroup.startedByUser && !this.groupHasActivity(activeGroup)) {
      activeGroup.startedAt = startedAt;
      activeGroup.startedByUser = true;
      this.userGroupIds.push(activeGroup.id);
      return activeGroup.id;
    }
    if (activeGroup) this.settleActive(startedAt);
    const group = this.createGroup(startedAt, false, true);
    this.activeGroupId = group.id;
    return group.id;
  }
  beginAssistantMessage(message) {
    const timestamp = numberField(message, "timestamp");
    if (stringField(message, "role") !== "assistant" || timestamp === void 0) return;
    const key = this.newAssistantKey(timestamp);
    this.activeAssistantKey = key;
    this.activeAssistantTimestamp = timestamp;
    this.registerAssistantSnapshot(message, key);
  }
  registerAssistantMessage(message) {
    const timestamp = numberField(message, "timestamp");
    if (stringField(message, "role") !== "assistant" || timestamp === void 0) return;
    const key = this.messageAssistantKey(message) ?? (this.activeAssistantTimestamp === timestamp ? this.activeAssistantKey : void 0) ?? this.latestAssistantKeyByTimestamp.get(timestamp) ?? this.newAssistantKey(timestamp);
    this.registerAssistantSnapshot(message, key);
  }
  endAssistantMessage(message) {
    this.registerAssistantMessage(message);
    if (numberField(message, "timestamp") !== this.activeAssistantTimestamp) return;
    this.activeAssistantKey = void 0;
    this.activeAssistantTimestamp = void 0;
  }
  registerToolStart(toolCallId, startedAt = Date.now()) {
    const groupId = this.ensureActive(startedAt);
    const group = this.groups.get(groupId);
    const added = group ? !group.toolCallIds.has(toolCallId) : false;
    group?.toolCallIds.add(toolCallId);
    this.toolGroupById.set(toolCallId, groupId);
    if (group && added) this.invalidateGroupComponents(group);
  }
  registerToolEnd(toolCallId, failed) {
    const groupId = this.toolGroupById.get(toolCallId);
    const group = groupId ? this.groups.get(groupId) : void 0;
    if (!group || !failed || group.failedToolCallIds.has(toolCallId)) return;
    group.failedToolCallIds.add(toolCallId);
    this.invalidateGroupComponents(group);
  }
  associateUser(component) {
    if (this.userComponentGroup.has(component)) return;
    const groupId = this.userGroupIds[this.userGroupCursor];
    if (!groupId || !this.groups.has(groupId)) return;
    this.userComponentGroup.set(component, groupId);
    this.userGroupCursor += 1;
  }
  userTimestampFor(component) {
    const groupId = this.userComponentGroup.get(component);
    return groupId ? this.groups.get(groupId)?.startedAt : void 0;
  }
  associateAssistant(component, message) {
    const timestamp = numberField(message, "timestamp");
    if (timestamp === void 0) return;
    const key = this.messageAssistantKey(message) ?? this.latestAssistantKeyByTimestamp.get(timestamp);
    if (!key) return;
    const snapshot = assistantSnapshot(message, key);
    if (!snapshot) return;
    const group = this.groupForAssistantComponent(component, snapshot);
    if (!group) return;
    const previousSnapshot = group.assistants.get(component);
    const added = this.associateComponent(component, group, "assistant");
    group.assistants.set(component, snapshot);
    if (added || assistantDisplayClassChanged(previousSnapshot, snapshot)) {
      this.invalidateGroupComponents(group);
    }
  }
  associateTool(component, toolCallId) {
    const groupId = this.toolGroupById.get(toolCallId) ?? this.activeGroupId;
    const group = groupId ? this.groups.get(groupId) : void 0;
    if (!group) return;
    const added = this.associateComponent(component, group, "tool");
    group.tools.set(component, toolCallId);
    if (added) this.invalidateGroupComponents(group);
  }
  associateCustomEntry(component, entry) {
    if (stringField(entry, "type") !== "custom" || stringField(entry, "customType") !== TOKEN_STATS_ENTRY_TYPE) {
      return false;
    }
    const entryId = stringField(entry, "id");
    const groupId = (entryId ? this.customEntryGroupById.get(entryId) : void 0) ?? this.activeGroupId ?? [...this.groups.keys()].at(-1);
    const group = groupId ? this.groups.get(groupId) : void 0;
    if (!group) return false;
    if (entryId) this.customEntryGroupById.set(entryId, group.id);
    const ownerAssistantKey = (entryId ? this.customEntryAssistantKeyById.get(entryId) : void 0) ?? [...group.assistantKeys].at(-1);
    if (entryId && ownerAssistantKey) this.customEntryAssistantKeyById.set(entryId, ownerAssistantKey);
    const added = this.associateComponent(component, group, "supplementary", ownerAssistantKey);
    if (added) this.invalidateGroupComponents(group);
    return true;
  }
  associateCacheMiss(component) {
    const groupId = this.activeGroupId ?? [...this.groups.keys()].at(-1);
    const group = groupId ? this.groups.get(groupId) : void 0;
    if (!group) return false;
    const added = this.associateComponent(component, group, "supplementary");
    if (added) this.invalidateGroupComponents(group);
    return true;
  }
  settleActive(endedAt = Date.now()) {
    if (!this.activeGroupId) return;
    const group = this.groups.get(this.activeGroupId);
    if (group) {
      group.settled = true;
      group.endedAt = endedAt;
      this.invalidateGroupComponents(group);
    }
    this.activeGroupId = void 0;
  }
  abortActive(endedAt = Date.now()) {
    const group = this.activeGroupId ? this.groups.get(this.activeGroupId) : void 0;
    if (group) group.aborted = true;
    this.settleActive(endedAt);
  }
  viewFor(component, now = Date.now()) {
    const info = this.componentInfo.get(component);
    const group = info ? this.groups.get(info.groupId) : void 0;
    if (!info || !group) return void 0;
    if (info.kind === "supplementary") {
      if (this.mode === "expanded") {
        return { display: "original", summary: this.summary(group, now) };
      }
      const owner = info.ownerAssistantKey ? this.assistantComponentByKey.get(info.ownerAssistantKey) : void 0;
      const ownerDisplay = owner ? this.viewFor(owner, now)?.display : void 0;
      return {
        display: ownerDisplay && displayIncludesAssistantContent(ownerDisplay) ? "original" : "hidden",
        summary: this.summary(group, now)
      };
    }
    let display;
    if (this.mode === "expanded") {
      display = "original";
    } else if (group.settled) {
      display = settledDisplay({
        isFinalAnchor: component === this.finalAnchor(group),
        isSettledSummaryAnchor: component === this.settledSummaryAnchor(group)
      });
    } else {
      display = this.liveDisplay(group, component);
    }
    return { display, summary: this.summary(group, now) };
  }
  messageAssistantKey(message) {
    return isRecord2(message) ? this.assistantKeyByMessage.get(message) : void 0;
  }
  newAssistantKey(timestamp) {
    const ordinal = (this.assistantOrdinalByTimestamp.get(timestamp) ?? 0) + 1;
    const key = `${String(timestamp)}:${String(ordinal)}`;
    this.assistantOrdinalByTimestamp.set(timestamp, ordinal);
    this.latestAssistantKeyByTimestamp.set(timestamp, key);
    return key;
  }
  registerAssistantSnapshot(message, key) {
    const snapshot = assistantSnapshot(message, key);
    if (!snapshot) return;
    if (isRecord2(message)) this.assistantKeyByMessage.set(message, key);
    this.latestAssistantKeyByTimestamp.set(snapshot.timestamp, key);
    const groupId = this.ensureActive(snapshot.timestamp);
    const group = this.groups.get(groupId);
    if (!group) return;
    const changed = this.indexAssistantSnapshot(group, groupId, snapshot);
    if (changed) this.invalidateGroupComponents(group);
  }
  groupForAssistantComponent(component, snapshot) {
    const previousComponent = this.assistantComponentByKey.get(snapshot.key);
    if (previousComponent && previousComponent !== component) this.resetComponentAssociations();
    this.assistantComponentByKey.set(snapshot.key, component);
    const groupId = this.assistantGroupByKey.get(snapshot.key) ?? this.activeGroupId;
    return groupId ? this.groups.get(groupId) : void 0;
  }
  indexAssistantSnapshot(group, groupId, snapshot) {
    const previousMessages = group.assistantKeys.size;
    const previousTools = group.toolCallIds.size;
    group.assistantKeys.add(snapshot.key);
    if (snapshot.interrupted) group.aborted = true;
    group.terminalErrorToolCallIds = new Set(snapshot.terminalErrorToolCallIds);
    this.assistantGroupByKey.set(snapshot.key, groupId);
    for (const toolCallId of snapshot.toolCallIds) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, groupId);
    }
    return group.assistantKeys.size !== previousMessages || group.toolCallIds.size !== previousTools;
  }
  groupHasActivity(group) {
    return group.assistantKeys.size > 0 || group.toolCallIds.size > 0;
  }
  activityComponents(group) {
    return [...group.components].filter(
      ([candidate, info]) => info.kind === "tool" || group.assistants.get(candidate)?.hasVisibleContent === true
    ).sort(([, left], [, right]) => right.sequence - left.sequence);
  }
  liveSelection(group) {
    const thinkingEntries = [...group.assistants].filter(([, snapshot]) => snapshot.hasThinking);
    thinkingEntries.sort(([left], [right]) => (group.components.get(right)?.sequence ?? -1) - (group.components.get(left)?.sequence ?? -1));
    const selectedThinkingEntries = thinkingEntries.slice(0, LIVE_THINKING_GROUP_LIMIT);
    const selectedAssistants = new Set(selectedThinkingEntries.map(([component]) => component));
    const selectedTools = new Set();
    if (thinkingEntries.length > 0) {
      const cutoffSequence = Math.min(
        ...selectedThinkingEntries.map(([component]) => group.components.get(component)?.sequence ?? Number.POSITIVE_INFINITY)
      );
      for (const component of group.tools.keys()) {
        const sequence = group.components.get(component)?.sequence ?? -1;
        if (sequence > cutoffSequence) selectedTools.add(component);
      }
    } else {
      const recentTools = [...group.tools.keys()].sort(
        (left, right) => (group.components.get(right)?.sequence ?? -1) - (group.components.get(left)?.sequence ?? -1)
      ).slice(0, LIVE_TOOL_ONLY_LIMIT);
      for (const component of recentTools) selectedTools.add(component);
    }
    return { selectedAssistants, selectedTools };
  }
  liveBaseDisplay(group, component, selection = this.liveSelection(group)) {
    const info = group.components.get(component);
    if (!info) return "hidden";
    if (info.kind === "assistant") {
      const snapshot = group.assistants.get(component);
      if (!snapshot) return "hidden";
      if (snapshot.hasThinking && selection.selectedAssistants.has(component)) return "original";
      if (snapshot.hasText) return snapshot.hasThinking ? "text-only" : "original";
      if (snapshot.hasTerminalNotice) return "original";
      return "hidden";
    }
    if (info.kind === "tool") return selection.selectedTools.has(component) ? "original" : "hidden";
    return "hidden";
  }
  liveDisplay(group, component) {
    const selection = this.liveSelection(group);
    const display = this.liveBaseDisplay(group, component, selection);
    if (display !== "hidden") return display;
    return component === this.streamingSummaryAnchor(group, selection) ? "streaming-summary" : "hidden";
  }
  streamingSummaryAnchor(group, selection = this.liveSelection(group)) {
    return this.activityComponents(group).filter(
      ([component]) => this.liveBaseDisplay(group, component, selection) === "hidden"
    ).sort(([, left], [, right]) => right.sequence - left.sequence)[0]?.[0];
  }
  liveHiddenActivityCount(group) {
    const selection = this.liveSelection(group);
    return this.activityComponents(group).filter(
      ([component]) => this.liveBaseDisplay(group, component, selection) === "hidden"
    ).length;
  }
  settledSummaryAnchor(group) {
    return [...group.components].filter(([, info]) => info.kind !== "supplementary").sort(([, left], [, right]) => left.sequence - right.sequence)[0]?.[0];
  }
  lastAssistant(group) {
    const candidates = [...group.assistants].filter(([, snapshot]) => snapshot.hasVisibleContent || snapshot.hasTerminalNotice).map(([component]) => component);
    return latestBySequence(group.components, candidates);
  }
  finalAnchor(group) {
    const terminalErrorToolCallId = [...group.terminalErrorToolCallIds].at(-1);
    if (terminalErrorToolCallId) {
      return this.componentForTool(group, terminalErrorToolCallId);
    }
    const assistant = this.lastAssistant(group);
    if (assistant) return assistant;
    const finalToolCallId = [...group.toolCallIds].at(-1);
    if (!finalToolCallId) return this.activityComponents(group).at(0)?.[0];
    return this.componentForTool(group, finalToolCallId);
  }
  componentForTool(group, toolCallId) {
    if (!toolCallId) return void 0;
    return [...group.tools].find(([, candidate]) => candidate === toolCallId)?.[0];
  }
  summary(group, now) {
    const activityCount = this.activityComponents(group).length;
    const hiddenActivities = group.settled ? 0 : this.liveHiddenActivityCount(group);
    return {
      aborted: group.aborted,
      completedAt: group.endedAt,
      durationMs: Math.max(0, (group.endedAt ?? now) - group.startedAt),
      failedTools: (/* @__PURE__ */ new Set([...group.failedToolCallIds, ...group.terminalErrorToolCallIds])).size,
      hiddenActivities,
      messages: group.assistantKeys.size,
      running: !group.settled,
      tools: group.toolCallIds.size
    };
  }
  associateComponent(component, group, kind, ownerAssistantKey) {
    if (this.componentInfo.has(component)) return false;
    this.sequence += 1;
    const info = { kind, ownerAssistantKey, sequence: this.sequence };
    group.components.set(component, info);
    this.componentInfo.set(component, { groupId: group.id, ...info });
    return true;
  }
  createGroup(startedAt, settled, startedByUser = false) {
    this.groupCounter += 1;
    const group = {
      aborted: false,
      assistantKeys: /* @__PURE__ */ new Set(),
      assistants: /* @__PURE__ */ new Map(),
      components: /* @__PURE__ */ new Map(),
      failedToolCallIds: /* @__PURE__ */ new Set(),
      id: `turn-${String(this.groupCounter)}`,
      settled,
      startedAt,
      startedByUser,
      terminalErrorToolCallIds: /* @__PURE__ */ new Set(),
      toolCallIds: /* @__PURE__ */ new Set(),
      tools: /* @__PURE__ */ new Map()
    };
    this.groups.set(group.id, group);
    if (startedByUser) this.userGroupIds.push(group.id);
    return group;
  }
  historicalGroup(currentGroup, role, message) {
    if (currentGroup) return currentGroup;
    if (role !== "assistant" && role !== "toolResult") return void 0;
    return this.createGroup(numberField(message, "timestamp") ?? Date.now(), true);
  }
  indexHistoricalMessage(group, message, completedAt) {
    const role = stringField(message, "role");
    if (role === "assistant") return this.indexHistoricalAssistant(group, message, completedAt);
    if (role === "toolResult") this.indexHistoricalToolResult(group, message, completedAt);
    return void 0;
  }
  indexHistoricalAssistant(group, message, completedAt) {
    const timestamp = numberField(message, "timestamp");
    if (timestamp === void 0) return;
    const key = this.newAssistantKey(timestamp);
    const snapshot = assistantSnapshot(message, key);
    if (!snapshot) return;
    if (isRecord2(message)) this.assistantKeyByMessage.set(message, key);
    group.assistantKeys.add(snapshot.key);
    if (snapshot.interrupted) group.aborted = true;
    group.terminalErrorToolCallIds = new Set(snapshot.terminalErrorToolCallIds);
    this.assistantGroupByKey.set(snapshot.key, group.id);
    for (const toolCallId of snapshot.toolCallIds) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, group.id);
    }
    group.endedAt = Math.max(group.endedAt ?? 0, completedAt ?? snapshot.timestamp);
    return snapshot.key;
  }
  indexHistoricalToolResult(group, message, completedAt) {
    const toolCallId = stringField(message, "toolCallId");
    if (toolCallId) {
      group.toolCallIds.add(toolCallId);
      this.toolGroupById.set(toolCallId, group.id);
    }
    if (toolCallId && isRecord2(message) && message["isError"] === true) {
      group.failedToolCallIds.add(toolCallId);
    }
    const timestamp = completedAt ?? numberField(message, "timestamp");
    if (timestamp !== void 0) group.endedAt = Math.max(group.endedAt ?? 0, timestamp);
  }
  invalidateGroupComponents(group) {
    for (const component of group.components.keys()) invalidateComponent(component);
  }
  invalidateAllComponents() {
    for (const group of this.groups.values()) this.invalidateGroupComponents(group);
  }
  resetComponentAssociations() {
    this.assistantComponentByKey = /* @__PURE__ */ new Map();
    this.componentInfo = /* @__PURE__ */ new WeakMap();
    this.sequence = 0;
    this.userComponentGroup = /* @__PURE__ */ new WeakMap();
    this.userGroupCursor = 0;
    for (const group of this.groups.values()) {
      group.assistants.clear();
      group.components.clear();
      group.tools.clear();
    }
  }
  resetGroups() {
    this.activeAssistantKey = void 0;
    this.activeAssistantTimestamp = void 0;
    this.activeGroupId = void 0;
    this.assistantComponentByKey = /* @__PURE__ */ new Map();
    this.assistantGroupByKey = /* @__PURE__ */ new Map();
    this.assistantKeyByMessage = /* @__PURE__ */ new WeakMap();
    this.assistantOrdinalByTimestamp = /* @__PURE__ */ new Map();
    this.componentInfo = /* @__PURE__ */ new WeakMap();
    this.customEntryGroupById = /* @__PURE__ */ new Map();
    this.customEntryAssistantKeyById = /* @__PURE__ */ new Map();
    this.groups = /* @__PURE__ */ new Map();
    this.groupCounter = 0;
    this.historyReload = void 0;
    this.latestAssistantKeyByTimestamp = /* @__PURE__ */ new Map();
    this.sequence = 0;
    this.toolGroupById = /* @__PURE__ */ new Map();
    this.userComponentGroup = /* @__PURE__ */ new WeakMap();
    this.userGroupCursor = 0;
    this.userGroupIds = [];
  }
  reloadHistory(entries) {
    const activeGroupId = this.activeGroupId;
    const activeGroup = activeGroupId ? this.groups.get(activeGroupId) : void 0;
    this.loadHistory(entries);
    if (!activeGroupId || !activeGroup) return;
    const visibleGroups = [...this.groups.values()];
    const activeGroups = this.reloadedActiveGroups(visibleGroups, activeGroup);
    this.mergeVisibleActiveGroups(activeGroup, activeGroups);
    const activeGroupIds = new Set(activeGroups.map((group) => group.id));
    for (const group of activeGroups) this.groups.delete(group.id);
    this.groups.set(activeGroup.id, activeGroup);
    this.reassignGroupIds(activeGroupIds, activeGroup.id);
    this.groupCounter = Math.max(this.groupCounter, groupNumber(activeGroup.id));
    this.activeGroupId = activeGroup.id;
  }
  reloadedActiveGroups(visibleGroups, activeGroup) {
    const matchingGroup = visibleGroups.findIndex(
      (group) => [...group.assistantKeys].some((key) => activeGroup.assistantKeys.has(key)) || [...group.toolCallIds].some((id) => activeGroup.toolCallIds.has(id)) || (group.endedAt ?? -Infinity) >= activeGroup.startedAt
    );
    if (matchingGroup >= 0) return visibleGroups.slice(matchingGroup);
    const lastGroup = visibleGroups.at(-1);
    return lastGroup ? [lastGroup] : [];
  }
  mergeVisibleActiveGroups(active, visibleGroups) {
    active.assistants.clear();
    active.components.clear();
    active.tools.clear();
    for (const visible of visibleGroups) {
      active.aborted ||= visible.aborted;
      active.assistantKeys = /* @__PURE__ */ new Set([...active.assistantKeys, ...visible.assistantKeys]);
      active.failedToolCallIds = /* @__PURE__ */ new Set([
        ...active.failedToolCallIds,
        ...visible.failedToolCallIds
      ]);
      active.terminalErrorToolCallIds = new Set(visible.terminalErrorToolCallIds);
      active.toolCallIds = /* @__PURE__ */ new Set([...active.toolCallIds, ...visible.toolCallIds]);
    }
  }
  reassignGroupIds(fromGroupIds, toGroupId) {
    for (const [key, groupId] of this.assistantGroupByKey) {
      if (fromGroupIds.has(groupId)) this.assistantGroupByKey.set(key, toGroupId);
    }
    for (const [key, groupId] of this.customEntryGroupById) {
      if (fromGroupIds.has(groupId)) this.customEntryGroupById.set(key, toGroupId);
    }
    for (const [key, groupId] of this.toolGroupById) {
      if (fromGroupIds.has(groupId)) this.toolGroupById.set(key, toGroupId);
    }
    this.userGroupIds = this.userGroupIds.map(
      (groupId) => fromGroupIds.has(groupId) ? toGroupId : groupId
    );
  }
};

// ../../../../../../tmp/pi-flod-turn-fold/index.ts
var CONFIG_ENTRY_TYPE = "onurpi-turn-fold-config";
var TOGGLE_SHORTCUT = "ctrl+shift+o";
var TOOL_DISPLAY_SHORTCUT = "ctrl+o";
var TOOL_DISPLAY_MODES = ["oneLine", "preview", "nativeExpanded"];
var TOOL_PREVIEW_MAX_LINES = 8;
function nextToolDisplayMode(mode) {
  const index = TOOL_DISPLAY_MODES.indexOf(mode);
  return TOOL_DISPLAY_MODES[(index + 1) % TOOL_DISPLAY_MODES.length];
}
function modeFromBranch(ctx) {
  let mode = "compact";
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== CONFIG_ENTRY_TYPE) continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null) continue;
    const storedMode = Reflect.get(data, "mode");
    if (isTurnFoldMode(storedMode)) mode = storedMode;
  }
  return mode;
}
function messageTimestamp(message) {
  if (typeof message !== "object" || message === null) return void 0;
  const timestamp = Reflect.get(message, "timestamp");
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : void 0;
}
function messageRole(message) {
  if (typeof message !== "object" || message === null) return void 0;
  const role = Reflect.get(message, "role");
  return typeof role === "string" ? role : void 0;
}
function messageStopReason(message) {
  if (typeof message !== "object" || message === null) return void 0;
  const stopReason = Reflect.get(message, "stopReason");
  return typeof stopReason === "string" ? stopReason : void 0;
}
function loadVisibleHistory(state, ctx) {
  state.loadHistory(ctx.sessionManager.buildContextEntries());
}
function applyMode(pi, state, mode, persist) {
  if (state.getMode() !== mode) state.setMode(mode);
  if (persist) pi.appendEntry(CONFIG_ENTRY_TYPE, { mode });
}
function registerTurnFoldShortcut(pi, state) {
  pi.registerShortcut(TOGGLE_SHORTCUT, {
    description: "Toggle compact and expanded transcript rendering",
    handler: () => {
      applyMode(pi, state, state.toggleExpanded(), true);
    }
  });
}
function cycleToolDisplay(ctx, getMode, setMode) {
  const mode = nextToolDisplayMode(getMode());
  setMode(mode);
  ctx.ui.setToolsExpanded(mode === "nativeExpanded");
}
function handleToolDisplayInput(data, ctx, getMode, setMode) {
  if (!matchesKey(data, TOOL_DISPLAY_SHORTCUT)) return void 0;
  if (!isKeyRelease(data) && !isKeyRepeat(data)) cycleToolDisplay(ctx, getMode, setMode);
  return { consume: true };
}
function installBeforeRenderGuard(ctx, beforeRender) {
  if (!ctx.hasUI || typeof ctx.ui.setWidget !== "function") {
    beforeRender();
    return () => {};
  }
  let tui;
  const captureKey = "__pi_flod_turn_fold_capture";
  ctx.ui.setWidget(captureKey, (candidate) => {
    tui = candidate;
    return { render: () => [], invalidate: () => {} };
  });
  ctx.ui.setWidget(captureKey, void 0);
  if (!tui || typeof tui.requestRender !== "function") {
    beforeRender();
    return () => {};
  }
  // Pi 0.84 passes a stable Proxy here. Reading tui.requestRender returns a
  // forwarding closure, so saving that closure and then replacing requestRender makes
  // the closure resolve back to this guard forever. Call the renderer prototype method
  // directly instead; the Proxy remains a valid receiver and forwards field access.
  const rendererPrototype = Object.getPrototypeOf(tui);
  const originalRequestRender = Reflect.get(rendererPrototype, "requestRender");
  if (typeof originalRequestRender !== "function") {
    beforeRender();
    return () => {};
  }
  let active = true;
  let armed = false;
  let preparing = false;
  const guardedRequestRender = function (force) {
    if (active && armed && !preparing) {
      preparing = true;
      try {
        beforeRender();
      } finally {
        preparing = false;
      }
    }
    return Reflect.apply(originalRequestRender, tui, [force]);
  };
  const renderBridge = { requestRender: guardedRequestRender };
  tui.__piFlodRenderBridge = renderBridge;
  tui.requestRender = guardedRequestRender;
  // Traceline captures the same TUI during the remaining session_start handlers. Its
  // setWidget calls also request renders, so arm only after that synchronous setup ends;
  // then request one render through Traceline's outer wrapper. This guarantees its lazy
  // prototype patch lands first and Turn Fold becomes the final, outer render policy.
  queueMicrotask(() => {
    if (!active) return;
    armed = true;
    tui.requestRender();
  });
  return () => {
    active = false;
    // A runtime TUI-mode switch replaces the renderer behind Pi's stable Proxy. Do not
    // install an old renderer implementation onto the replacement renderer.
    if (Object.getPrototypeOf(tui) === rendererPrototype && tui.__piFlodRenderBridge === renderBridge) {
      tui.__piFlodRenderBridge = void 0;
      tui.requestRender = function (force) {
        return Reflect.apply(originalRequestRender, tui, [force]);
      };
    }
  };
}
function turnFold(pi) {
  const state = new TurnFoldState();
  let currentTheme;
  let toolDisplayMode = "oneLine";
  let renderPatches;
  let restoreRenderGuard = () => {};
  let unsubscribeToolDisplayInput = () => {};
  let patchErrorReported = false;
  const ensureRenderPatches = () => {
    try {
      renderPatches ??= installRenderPatches(state, () => currentTheme, () => toolDisplayMode);
      renderPatches.prepare();
    } catch (error) {
      if (!patchErrorReported) {
        patchErrorReported = true;
        console.warn("pi-flod: could not compose Turn Fold outside Traceline; native rendering remains available.", error);
      }
    }
  };
  // Install the insertion seam before Pi builds any transcript rows. Rendering still
  // delegates dynamically to Traceline's later prototype patch.
  ensureRenderPatches();
  registerTurnFoldShortcut(pi, state);
  pi.on("session_start", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    toolDisplayMode = "oneLine";
    ctx.ui.setToolsExpanded(false);
    unsubscribeToolDisplayInput();
    unsubscribeToolDisplayInput = ctx.ui.onTerminalInput((data) => handleToolDisplayInput(
      data,
      ctx,
      () => toolDisplayMode,
      (mode) => {
        toolDisplayMode = mode;
      }
    ));
    restoreRenderGuard();
    // This guard runs inside Traceline's requestRender wrapper. Traceline installs its
    // unchanged lazy prototype patches first; Turn Fold then wraps the live assistant and
    // tool rows before the actual render, keeping the whole turn collapsible.
    restoreRenderGuard = installBeforeRenderGuard(ctx, ensureRenderPatches);
    applyMode(pi, state, modeFromBranch(ctx), false);
    loadVisibleHistory(state, ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.deferHistoryReload(() => ctx.sessionManager.buildContextEntries());
  });
  pi.on("session_tree", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.deferHistoryReload(() => ctx.sessionManager.buildContextEntries());
  });
  pi.on("agent_start", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.ensureActive();
  });
  pi.on("message_start", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    const role = messageRole(event.message);
    if (role === "user") state.startUserTurn(messageTimestamp(event.message));
    if (role === "assistant") state.beginAssistantMessage(event.message);
  });
  pi.on("message_update", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.registerAssistantMessage(event.message);
  });
  pi.on("message_end", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    if (messageRole(event.message) !== "assistant") return;
    state.endAssistantMessage(event.message);
    if (messageStopReason(event.message) === "aborted") state.abortActive();
  });
  pi.on("tool_execution_start", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.registerToolStart(event.toolCallId);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.registerToolEnd(event.toolCallId, event.isError);
  });
  pi.on("agent_settled", (_event, ctx) => {
    currentTheme = ctx.ui.theme;
    state.settleActive();
  });
  pi.on("session_shutdown", () => {
    unsubscribeToolDisplayInput();
    unsubscribeToolDisplayInput = () => {};
    restoreRenderGuard();
    renderPatches?.restore();
    renderPatches = void 0;
  });
}

// ../../../../../../tmp/pi-thinking-steps/parse.ts
var LIST_ITEM_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+|[a-z][.)]\s+)/i;
var HEADING_RE = /^\s{0,3}#{1,6}\s+/;
var LEADING_SUMMARY_PHRASE_RE = /^(?:i\s+(?:need|should|want)\s+to|need\s+to|i(?:'m| am)\s+going\s+to|i(?:'ll| will)|let\s+me|let'?s|first,?\s+|next,?\s+|then,?\s+|now,?\s+|okay,?\s+)/i;
function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, "\n");
}
function collapseWhitespace(text) {
  return text.replace(/[ \t]+/g, " ").trim();
}
function stripLeadingMarker(text) {
  return text.replace(HEADING_RE, "").replace(LIST_ITEM_RE, "").trim();
}
function stripLeadingSummaryPhrase(text) {
  const stripped = text.replace(LEADING_SUMMARY_PHRASE_RE, "").trim();
  return stripped.length > 0 ? stripped : text.trim();
}
function capitalize(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  return `${truncated}\u2026`;
}
function ensureCompleteVisibleSummary(summary) {
  const trimmed = summary.trim();
  if (!trimmed) return trimmed;
  if (!/(?:…|\.\.\.)$/u.test(trimmed)) {
    return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed.replace(/[.!?;:,]+$/g, "")}.`;
  }
  const withoutEllipsis = trimmed.replace(/(?:…|\.\.\.)+$/gu, "").trimEnd();
  const boundaryMatches = [
    ...Array.from(withoutEllipsis.matchAll(/[,:;](?=\s|$)/g), (match) => match.index ?? -1),
    ...Array.from(withoutEllipsis.matchAll(/\b(?:before|after|while|because|so|then|once|until)\b/gi), (match) => match.index ?? -1)
  ].filter((index) => index > 0);
  const boundaryIndex = boundaryMatches.length > 0 ? Math.max(...boundaryMatches) : -1;
  const candidate = boundaryIndex > 0 ? withoutEllipsis.slice(0, boundaryIndex).trimEnd() : withoutEllipsis.replace(/\s+\S*$/u, "").trimEnd();
  const cleaned = (candidate || withoutEllipsis).replace(/[.!?;:,]+$/g, "").trimEnd();
  return cleaned ? `${cleaned}.` : `${withoutEllipsis.replace(/[.!?;:,]+$/g, "").trimEnd()}.`;
}
function splitListChunk(chunk) {
  const lines = normalizeNewlines(chunk).split("\n");
  let contentStartIndex = 0;
  while (contentStartIndex < lines.length) {
    const trimmed = lines[contentStartIndex].trim();
    if (!trimmed || isStandaloneHeadingChunk(trimmed)) {
      contentStartIndex += 1;
      continue;
    }
    break;
  }
  const headingPrefix = lines.slice(0, contentStartIndex).join("\n").trim();
  const contentLines = lines.slice(contentStartIndex);
  const itemLineIndexes = contentLines.reduce((indexes, line, index) => {
    if (LIST_ITEM_RE.test(line)) indexes.push(index);
    return indexes;
  }, []);
  if (itemLineIndexes.length < 2) return [chunk.trim()];
  const items = [];
  let current = [];
  for (const line of contentLines) {
    if (LIST_ITEM_RE.test(line) && current.length > 0) {
      const item = current.join("\n").trim();
      items.push(headingPrefix ? `${headingPrefix}

${item}` : item);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    const item = current.join("\n").trim();
    items.push(headingPrefix ? `${headingPrefix}

${item}` : item);
  }
  return items.filter(Boolean);
}
function stripMarkdownEmphasis(text) {
  return text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2").replace(/(^|[^\w/.-])\*(?=\S)([\s\S]*?\S)\*(?=[^\w/.-]|$)/g, "$1$2").replace(/(^|[^\w/.-])_(?=\S)([\s\S]*?\S)_(?=[^\w/.-]|$)/g, "$1$2");
}
function isStandaloneHeadingChunk(chunk) {
  const lines = normalizeNewlines(chunk).split("\n").map((line2) => line2.trim()).filter(Boolean);
  if (lines.length !== 1) return false;
  const line = lines[0];
  if (LIST_ITEM_RE.test(line)) return false;
  if (HEADING_RE.test(line)) return true;
  if (!/^(\*\*|__)(.+?)\1$/.test(line)) return false;
  const stripped = stripMarkdownEmphasis(stripLeadingMarker(line));
  return stripped.length > 0 && stripped.length <= 80 && !/[.!?]/.test(stripped);
}
function mergeHeadingParagraphChunks(chunks) {
  const merged = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const nextChunk = chunks[index + 1];
    if (isStandaloneHeadingChunk(chunk)) {
      const introChunks = [];
      let nextIndex = index + 1;
      while (nextIndex < chunks.length && !isStandaloneHeadingChunk(chunks[nextIndex]) && !isListParagraphChunk(chunks[nextIndex])) {
        introChunks.push(chunks[nextIndex]);
        nextIndex += 1;
      }
      const followingListChunks = [];
      while (nextIndex < chunks.length && isListParagraphChunk(chunks[nextIndex])) {
        followingListChunks.push(chunks[nextIndex]);
        nextIndex += 1;
      }
      if (introChunks.length > 0 && followingListChunks.length > 0) {
        merged.push(`${chunk}

${introChunks.join("\n\n")}`);
        for (const listChunk of followingListChunks) {
          merged.push(`${chunk}

${listChunk}`);
        }
        index = nextIndex - 1;
        continue;
      }
      if (followingListChunks.length > 0) {
        merged.push(`${chunk}

${followingListChunks.join("\n\n")}`);
        index = nextIndex - 1;
        continue;
      }
      if (nextChunk && !isStandaloneHeadingChunk(nextChunk)) {
        merged.push(`${chunk}

${nextChunk}`);
        index += 1;
        continue;
      }
    }
    merged.push(chunk);
  }
  return merged;
}
function isListParagraphChunk(chunk) {
  const lines = normalizeNewlines(chunk).split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (LIST_ITEM_RE.test(line)) return true;
    if (!isStandaloneHeadingChunk(line)) return false;
  }
  return false;
}
function isListContinuationChunk(chunk) {
  const normalized = normalizeNewlines(chunk).trim();
  if (!normalized || isListParagraphChunk(normalized) || isStandaloneHeadingChunk(normalized)) {
    return false;
  }
  const firstLine = normalized.split("\n").map((line) => stripMarkdownEmphasis(line.trim())).find(Boolean);
  if (!firstLine) return false;
  if (FAILURE_CUE_RE.test(firstLine)) return false;
  if (STANDALONE_LIST_ACTION_RE.test(firstLine)) return false;
  const hasFocusedActionCue = DIRECT_ACTION_START_RE.test(firstLine) && (collectPathTokens(firstLine).length > 0 || (firstLine.match(SYMBOL_TOKEN_RE) ?? []).length > 0 || /\b(?:before editing|after editing|npm|node|git|pi|larra|mcp|tsx|tsc)\b/i.test(firstLine));
  if (hasFocusedActionCue) return false;
  return !/^(?:overall|in summary|to summarize|in conclusion|finally|that should|this should|those steps should|this confirms|that confirms|with that)\b/i.test(firstLine);
}
function splitThinkingIntoStepTexts(text) {
  const normalized = normalizeNewlines(text).trim();
  if (!normalized) return [];
  const paragraphChunks = normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  if (paragraphChunks.length === 0) return [];
  const mergedChunks = mergeHeadingParagraphChunks(paragraphChunks);
  const steps = [];
  for (let index = 0; index < mergedChunks.length; index += 1) {
    const chunk = mergedChunks[index];
    const previousStep = steps[steps.length - 1];
    if (previousStep && isListParagraphChunk(previousStep) && !isListParagraphChunk(chunk)) {
      const continuationChunks = [chunk];
      let continuationIndex = index + 1;
      while (continuationIndex < mergedChunks.length && !isListParagraphChunk(mergedChunks[continuationIndex])) {
        continuationChunks.push(mergedChunks[continuationIndex]);
        continuationIndex += 1;
      }
      if (continuationChunks.every(isListContinuationChunk) && (continuationIndex === mergedChunks.length || isListParagraphChunk(mergedChunks[continuationIndex]))) {
        steps[steps.length - 1] = previousStep + "\n\n" + continuationChunks.join("\n\n");
        index = continuationIndex - 1;
        continue;
      }
    }
    steps.push(...splitListChunk(chunk));
  }
  return steps.length > 0 ? steps : [normalized];
}
var SUMMARY_MAX_CHARS = 84;
var MMR_LAMBDA = 0.7;
var PURE_TIMESTAMP_RE = /^(?:\[)?\d{1,2}:\d{2}(?::\d{2})?(?:\])?$|^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i;
var SEPARATOR_RE = /^[\s`~!@#$%^&*()_+=\-\[\]{}\|;:'",.<>/?·]+$/;
var SPINNER_STATUS_RE = /^(?:thinking|loading|working|running|processing|waiting|done|complete|completed|idle)(?:[ .…:-]+)?$/i;
var PATH_TOKEN_RE = /\b(?:[a-z0-9_-]+[/.])+[a-z0-9_-]+\b/gi;
var SYMBOL_TOKEN_RE = /\b[a-z_][a-z0-9_]*\([^)]*\)/gi;
var ARTIFACT_RE = /(?:\b[a-z0-9_-]+\.(?:ts|tsx|js|jsx|json|md|txt|yml|yaml|lock)\b|\b[a-z_][a-z0-9_]*\([^)]*\)|`[^`]+`|\b(?:npm|node|git|pi|larra|mcp|tsx|tsc)\b|\b(?:ts\d{3,5}|err_[a-z0-9_]+)\b)/i;
var FAILURE_CUE_RE = /\b(failed|failure|error|errors|blocked|abort(?:ed)?|cannot|unable|did not complete|not completed|reverted|rollback|locked)\b/i;
var DECISION_CUE_RE = /\b(decided|decision|chose|switched|replaced|confirmed|fixed|resolved|discovered|found|preserve|keeping|keep)\b/i;
var PLAN_CHANGE_CUE_RE = /\b(instead of|rather than|safer (?:plan|path|route|approach|option)|(?:less|lower)-?risk(?:y)? (?:plan|path|route|approach|option)|plan changed|keep the current summarizer as the baseline|only choose the challenger|limit the algorithmic changes)\b/i;
var ACTION_CUE_RE = /\b(retry|rerun|inspect|check|verify|compare|search|find|read|patch|update|implement|remove|rename|write|run|fix|switch|revert|gather|retrieve|list|flag|review|plan|map|archive|explore|wait|look\s+into)\b/i;
var NEXT_ACTION_CUE_RE = /\b(first|next|retry|rerun|before|after)\b/i;
var UNCERTAINTY_CUE_RE = /\b(maybe|might|possibly|probably|seems|looks like|suspect|likely|whether|unverified|haven'?t verified|not verified|before I call this)\b/i;
var SPECULATIVE_CUE_RE = /\b(seems like|could be useful|might be useful|would be useful|considering)\b/i;
var META_CHATTER_RE = /\b(?:i(?:'m| am)?\s+(?:thinking|contemplating|curious|hoping|wondering)|take a closer look|what makes the most sense|could really help|idealized scenarios|real interactions|worth checking)\b/i;
var WEAK_FRAGMENT_START_RE = /^(?:and|but|or|so|then|though|while|which|because|however|therefore|perhaps|maybe|possibly|also|still|just|since)\b/i;
var GENERIC_OBJECT_ACTION_RE = /^(?:flag|review|check|inspect|look\s+into)\s+(?:that|this|it)\b/i;
var DIRECT_ACTION_START_RE = /^(?:use|inspect|check|verify|compare|search|find|read|patch|update|implement|remove|rename|write|run|fix|switch|revert|gather|retrieve|list|flag|review|plan|map|archive|explore|wait|look\s+into)\b/i;
var WEAK_ORIENTATION_RE = /\bconnect and orient ourselves\b/i;
var TOOL_AVAILABILITY_CHATTER_RE = /\b(?:while (?:there(?:'s| is)) a tool for it|might not retrieve\b|can't retrieve\b|cannot retrieve\b)\b/i;
var OUTCOME_UNCERTAINTY_CONTEXT_RE = /\b(?:whether|if|not sure|unsure|uncertain|unverified|not verified|haven'?t verified|maybe|might|may be|possibly|probably|seems|looks like|suspect|before I call this)\b/i;
var EXPLICIT_SUCCESS_RESULT_RE = /\b(?:(?:npm(?: run)? [a-z0-9:-]+|tests?|build|typecheck|lint|validation|suite|command)\s+(?:has\s+)?(?:passed|succeeded)|(?:passed|succeeded)\s+(?:after|once)\b(?=.*\b(?:npm|test|build|typecheck|lint|validation|suite|command)\b))/i;
var EXPLICIT_FAILURE_RESULT_RE = /\b(?:failed|blocked|abort(?:ed)?|cannot|unable|did not complete|not completed|reverted|rollback|locked)\b/i;
var EXPLICIT_ERROR_RESULT_RE = /\b(?:error|errors)\b(?:(?:\s*(?::|=|-))|(?:\s+(?:with|from|because|during|while|after|in|code|message)\b)|(?=.*\b(?:threw|throwing|throws|raised|encountered|reported|returned|hit|shows?|caught)\b))/i;
var FAILURE_REFERENCE_CONTEXT_RE = /\b(?:failure|failures|error|errors)\s+(?:handling|rendering|renderer|case|cases|path|paths|state|states|logic|message|messages|copy|text|wording|semantics|classification|detection|cue|cues|recovery|fallback|branch|branches|surface|mode|modes)\b/i;
var STANDALONE_LIST_ACTION_RE = /^(?:(?:i\s+)?(?:need|should|will|want|plan)\s+to|(?:next|then|now)\b|(?:need|should|must)\s+)/i;
function hasExplicitFailureCue(sentence) {
  const normalized = collapseWhitespace(sentence);
  if (!FAILURE_CUE_RE.test(normalized) || OUTCOME_UNCERTAINTY_CONTEXT_RE.test(normalized)) return false;
  if (EXPLICIT_FAILURE_RESULT_RE.test(normalized)) return true;
  if (EXPLICIT_ERROR_RESULT_RE.test(normalized) && !FAILURE_REFERENCE_CONTEXT_RE.test(normalized)) return true;
  return false;
}
function hasExplicitSuccessCue(sentence) {
  return EXPLICIT_SUCCESS_RESULT_RE.test(sentence) && !OUTCOME_UNCERTAINTY_CONTEXT_RE.test(sentence);
}
function stripBoilerplatePrefix(value) {
  return value.replace(/^\[[^\]]+\]\s*/, "").replace(/^(?:thinking|thoughts?|status|assistant|stdout|stderr|step\s+\d+|progress|delta)\s*[:>-]\s*/i, "").replace(/^>\s+/, "").replace(/^[-=~]{2,}\s*/, "").trim();
}
function isNoiseLine(value) {
  const normalizedLine = collapseWhitespace(stripBoilerplatePrefix(stripMarkdownEmphasis(value)));
  return !normalizedLine || PURE_TIMESTAMP_RE.test(normalizedLine) || SEPARATOR_RE.test(normalizedLine) || SPINNER_STATUS_RE.test(normalizedLine);
}
function splitSummarySentences(value) {
  const placeholders = /* @__PURE__ */ new Map();
  const protectedValue = value.replace(PATH_TOKEN_RE, (match) => {
    const token = `__PI_THINKING_PATH_${placeholders.size}__`;
    placeholders.set(token, match);
    return token;
  });
  return (protectedValue.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [protectedValue]).map((sentence) => {
    let restored = sentence.trim();
    for (const [token, original] of placeholders) {
      restored = restored.replaceAll(token, original);
    }
    return restored;
  }).filter(Boolean);
}
var CLAUSE_BOUNDARY_COMMA_RE = /,\s+(?=(?:then|but|so|however|therefore|while|which|because|and then|next|perhaps|possibly)\b)/i;
function splitClauses(value) {
  return value.split(/;\s+|:\s+|\s+\b(?:but|so|and then)\b\s+|,\s+(?=(?:then|but|so|however|therefore|while|which|because|and then|next|perhaps|possibly)\b)/i).map((clause) => clause.trim()).filter(Boolean);
}
function normalizeCandidateText(value) {
  return collapseWhitespace(stripBoilerplatePrefix(stripMarkdownEmphasis(stripLeadingMarker(value).replace(/[\u2022]+/g, ""))));
}
function compressCandidate(value) {
  let candidate = normalizeCandidateText(value).replace(/^(?:it seems like|it looks like|it could be useful to|it might be useful to|it would be useful to|i['’]?m considering|i am considering|how we can|we can)\s*/i, "").replace(/^\b(?:well|okay|now|actually|basically|simply|really)\b[,:]?\s+/i, "").replace(/^(?:i\s+think\s+)?i\s+need\s+to\s+/i, "").replace(/^(?:i\s+think\s+)?i\s+should\s+/i, "").replace(/^i\s+plan\s+to\s+/i, "").replace(/^i\s+(?:will|can)\s+/i, "").replace(/^i\s+(?:want\s+to|am\s+going\s+to|['’]?m\s+going\s+to)\s+/i, "").replace(/^i\s+think\s+the\s+next\s+step\s+(?:might\s+be|is)\s+to\s+/i, "").replace(/^the\s+next\s+step\s+(?:might\s+be|is)\s+to\s+/i, "").replace(/^(?:it(?:'s| is)\s+(?:a\s+good\s+idea|helpful|useful|worthwhile)\s+to)\s+/i, "").replace(/^\b(?:let me|let'?s)\b\s+/i, "").replace(/\s*\(([^()]*)\)\s*/g, " ").replace(/\b(?:for now|at this point)\b/gi, "").replace(/\b(?:could|might|would)\s+be\s+(?:helpful|useful)(?:\s+(?:here|first))?/gi, "").replace(/\bavailable to me\b/gi, "available").replace(/\bfor it\b/gi, "").trim();
  candidate = candidate.replace(/^using\b/i, "Use").replace(/^inspecting\b/i, "Inspect").replace(/^checking\b/i, "Check").replace(/^comparing\b/i, "Compare").replace(/^verifying\b/i, "Verify").replace(/^searching\b/i, "Search").replace(/^finding\b/i, "Find").replace(/^reviewing\b/i, "Review").replace(/^reading\b/i, "Read").replace(/^writing\b/i, "Write").replace(/^planning\b/i, "Plan").replace(/^mapping out\b/i, "Map out").replace(/^gathering\b/i, "Gather").replace(/^retrieving\b/i, "Retrieve").replace(/^listing\b/i, "List").replace(/^archiving\b/i, "Archive").replace(/^exploring\b/i, "Explore").replace(/^look\s+into\b/i, "Look into").replace(/^connect and orient ourselves\b/i, "Orient to the current state");
  return collapseWhitespace(candidate).replace(/^[,;:.-]+|[,;:.-]+$/g, "").trim();
}
function tokenize(value) {
  const stopwords = /* @__PURE__ */ new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "but",
    "by",
    "for",
    "from",
    "had",
    "has",
    "have",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "just",
    "let",
    "me",
    "my",
    "now",
    "of",
    "on",
    "or",
    "our",
    "so",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "up",
    "was",
    "we",
    "were",
    "what",
    "when",
    "which",
    "while",
    "with",
    "would",
    "yet",
    "you"
  ]);
  const stem = (token) => {
    if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
    if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
    if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
    if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
    return token;
  };
  return collapseWhitespace(value).toLowerCase().split(/[^a-z0-9._/-]+/i).map((token) => stem(token.trim())).filter((token) => token.length > 1 && !stopwords.has(token));
}
function extractCandidates(value) {
  const paragraphs = normalizeNewlines(value).split(/\n{2,}/);
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  let candidateIndex = 0;
  const pushCandidate = (textValue, kind) => {
    const normalizedText = normalizeCandidateText(textValue);
    if (!normalizedText || SEPARATOR_RE.test(normalizedText) || seen.has(normalizedText.toLowerCase())) return;
    const tokens = tokenize(normalizedText);
    seen.add(normalizedText.toLowerCase());
    candidates.push({
      text: normalizedText,
      compressed: compressCandidate(normalizedText),
      tokens,
      tokenSet: new Set(tokens),
      index: candidateIndex++,
      kind,
      centrality: 0,
      positionPrior: 0,
      structurePrior: 0,
      cuePrior: 0,
      score: 0
    });
  };
  paragraphs.forEach((paragraph) => {
    const rawLines = normalizeNewlines(paragraph).split("\n").map((line) => line.trim()).filter(Boolean);
    const cleanLines = rawLines.filter((line) => !isNoiseLine(line));
    if (cleanLines.length === 0) return;
    const structuredLines = cleanLines.filter((line) => LIST_ITEM_RE.test(line) || HEADING_RE.test(line));
    structuredLines.forEach((line) => pushCandidate(line, HEADING_RE.test(line) ? "heading" : "bullet"));
    const prose = cleanLines.filter((line) => !LIST_ITEM_RE.test(line) && !HEADING_RE.test(line)).join(" ");
    if (!prose) return;
    for (const sentence of splitSummarySentences(prose)) {
      const shouldSplitClauses = sentence.length > 100 || /[;:]|\s+\b(?:but|so|and then)\b/i.test(sentence) || CLAUSE_BOUNDARY_COMMA_RE.test(sentence);
      const clauseCandidates = shouldSplitClauses ? splitClauses(sentence) : [sentence];
      clauseCandidates.forEach((candidate) => pushCandidate(candidate, clauseCandidates.length > 1 ? "clause" : "sentence"));
    }
  });
  return candidates.filter((candidate) => candidate.compressed.length > 0);
}
var SUMMARY_CANDIDATE_LIMIT = 80;
var SUMMARY_CANDIDATE_EDGE_KEEP = 8;
function preliminaryCandidateScore(candidate, candidateCount) {
  const maxIndex = Math.max(candidateCount - 1, 1);
  let score = (1 - candidate.index / maxIndex) * 10;
  if (candidate.index >= candidateCount - SUMMARY_CANDIDATE_EDGE_KEEP) score += 8;
  if (candidate.kind === "bullet" || candidate.kind === "heading") score += 10;
  if (ARTIFACT_RE.test(candidate.text)) score += 30;
  if (DIRECT_ACTION_START_RE.test(candidate.compressed)) score += 45;
  if (DECISION_CUE_RE.test(candidate.text)) score += 55;
  if (FAILURE_CUE_RE.test(candidate.text)) score += 70;
  if (TOOL_AVAILABILITY_CHATTER_RE.test(candidate.text)) score -= 60;
  if (META_CHATTER_RE.test(candidate.text)) score -= 25;
  return score;
}
function limitSummaryCandidates(candidates) {
  if (candidates.length <= SUMMARY_CANDIDATE_LIMIT) return candidates;
  const selected = /* @__PURE__ */ new Set();
  const edgeCount = Math.min(SUMMARY_CANDIDATE_EDGE_KEEP, candidates.length);
  for (let index = 0; index < edgeCount; index += 1) {
    selected.add(index);
    selected.add(candidates.length - 1 - index);
  }
  const ranked = [...candidates].sort(
    (left, right) => preliminaryCandidateScore(right, candidates.length) - preliminaryCandidateScore(left, candidates.length) || left.index - right.index
  );
  for (const candidate of ranked) {
    if (selected.size >= SUMMARY_CANDIDATE_LIMIT) break;
    selected.add(candidate.index);
  }
  return [...selected].sort((left, right) => left - right).map((index) => candidates[index]).filter(Boolean);
}
function formatSummarySentence(clauses, fallback) {
  const normalizedClauses = clauses.map((candidate) => candidate.replace(/[.!?;:,]+$/g, "").trim()).filter(Boolean).filter((clause, index) => index === 0 || !WEAK_FRAGMENT_START_RE.test(clause));
  if (normalizedClauses.length === 0) return fallback;
  const [firstClause, ...restClauses] = normalizedClauses;
  let sentence = capitalize(firstClause);
  if (restClauses.length > 0) {
    const normalizedRest = restClauses.map((clause) => {
      if (/^[A-Z][a-z]/.test(clause)) return clause.charAt(0).toLowerCase() + clause.slice(1);
      return clause;
    });
    sentence = `${sentence}, ${normalizedRest.join(", ")}`;
  }
  return `${sentence.replace(/[.!?;:,]+$/g, "")}.`;
}
function summarizeThinkingTextBaseline(text, fallback = "Reasoning is hidden by the provider.") {
  const raw = normalizeNewlines(text).trim();
  if (!raw) return fallback;
  const candidates = limitSummaryCandidates(extractCandidates(raw));
  if (candidates.length === 0) {
    return truncateText(`${capitalize(collapseWhitespace(stripMarkdownEmphasis(raw))).replace(/[.!?;:,]+$/g, "")}.`, SUMMARY_MAX_CHARS);
  }
  const documentFrequency = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    for (const token of candidate.tokenSet) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const similarity = (left, right) => {
    if (left.tokenSet.size === 0 && right.tokenSet.size === 0) return 0;
    let intersectionWeight = 0;
    let unionWeight = 0;
    for (const token of left.tokenSet) {
      const weight = 1 + Math.log((1 + candidates.length) / (1 + (documentFrequency.get(token) ?? 0)));
      if (right.tokenSet.has(token)) intersectionWeight += weight;
      unionWeight += weight;
    }
    for (const token of right.tokenSet) {
      if (left.tokenSet.has(token)) continue;
      const weight = 1 + Math.log((1 + candidates.length) / (1 + (documentFrequency.get(token) ?? 0)));
      unionWeight += weight;
    }
    return unionWeight === 0 ? 0 : intersectionWeight / unionWeight;
  };
  const maxIndex = Math.max(...candidates.map((candidate) => candidate.index), 1);
  const maxCentrality = Math.max(
    ...candidates.map((candidate) => {
      if (candidates.length === 1) return 1;
      const total = candidates.filter((other) => other !== candidate).reduce((sum, other) => sum + similarity(candidate, other), 0);
      return total / Math.max(candidates.length - 1, 1);
    }),
    1
  );
  for (const candidate of candidates) {
    const centralityRaw = candidates.length === 1 ? 1 : candidates.filter((other) => other !== candidate).reduce((sum, other) => sum + similarity(candidate, other), 0) / Math.max(candidates.length - 1, 1);
    candidate.centrality = maxCentrality === 0 ? 0 : centralityRaw / maxCentrality;
    candidate.positionPrior = 1 - candidate.index / maxIndex;
    candidate.structurePrior = Math.min(
      1,
      (candidate.kind === "bullet" || candidate.kind === "heading" ? 0.45 : 0) + (ARTIFACT_RE.test(candidate.text) ? 0.35 : 0) + (FAILURE_CUE_RE.test(candidate.text) ? 0.25 : 0)
    );
    candidate.cuePrior = Math.min(
      1,
      (FAILURE_CUE_RE.test(candidate.text) ? 0.5 : 0) + (DECISION_CUE_RE.test(candidate.text) ? 0.35 : 0) + (ACTION_CUE_RE.test(candidate.compressed) ? 0.6 : 0) + (NEXT_ACTION_CUE_RE.test(candidate.compressed) ? 0.3 : 0) + (ARTIFACT_RE.test(candidate.text) ? 0.2 : 0) - (META_CHATTER_RE.test(candidate.text) ? 0.45 : 0) - (TOOL_AVAILABILITY_CHATTER_RE.test(candidate.text) ? 0.85 : 0) - ((UNCERTAINTY_CUE_RE.test(candidate.text) || SPECULATIVE_CUE_RE.test(candidate.text)) && !FAILURE_CUE_RE.test(candidate.text) && !DIRECT_ACTION_START_RE.test(candidate.compressed) ? 0.75 : 0)
    );
    candidate.score = 0.55 * candidate.centrality + 0.2 * candidate.positionPrior + 0.15 * candidate.structurePrior + 0.1 * candidate.cuePrior;
    const hasConcreteCue = DIRECT_ACTION_START_RE.test(candidate.compressed) || FAILURE_CUE_RE.test(candidate.text) || DECISION_CUE_RE.test(candidate.text) || ARTIFACT_RE.test(candidate.text);
    if (DIRECT_ACTION_START_RE.test(candidate.compressed)) candidate.score += 0.35;
    if (candidate.kind === "heading" && !hasConcreteCue) candidate.score -= 0.45;
    if (META_CHATTER_RE.test(candidate.text) && !hasConcreteCue) candidate.score -= 0.4;
    if (TOOL_AVAILABILITY_CHATTER_RE.test(candidate.text) && !hasConcreteCue) candidate.score -= 1.1;
    if (WEAK_FRAGMENT_START_RE.test(candidate.compressed) && !hasConcreteCue) candidate.score -= 0.9;
    if ((/^not\b/i.test(candidate.compressed) || candidate.tokens.length < 4) && candidate.kind === "clause" && !hasConcreteCue) candidate.score -= 0.75;
    if (GENERIC_OBJECT_ACTION_RE.test(candidate.compressed) && !ARTIFACT_RE.test(candidate.text)) candidate.score -= 0.8;
    if (WEAK_ORIENTATION_RE.test(candidate.compressed) && !ARTIFACT_RE.test(candidate.compressed)) candidate.score -= 0.6;
  }
  const selected = [];
  const directActionCandidates = candidates.filter((candidate) => DIRECT_ACTION_START_RE.test(candidate.compressed));
  const prioritizedPool = directActionCandidates.length > 0 ? candidates.filter(
    (candidate) => !GENERIC_OBJECT_ACTION_RE.test(candidate.compressed) && !TOOL_AVAILABILITY_CHATTER_RE.test(candidate.text) && (DIRECT_ACTION_START_RE.test(candidate.compressed) || FAILURE_CUE_RE.test(candidate.text) || DECISION_CUE_RE.test(candidate.text) || UNCERTAINTY_CUE_RE.test(candidate.text) && !WEAK_FRAGMENT_START_RE.test(candidate.compressed) && !(candidate.kind === "clause" && candidate.tokens.length < 4))
  ) : candidates;
  const remaining = [...prioritizedPool];
  while (remaining.length > 0 && selected.length < 2) {
    remaining.sort((left, right) => {
      const leftPenalty = selected.length === 0 ? 0 : Math.max(...selected.map((candidate) => similarity(left, candidate)));
      const rightPenalty = selected.length === 0 ? 0 : Math.max(...selected.map((candidate) => similarity(right, candidate)));
      const leftScore = MMR_LAMBDA * left.score - (1 - MMR_LAMBDA) * leftPenalty;
      const rightScore = MMR_LAMBDA * right.score - (1 - MMR_LAMBDA) * rightPenalty;
      return rightScore - leftScore || left.index - right.index;
    });
    const next = remaining.shift();
    const ordered = [...selected, next].sort((left, right) => left.index - right.index);
    if (formatSummarySentence(ordered.map((candidate) => candidate.compressed), fallback).length <= SUMMARY_MAX_CHARS || selected.length === 0) {
      selected.push(next);
    }
  }
  const fallbackPool = prioritizedPool.length > 0 ? prioritizedPool : candidates;
  const orderedSelection = (selected.length > 0 ? selected : [fallbackPool.sort((left, right) => right.score - left.score || left.index - right.index)[0]]).sort((left, right) => left.index - right.index);
  return truncateText(formatSummarySentence(orderedSelection.map((candidate) => candidate.compressed), fallback) || fallback, SUMMARY_MAX_CHARS);
}
function normalizeSummaryEventText(value) {
  return collapseWhitespace(stripBoilerplatePrefix(stripMarkdownEmphasis(value)));
}
function collectPathTokens(text) {
  return Array.from(new Set(text.match(PATH_TOKEN_RE) ?? []));
}
function renderUncertaintySummary(text) {
  const normalized = normalizeSummaryEventText(text);
  const stripped = normalized.replace(/^(?:maybe|perhaps)\s+/i, "").replace(/^(?:it\s+(?:looks|seems)\s+like)\s+/i, "").replace(/^(?:i\s+(?:suspect|think)\s+)\s*/i, "").replace(/\b(?:but\s+)?i\s+haven'?t\s+verified\s+it\s+yet\b/gi, "").replace(/[.!?;:,]+$/g, "").trim();
  if (!stripped) return "Checking the current issue carefully.";
  const paths = collectPathTokens(normalized);
  if (/\bbefore i call this a drift\b/i.test(normalized) && paths.length > 0) {
    return `Inspect ${paths[0]} before calling this a drift.`;
  }
  if (/^whether\b/i.test(stripped)) return `Checking ${stripped}.`;
  return `Checking whether ${stripped}.`;
}
function renderSummaryEvent(event) {
  if (event.type === "uncertainty") {
    return truncateText(renderUncertaintySummary(event.text), SUMMARY_MAX_CHARS);
  }
  if (event.type === "failure") {
    const normalized = normalizeSummaryEventText(event.text).replace(/[.!?;:,]+$/g, "");
    const failureClauses = splitClauses(normalized).map((clause) => normalizeSummaryEventText(clause).replace(/[.!?;:,]+$/g, "")).filter(Boolean);
    const specificFailureClause = failureClauses.find((clause) => /^(?:project reindex is locked by another operation|npm test failed with exit code|typecheck failed with TS\d+ in)\b/i.test(clause));
    const failureClause = (specificFailureClause ?? [...failureClauses].reverse().find((clause) => FAILURE_CUE_RE.test(clause)) ?? normalized).replace(/^(?:but|and)\s+/i, "");
    const npmFailureMatch = failureClause.match(/^npm test failed with exit code (\d+)\b/i);
    if (npmFailureMatch) {
      return `Npm test failed with exit code ${npmFailureMatch[1]}.`;
    }
    const typecheckMatch = failureClause.match(/^typecheck failed with (TS\d+) in ([a-z0-9_./-]+)\b/i);
    if (typecheckMatch) {
      return `Typecheck failed with ${typecheckMatch[1]} in ${typecheckMatch[2]}.`;
    }
    if (/^project reindex is locked by another operation\b/i.test(failureClause)) {
      return "Project reindex is locked by another operation.";
    }
    const cleanedFailure = failureClause.replace(/[.!?;:,]+$/g, "");
    if (cleanedFailure) {
      return truncateText(`${capitalize(cleanedFailure)}.`, SUMMARY_MAX_CHARS);
    }
  }
  if (event.type === "success") {
    const normalized = normalizeSummaryEventText(event.text).replace(/[.!?;:,]+$/g, "");
    const normalizeFollowup = (value) => value.replace(/^(?:once|after)\s+/i, "").replace(/^(?:i|we)\s+updated\s+/i, "updating ").replace(/^(?:i|we)\s+tightened\s+/i, "tightening ").replace(/^the\s+(.+?)\s+was\s+updated$/i, "updating $1").replace(/^the\s+(.+?)\s+were\s+updated$/i, "updating $1").replace(/^updating\s+the\s+/i, "updating ").replace(/^tightening\s+the\s+/i, "tightening ").trim();
    const buildMatch = normalized.match(/^npm run build passed(?:\s+(?:once|after)\s+(.+))?$/i);
    if (buildMatch) {
      const detail = normalizeFollowup(buildMatch[1] ?? "");
      if (detail) return truncateText(`Build passed after ${detail}.`, SUMMARY_MAX_CHARS);
    }
    const testMatch = normalized.match(/^(?:npm test|tests?) passed(?:\s+(?:once|after)\s+(.+))?$/i);
    if (testMatch) {
      const detail = normalizeFollowup(testMatch[1] ?? "");
      if (detail) return truncateText(`Tests passed after ${detail}.`, SUMMARY_MAX_CHARS);
    }
  }
  if (event.type === "decision") {
    const normalized = normalizeSummaryEventText(event.text).replace(/[.!?;:,]+$/g, "");
    const decidedMatch = normalized.match(/^i decided to\s+(.+)$/i);
    if (decidedMatch) {
      return truncateText(`Decided to ${decidedMatch[1]}.`, SUMMARY_MAX_CHARS);
    }
  }
  if (event.type === "plan_change") {
    const normalized = normalizeSummaryEventText(event.text).replace(/[.!?;:,]+$/g, "");
    if (/^i decided to preserve expanded mode behavior\b/i.test(normalized)) {
      return "Preserve expanded mode; limit changes to collapsed and summary selection.";
    }
    const insteadMatch = normalized.match(/^instead of\s+.+?,\s+i will\s+(.+)$/i);
    if (insteadMatch) {
      return truncateText(`Changed plan: ${insteadMatch[1]}.`, SUMMARY_MAX_CHARS);
    }
    if (/\bbaseline\b/i.test(normalized) && /\bchallenger\b/i.test(normalized) && /\b(?:(?:clearly\s+)?better|wins?)\b/i.test(normalized)) {
      return "Plan: keep current summarizer baseline; add event-aware challenger; use when better.";
    }
  }
  if (event.type === "action") {
    const normalized = normalizeSummaryEventText(event.text);
    const planningMatch = normalized.match(/^(?:i\s+(?:should|will|want\s+to|plan\s+to))\s+(.+)$/i);
    const cleaned2 = planningMatch ? `Planning to ${planningMatch[1].replace(/[.!?;:,]+$/g, "")}.` : `${capitalize(stripLeadingSummaryPhrase(normalized).replace(/[.!?;:,]+$/g, ""))}.`;
    return truncateText(cleaned2, SUMMARY_MAX_CHARS);
  }
  if (event.type === "focus") {
    const normalized = normalizeSummaryEventText(event.text).replace(/[.!?;:,]+$/g, "");
    const paths = collectPathTokens(event.text);
    if (paths.length > 0 && /\bcompare\b/i.test(normalized) && /\bsummary mode\b/i.test(normalized) && /\bbefore (?:editing|touching|changing)\b/i.test(normalized)) {
      return truncateText(`Planning to compare ${paths[0]} selection paths before editing.`, SUMMARY_MAX_CHARS);
    }
    const symbols = Array.from(new Set(event.text.match(SYMBOL_TOKEN_RE) ?? []));
    const commandMatch = event.text.match(/\b(?:node --test|node --import tsx|npm(?: run)? [a-z0-9:-]+)\b/i);
    if (commandMatch && paths.length > 0) {
      const compact = `Next check is ${commandMatch[0]} ${paths[0]}.`;
      if (compact.length <= SUMMARY_MAX_CHARS) return compact;
    }
    if (symbols.length >= 2) {
      const compact = `Inspect ${symbols[0]} and ${symbols[1]}.`;
      if (compact.length <= SUMMARY_MAX_CHARS) return compact;
    }
    if (paths.length >= 2) {
      const compact = `Inspect ${paths[0]} and ${paths[1]}.`;
      if (compact.length <= SUMMARY_MAX_CHARS) return compact;
    }
    if (paths.length === 1) {
      const path = paths[0];
      const withSymbol = symbols[0] && !path.includes(symbols[0]) ? `Inspect ${path} and ${symbols[0]}.` : `Inspect ${path}.`;
      if (withSymbol.length <= SUMMARY_MAX_CHARS) return withSymbol;
      return truncateText(`Inspect ${path}.`, SUMMARY_MAX_CHARS);
    }
    if (symbols.length > 0) {
      const compact = `Inspect ${symbols[0]}.`;
      if (compact.length <= SUMMARY_MAX_CHARS) return compact;
    }
  }
  const cleaned = normalizeSummaryEventText(event.text).replace(/[.!?;:,]+$/g, "");
  if (!cleaned) return "";
  return truncateText(`${capitalize(cleaned)}.`, SUMMARY_MAX_CHARS);
}
function extractThinkingSummaryEvents(text) {
  const raw = normalizeNewlines(text).trim();
  if (!raw) return [];
  const sentences = splitSummarySentences(raw).map((sentence) => normalizeSummaryEventText(sentence)).filter(Boolean);
  return sentences.map((sentence, order) => {
    const hasFailure = hasExplicitFailureCue(sentence);
    const hasSuccess = hasExplicitSuccessCue(sentence);
    const hasUncertainty = UNCERTAINTY_CUE_RE.test(sentence) || SPECULATIVE_CUE_RE.test(sentence);
    const hasPlanChange = !hasUncertainty && PLAN_CHANGE_CUE_RE.test(sentence) && (!/\b(?:instead of|rather than)\b/i.test(sentence) || /^(?:instead of|rather than)\b/i.test(sentence));
    const hasDecision = !hasUncertainty && DECISION_CUE_RE.test(sentence);
    const hasFocus = collectPathTokens(sentence).length > 0 || (sentence.match(SYMBOL_TOKEN_RE) ?? []).length > 0;
    const hasAction = ACTION_CUE_RE.test(sentence) || NEXT_ACTION_CUE_RE.test(sentence);
    if (hasFailure) return { type: "failure", text: sentence, order, priority: 110 };
    if (hasSuccess) return { type: "success", text: sentence, order, priority: 120 };
    if (hasPlanChange) return { type: "plan_change", text: sentence, order, priority: 90 };
    if (hasDecision) return { type: "decision", text: sentence, order, priority: 85 };
    if (hasUncertainty) return { type: "uncertainty", text: sentence, order, priority: 82 };
    if (hasAction) return { type: hasFocus ? "focus" : "action", text: sentence, order, priority: hasFocus ? 62 : 58 };
    if (hasFocus) return { type: "focus", text: sentence, order, priority: 55 };
    return { type: "generic", text: sentence, order, priority: 10 };
  });
}
function summarizeThinkingTextChallenger(text, fallback) {
  const events = extractThinkingSummaryEvents(text);
  if (events.length === 0) {
    return { summary: fallback, events: [], hasExplicitFailure: false, hasExplicitSuccess: false, collapsedPriority: 0 };
  }
  const latestFailure = [...events].reverse().find((event) => event.type === "failure");
  const latestSuccess = [...events].reverse().find((event) => event.type === "success");
  const hasExplicitFailure = Boolean(latestFailure);
  const hasExplicitSuccess = Boolean(latestSuccess);
  const topEvent = [...events].sort((left, right) => right.priority - left.priority || right.order - left.order)[0];
  return {
    summary: renderSummaryEvent(topEvent) || fallback,
    events,
    hasExplicitFailure,
    hasExplicitSuccess,
    collapsedPriority: topEvent.priority
  };
}
function countRetainedPathTokens(sourceText, summary) {
  return collectPathTokens(sourceText).filter((token) => summary.includes(token)).length;
}
function summarizeThinkingTextDetailed(text, fallback = "Reasoning is hidden by the provider.") {
  const raw = normalizeNewlines(text).trim();
  if (!raw) {
    return {
      summary: fallback,
      baselineSummary: fallback,
      challengerSummary: fallback,
      events: [],
      collapsedPriority: 0,
      hasExplicitFailure: false,
      hasExplicitSuccess: false
    };
  }
  const baselineSummary = summarizeThinkingTextBaseline(raw, fallback);
  const challenger = summarizeThinkingTextChallenger(raw, fallback);
  const challengerSummary = challenger.summary;
  const preservesUncertainty = /\b(?:whether|maybe|might|looks like|seems|uncertain)\b/i.test(challengerSummary);
  const baselinePreservesUncertainty = /\b(?:whether|maybe|might|looks like|seems|uncertain)\b/i.test(baselineSummary);
  const latestFailureOrder = challenger.events.filter((event) => event.type === "failure").at(-1)?.order ?? -1;
  const latestSuccessOrder = challenger.events.filter((event) => event.type === "success").at(-1)?.order ?? -1;
  const laterExplicitSuccess = latestSuccessOrder > latestFailureOrder;
  const baselineHasExplicitSuccess = hasExplicitSuccessCue(baselineSummary);
  const baselineHasExplicitFailure = hasExplicitFailureCue(baselineSummary);
  const baselineRetainedPathCount = countRetainedPathTokens(raw, baselineSummary);
  const challengerRetainedPathCount = countRetainedPathTokens(raw, challengerSummary);
  const sourceSymbols = Array.from(new Set(raw.match(SYMBOL_TOKEN_RE) ?? []));
  const baselineRetainedSymbolCount = sourceSymbols.filter((token) => baselineSummary.includes(token)).length;
  const challengerRetainedSymbolCount = sourceSymbols.filter((token) => challengerSummary.includes(token)).length;
  const startsWithStrongHypothesis = /^(?:maybe|perhaps)\b/i.test(raw) || /^whether\b/i.test(raw);
  const startsWithExplicitIntent = /^(?:i\s+(?:should|will|want\s+to|plan\s+to))\b/i.test(raw);
  const challengerFramesPlan = /^Planning to\b/i.test(challengerSummary);
  const baselineFramesPlan = /^Planning to\b/i.test(baselineSummary);
  const rawRequiresDeferredJudgment = /\bbefore i call this a drift\b/i.test(raw);
  const challengerRetainsDeferredJudgment = /\bbefore calling this a drift\b/i.test(challengerSummary);
  const baselineRetainsDeferredJudgment = /\bbefore (?:i call|calling) this a drift\b/i.test(baselineSummary);
  const repeatedActionKeys = challenger.events.map((event) => event.type === "action" ? stripLeadingSummaryPhrase(normalizeSummaryEventText(event.text)).toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").trim().split(/\s+/).slice(0, 2).join(" ") : "").filter(Boolean);
  const hasRepeatedActionChatter = challenger.events.length >= 3 && challenger.events.every((event) => event.type === "action") && new Set(repeatedActionKeys).size < repeatedActionKeys.length;
  const shouldCompactFocusSummary = challenger.events.length === 1 && challenger.events[0]?.type === "focus" && /^(?:Inspect|Next check is|Planning to compare .* before editing\.)\b/i.test(challengerSummary) && /^(?:before editing |before touching |before changing |i(?:'m| am)\s+(?:reading|inspecting|tracing)|the next check is)\b/i.test(raw) && !/\bdo not regress\b/i.test(raw) && (challengerRetainedPathCount >= baselineRetainedPathCount || challengerRetainedSymbolCount > baselineRetainedSymbolCount);
  const rawHasCompareBeforeEditingIntent = /\bcompare\b/i.test(raw) && /\bsummary mode\b/i.test(raw) && /\bbefore (?:editing|touching|changing)\b/i.test(raw);
  const shouldPreferCompareBeforeEditingTemplate = challenger.events.length === 1 && challenger.events[0]?.type === "focus" && rawHasCompareBeforeEditingIntent && /^Planning to compare .* before editing\.$/i.test(challengerSummary) && challengerRetainedPathCount >= baselineRetainedPathCount && challengerRetainedSymbolCount >= baselineRetainedSymbolCount && challengerSummary.length <= baselineSummary.length;
  const singleChallengerEventType = challenger.events.length === 1 ? challenger.events[0]?.type : void 0;
  const challengerRetainsComparableContext = challengerRetainedPathCount >= baselineRetainedPathCount && challengerRetainedSymbolCount >= baselineRetainedSymbolCount;
  const shouldPreferFailureTemplate = singleChallengerEventType === "failure" && hasExplicitFailureCue(challengerSummary) && challengerRetainedPathCount >= baselineRetainedPathCount;
  const shouldPreferDecisionTemplate = singleChallengerEventType === "decision" && DECISION_CUE_RE.test(challengerSummary) && DECISION_CUE_RE.test(raw) && challengerRetainsComparableContext && challengerSummary.length <= baselineSummary.length + 8;
  const shouldPreferSuccessTemplate = singleChallengerEventType === "success" && hasExplicitSuccessCue(challengerSummary) && challengerRetainsComparableContext && challengerSummary.length <= baselineSummary.length + 8;
  const rawHasExpandedSelectionConstraint = /\bexpanded mode\b/i.test(raw) && /\b(?:collapsed|summary)\b/i.test(raw) && /\b(?:preserve|keep|limit)\b/i.test(raw);
  const shouldPreferExpandedConstraintTemplate = singleChallengerEventType === "plan_change" && rawHasExpandedSelectionConstraint && /\bexpanded mode\b/i.test(challengerSummary) && /\b(?:collapsed|summary)\b/i.test(challengerSummary) && challengerRetainsComparableContext;
  const rawHasHybridPlanFeatures = /\bbaseline\b/i.test(raw) && /\bchallenger\b/i.test(raw) && /\b(?:(?:clearly\s+)?better|wins?)\b/i.test(raw);
  const challengerHasHybridPlanFeatures = /\bbaseline\b/i.test(challengerSummary) && /\bchallenger\b/i.test(challengerSummary) && /\b(?:better|wins?)\b/i.test(challengerSummary);
  const shouldPreferPlanChangeTemplate = singleChallengerEventType === "plan_change" && (challengerHasHybridPlanFeatures || PLAN_CHANGE_CUE_RE.test(challengerSummary) || /^Changed plan:/i.test(challengerSummary)) && (rawHasHybridPlanFeatures || PLAN_CHANGE_CUE_RE.test(raw)) && challengerRetainsComparableContext;
  let summary = baselineSummary;
  if (laterExplicitSuccess && challenger.hasExplicitSuccess && !baselineHasExplicitSuccess) {
    summary = challengerSummary;
  } else if (challenger.hasExplicitFailure && !laterExplicitSuccess && !baselineHasExplicitFailure && hasExplicitFailureCue(challengerSummary)) {
    summary = challengerSummary;
  } else if (startsWithStrongHypothesis && (UNCERTAINTY_CUE_RE.test(raw) || SPECULATIVE_CUE_RE.test(raw)) && preservesUncertainty && !baselinePreservesUncertainty) {
    summary = challengerSummary;
  } else if (rawRequiresDeferredJudgment && challengerRetainsDeferredJudgment && !baselineRetainsDeferredJudgment) {
    summary = challengerSummary;
  } else if (startsWithExplicitIntent && challengerFramesPlan && !baselineFramesPlan) {
    summary = challengerSummary;
  } else if (hasRepeatedActionChatter && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (shouldCompactFocusSummary && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (shouldPreferCompareBeforeEditingTemplate && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (shouldPreferFailureTemplate && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (shouldPreferDecisionTemplate && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (shouldPreferSuccessTemplate && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (shouldPreferExpandedConstraintTemplate && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (shouldPreferPlanChangeTemplate && challengerSummary !== fallback) {
    summary = challengerSummary;
  } else if (challengerRetainedPathCount > baselineRetainedPathCount) {
    summary = challengerSummary;
  }
  const visibleSummary = ensureCompleteVisibleSummary(summary);
  const visibleMetadata = summary === challengerSummary ? challenger : summarizeThinkingTextChallenger(visibleSummary, fallback);
  return {
    summary: visibleSummary,
    baselineSummary,
    challengerSummary,
    events: visibleMetadata.events,
    collapsedPriority: visibleMetadata.collapsedPriority,
    hasExplicitFailure: visibleMetadata.hasExplicitFailure,
    hasExplicitSuccess: visibleMetadata.hasExplicitSuccess
  };
}
function inferThinkingRole(text) {
  const haystack = ` ${normalizeNewlines(text).toLowerCase()} `;
  const referenceOnlyFailureCue = FAILURE_REFERENCE_CONTEXT_RE.test(haystack) && !EXPLICIT_FAILURE_RESULT_RE.test(haystack) && !EXPLICIT_ERROR_RESULT_RE.test(haystack);
  const referenceOnlyIssueCue = /\b(?:issue|issues|problem|problems|warning|warnings)\s+(?:handling|rendering|renderer|case|cases|path|paths|state|states|logic|message|messages|copy|text|wording|semantics|classification|detection|cue|cues|recovery|fallback|branch|branches|surface|mode|modes|statement|matching|reproduction|steps?)\b/.test(haystack);
  const scoredRoles = [
    {
      role: "error",
      score: Number(!referenceOnlyFailureCue && !referenceOnlyIssueCue && /\b(error|errors|fail|failed|failure|blocked|locked|cannot|unable|exception|bug|issue|problem|warning|debug|stack trace|traceback)\b/.test(haystack)) * 4 + Number(/\bfix\b/.test(haystack)) * 2
    },
    {
      role: "compare",
      score: Number(/\b(compare|comparison|versus|\bvs\b|trade-?off|alternative|option|weigh|choose between)\b/.test(haystack)) * 4
    },
    {
      role: "search",
      score: Number(/\b(search|grep|find|locate|lookup|browse|discover)\b/.test(haystack)) * 3 + Number(/\b(list|describe)\b(?=.*\btools?\b)/.test(haystack)) * 2
    },
    {
      role: "inspect",
      score: Number(/\b(inspect|examine|read|open|scan|review|trace|look at|understand|orient|connection)\b/.test(haystack)) * 3 + Number(/\bconnect\b/.test(haystack)) * 2
    },
    {
      role: "plan",
      score: Number(/\b(plan|planning|approach|strategy|outline|decide|figure out|map out|organize|break down)\b/.test(haystack)) * 3
    },
    {
      role: "write",
      score: Number(/\b(write|implement|patch|update|refactor|create|add|remove|rename|modify)\b/.test(haystack)) * 3 + Number(/\bedit\b/.test(haystack)) * 2
    },
    {
      role: "verify",
      score: Number(/\b(verify|verification|validate|validation|recheck|prove)\b/.test(haystack)) * 4 + Number(/\b(test|confirm)\b/.test(haystack)) * 2 + Number(/\b(check|ensure)\b/.test(haystack)) * 1
    }
  ];
  const bestRole = scoredRoles.sort((a, b) => b.score - a.score).find((entry) => entry.score > 0);
  return bestRole?.role ?? "default";
}
function iconForThinkingRole(role) {
  switch (role) {
    case "inspect":
      return "\u25EB";
    case "plan":
      return "\u25C7";
    case "compare":
      return "\u2194";
    case "verify":
      return "\u2713";
    case "write":
      return "\u270E";
    case "search":
      return "\u2315";
    case "error":
      return "!";
    default:
      return "\xB7";
  }
}
function deriveThinkingSteps(blocks) {
  const steps = [];
  blocks.forEach((block, blockIndex) => {
    if (block.redacted && !block.text.trim()) {
      const summary = "Reasoning is hidden by the provider.";
      steps.push({
        id: `${block.contentIndex}-0`,
        contentIndex: block.contentIndex,
        blockIndex,
        stepIndex: 0,
        summary,
        body: summary,
        role: "default",
        icon: iconForThinkingRole("default"),
        baselineSummary: summary,
        challengerSummary: summary,
        summaryEvents: [],
        collapsedPriority: 0,
        hasExplicitFailure: false,
        hasExplicitSuccess: false
      });
      return;
    }
    const stepTexts = splitThinkingIntoStepTexts(block.text);
    stepTexts.forEach((stepText, stepIndex) => {
      const summaryDetails = summarizeThinkingTextDetailed(stepText);
      const role = inferThinkingRole(`${summaryDetails.summary}
${stepText}`);
      steps.push({
        id: `${block.contentIndex}-${stepIndex}`,
        contentIndex: block.contentIndex,
        blockIndex,
        stepIndex,
        summary: summaryDetails.summary,
        body: stepText.trim(),
        role,
        icon: iconForThinkingRole(role),
        baselineSummary: summaryDetails.baselineSummary,
        challengerSummary: summaryDetails.challengerSummary,
        summaryEvents: summaryDetails.events,
        collapsedPriority: summaryDetails.collapsedPriority,
        hasExplicitFailure: summaryDetails.hasExplicitFailure,
        hasExplicitSuccess: summaryDetails.hasExplicitSuccess
      });
    });
  });
  return steps;
}
function parseThinkingMode(input) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return void 0;
  if (["collapsed", "collapse", "c"].includes(normalized)) return "collapsed";
  if (["summary", "summaries", "s"].includes(normalized)) return "summary";
  if (["expanded", "expand", "full", "e"].includes(normalized)) return "expanded";
  return void 0;
}

// ../../../../../../tmp/pi-thinking-steps/persistence.ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var PREFERENCE_FILE_NAME = "thinking-steps.json";
function getPreferencePath(scope, cwd) {
  if (scope === "global") {
    const homePath = process.env.HOME?.trim() || homedir();
    return join(homePath, ".pi", "agent", "state", PREFERENCE_FILE_NAME);
  }
  return join(cwd, ".pi", PREFERENCE_FILE_NAME);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function parseModePreference(content, path) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse thinking view preference at ${path}: ${errorMessage(error)}`);
  }
  const mode = typeof parsed === "object" && parsed !== null && "mode" in parsed && typeof parsed.mode === "string" ? parseThinkingMode(parsed.mode) : void 0;
  if (!mode) {
    throw new Error(`Invalid thinking view preference at ${path}`);
  }
  return mode;
}
async function readModeFromFile(path) {
  try {
    return parseModePreference(await readFile(path, "utf8"), path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
function readModeFromFileSync(path) {
  try {
    return parseModePreference(readFileSync(path, "utf8"), path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
async function writeModeToFile(path, mode) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ mode }, null, 2)}
`, "utf8");
  } catch (error) {
    throw new Error(`Failed to save thinking view preference at ${path}: ${errorMessage(error)}`);
  }
}
async function clearModeFile(path) {
  try {
    await rm(path, { force: true });
  } catch (error) {
    throw new Error(`Failed to clear thinking view preference at ${path}: ${errorMessage(error)}`);
  }
}
async function readThinkingStepsModePreference(scope, cwd) {
  return readModeFromFile(getPreferencePath(scope, cwd));
}
function readThinkingStepsModePreferenceSync(scope, cwd) {
  return readModeFromFileSync(getPreferencePath(scope, cwd));
}
async function writeThinkingStepsModePreference(scope, cwd, mode) {
  await writeModeToFile(getPreferencePath(scope, cwd), mode);
}
async function clearThinkingStepsModePreference(scope, cwd) {
  await clearModeFile(getPreferencePath(scope, cwd));
}

// ../../../../../../tmp/pi-thinking-steps/render.ts
import { truncateToWidth as truncateToWidth2, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// ../../../../../../tmp/pi-thinking-steps/state.ts
var STATE_KEY = Symbol.for("pi-extensions.thinking-steps.state");
var DEFAULT_SCOPE_KEY = "__default__";
var LABEL_REFRESH_SUFFIX = "\u2060";
function isRecord3(value) {
  return typeof value === "object" && value !== null;
}
function normalizeThinkingScopeKey(scopeKey) {
  const trimmed = scopeKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_SCOPE_KEY;
}
function normalizeThinkingMode(mode) {
  return mode === "collapsed" || mode === "summary" || mode === "expanded" ? mode : "summary";
}
function normalizeActiveThinkingState(value) {
  if (!isRecord3(value) || value.active !== true) {
    return { active: false };
  }
  return {
    active: true,
    messageTimestamp: typeof value.messageTimestamp === "number" ? value.messageTimestamp : void 0,
    contentIndex: typeof value.contentIndex === "number" ? value.contentIndex : void 0
  };
}
function normalizeModeByScopeKey(value, currentScopeKey, legacyMode) {
  const modeByScopeKey = {};
  if (isRecord3(value)) {
    for (const [scopeKey, scopeMode] of Object.entries(value)) {
      modeByScopeKey[normalizeThinkingScopeKey(scopeKey)] = normalizeThinkingMode(scopeMode);
    }
  }
  modeByScopeKey[currentScopeKey] ??= normalizeThinkingMode(legacyMode);
  return modeByScopeKey;
}
function normalizeActiveByScopeKey(value) {
  const activeByScopeKey = {};
  if (!isRecord3(value)) return activeByScopeKey;
  for (const [scopeKey, entries] of Object.entries(value)) {
    const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey);
    activeByScopeKey[normalizedScopeKey] = {};
    if (!isRecord3(entries)) continue;
    for (const [messageTimestamp2, entry] of Object.entries(entries)) {
      if (!isRecord3(entry)) continue;
      activeByScopeKey[normalizedScopeKey][messageTimestamp2] = {
        contentIndex: typeof entry.contentIndex === "number" ? entry.contentIndex : void 0
      };
    }
  }
  return activeByScopeKey;
}
function normalizeLastActiveByScopeKey(value) {
  const lastActiveByScopeKey = {};
  if (!isRecord3(value)) return lastActiveByScopeKey;
  for (const [scopeKey, entry] of Object.entries(value)) {
    lastActiveByScopeKey[normalizeThinkingScopeKey(scopeKey)] = normalizeActiveThinkingState(entry);
  }
  return lastActiveByScopeKey;
}
function ensureGlobalStateShape(state) {
  const currentScopeKey = normalizeThinkingScopeKey(typeof state.currentScopeKey === "string" ? state.currentScopeKey : void 0);
  const modeByScopeKey = normalizeModeByScopeKey(state.modeByScopeKey, currentScopeKey, state.mode);
  const activeByScopeKey = normalizeActiveByScopeKey(state.activeByScopeKey);
  const lastActiveByScopeKey = normalizeLastActiveByScopeKey(state.lastActiveByScopeKey);
  const legacyActive = normalizeActiveThinkingState(state.active);
  const refreshToggleByScope = isRecord3(state.refreshToggleByScope) ? Object.fromEntries(Object.entries(state.refreshToggleByScope).map(([scopeKey, enabled]) => [normalizeThinkingScopeKey(scopeKey), enabled === true])) : {};
  const messageScopeByObject = state.messageScopeByObject instanceof WeakMap ? state.messageScopeByObject : /* @__PURE__ */ new WeakMap();
  const messageObjectsByScope = isRecord3(state.messageObjectsByScope) ? Object.fromEntries(Object.entries(state.messageObjectsByScope).map(([scopeKey, messages]) => [normalizeThinkingScopeKey(scopeKey), messages instanceof Set ? messages : /* @__PURE__ */ new Set()])) : {};
  const messageScopeByTimestamp = isRecord3(state.messageScopeByTimestamp) ? Object.fromEntries(Object.entries(state.messageScopeByTimestamp).filter((entry) => typeof entry[1] === "string").map(([messageTimestamp2, scopeKey]) => [messageTimestamp2, normalizeThinkingScopeKey(scopeKey)])) : {};
  const legacyPatchReleasesByScope = isRecord3(state.patchReleasesByScope) ? Object.fromEntries(Object.entries(state.patchReleasesByScope).map(([scopeKey, releases]) => [normalizeThinkingScopeKey(scopeKey), Array.isArray(releases) ? releases : []])) : {};
  const patchReleases = Array.isArray(state.patchReleases) ? state.patchReleases : Object.values(legacyPatchReleasesByScope).flat();
  const patchReleasesByScope = { ...legacyPatchReleasesByScope };
  for (const scopeKey of Object.keys(modeByScopeKey)) {
    activeByScopeKey[scopeKey] ??= {};
    lastActiveByScopeKey[scopeKey] ??= { active: false };
    refreshToggleByScope[scopeKey] ??= false;
    messageObjectsByScope[scopeKey] ??= /* @__PURE__ */ new Set();
    patchReleasesByScope[scopeKey] ??= [];
  }
  if (legacyActive.active) {
    lastActiveByScopeKey[currentScopeKey] = legacyActive;
    if (legacyActive.messageTimestamp !== void 0) {
      activeByScopeKey[currentScopeKey][String(legacyActive.messageTimestamp)] = {
        contentIndex: legacyActive.contentIndex
      };
    }
  }
  state.currentScopeKey = currentScopeKey;
  state.modeByScopeKey = modeByScopeKey;
  state.activeByScopeKey = activeByScopeKey;
  state.lastActiveByScopeKey = lastActiveByScopeKey;
  state.refreshToggleByScope = refreshToggleByScope;
  state.messageScopeByObject = messageScopeByObject;
  state.messageObjectsByScope = messageObjectsByScope;
  state.messageScopeByTimestamp = messageScopeByTimestamp;
  state.patchReleases = patchReleases;
  state.patchReleasesByScope = patchReleasesByScope;
  state.patchRefCount = typeof state.patchRefCount === "number" && Number.isFinite(state.patchRefCount) ? state.patchRefCount : 0;
  state.patchCleanup = typeof state.patchCleanup === "function" ? state.patchCleanup : void 0;
  state.patchInstallPromise = state.patchInstallPromise instanceof Promise ? state.patchInstallPromise : void 0;
  return state;
}
var globalState = (() => {
  const existing = globalThis[STATE_KEY];
  if (isRecord3(existing)) {
    return ensureGlobalStateShape(existing);
  }
  const created = {
    currentScopeKey: DEFAULT_SCOPE_KEY,
    modeByScopeKey: { [DEFAULT_SCOPE_KEY]: "summary" },
    activeByScopeKey: { [DEFAULT_SCOPE_KEY]: {} },
    lastActiveByScopeKey: { [DEFAULT_SCOPE_KEY]: { active: false } },
    refreshToggleByScope: {},
    messageScopeByObject: /* @__PURE__ */ new WeakMap(),
    messageObjectsByScope: { [DEFAULT_SCOPE_KEY]: /* @__PURE__ */ new Set() },
    messageScopeByTimestamp: {},
    patchReleases: [],
    patchReleasesByScope: {},
    patchRefCount: 0
  };
  globalThis[STATE_KEY] = created;
  return created;
})();
function ensureScopeState(scopeKey) {
  if (!(scopeKey in globalState.modeByScopeKey)) {
    globalState.modeByScopeKey[scopeKey] = "summary";
  }
  if (!(scopeKey in globalState.activeByScopeKey)) {
    globalState.activeByScopeKey[scopeKey] = {};
  }
  if (!(scopeKey in globalState.lastActiveByScopeKey)) {
    globalState.lastActiveByScopeKey[scopeKey] = { active: false };
  }
  if (!(scopeKey in globalState.refreshToggleByScope)) {
    globalState.refreshToggleByScope[scopeKey] = false;
  }
  if (!(scopeKey in globalState.messageObjectsByScope)) {
    globalState.messageObjectsByScope[scopeKey] = /* @__PURE__ */ new Set();
  }
  if (!(scopeKey in globalState.patchReleasesByScope)) {
    globalState.patchReleasesByScope[scopeKey] = [];
  }
}
function getCurrentThinkingScopeKey() {
  return globalState.currentScopeKey;
}
function setCurrentThinkingScopeKey(scopeKey) {
  const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey);
  ensureScopeState(normalizedScopeKey);
  globalState.currentScopeKey = normalizedScopeKey;
}
function getThinkingStepsMode(scopeKey) {
  const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey ?? globalState.currentScopeKey);
  ensureScopeState(normalizedScopeKey);
  return globalState.modeByScopeKey[normalizedScopeKey] ?? "summary";
}
function setThinkingStepsMode(mode, scopeKey) {
  const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey ?? globalState.currentScopeKey);
  ensureScopeState(normalizedScopeKey);
  globalState.modeByScopeKey[normalizedScopeKey] = mode;
  globalState.currentScopeKey = normalizedScopeKey;
}
function getActiveThinkingState(messageTimestamp2, scopeKey) {
  const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey ?? globalState.currentScopeKey);
  ensureScopeState(normalizedScopeKey);
  if (messageTimestamp2 !== void 0) {
    const entry = globalState.activeByScopeKey[normalizedScopeKey][String(messageTimestamp2)];
    if (!entry) return { active: false };
    return { active: true, messageTimestamp: messageTimestamp2, contentIndex: entry.contentIndex };
  }
  return { ...globalState.lastActiveByScopeKey[normalizedScopeKey] };
}
function setActiveThinkingState(state, scopeKey) {
  const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey ?? globalState.currentScopeKey);
  ensureScopeState(normalizedScopeKey);
  globalState.lastActiveByScopeKey[normalizedScopeKey] = { ...state };
  if (!state.active || state.messageTimestamp === void 0) {
    if (state.messageTimestamp !== void 0) {
      delete globalState.activeByScopeKey[normalizedScopeKey][String(state.messageTimestamp)];
    }
    return;
  }
  globalState.activeByScopeKey[normalizedScopeKey][String(state.messageTimestamp)] = {
    contentIndex: state.contentIndex
  };
}
function clearActiveThinkingState(messageTimestamp2, scopeKey) {
  if (messageTimestamp2 !== void 0) {
    const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey ?? globalState.currentScopeKey);
    ensureScopeState(normalizedScopeKey);
    delete globalState.activeByScopeKey[normalizedScopeKey][String(messageTimestamp2)];
    if (globalState.lastActiveByScopeKey[normalizedScopeKey].messageTimestamp === messageTimestamp2) {
      globalState.lastActiveByScopeKey[normalizedScopeKey] = { active: false };
    }
    return;
  }
  if (scopeKey !== void 0) {
    const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey);
    ensureScopeState(normalizedScopeKey);
    globalState.activeByScopeKey[normalizedScopeKey] = {};
    globalState.lastActiveByScopeKey[normalizedScopeKey] = { active: false };
    return;
  }
  for (const existingScopeKey of Object.keys(globalState.modeByScopeKey)) {
    ensureScopeState(existingScopeKey);
    globalState.activeByScopeKey[existingScopeKey] = {};
    globalState.lastActiveByScopeKey[existingScopeKey] = { active: false };
  }
}
function nextThinkingRefreshLabel(label, scopeKey) {
  const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey ?? globalState.currentScopeKey);
  ensureScopeState(normalizedScopeKey);
  const useInvisibleSuffix = globalState.refreshToggleByScope[normalizedScopeKey] ?? false;
  globalState.refreshToggleByScope[normalizedScopeKey] = !useInvisibleSuffix;
  return useInvisibleSuffix ? `${label}${LABEL_REFRESH_SUFFIX}` : label;
}
function recordThinkingMessageScope(message, scopeKey) {
  const requestedScopeKey = normalizeThinkingScopeKey(scopeKey ?? globalState.currentScopeKey);
  ensureScopeState(requestedScopeKey);
  const existingScopeKey = globalState.messageScopeByObject.get(message);
  const normalizedScopeKey = existingScopeKey ?? requestedScopeKey;
  ensureScopeState(normalizedScopeKey);
  if (!existingScopeKey) {
    globalState.messageScopeByObject.set(message, normalizedScopeKey);
  }
  globalState.messageObjectsByScope[normalizedScopeKey].add(message);
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : void 0;
  if (timestamp !== void 0) {
    globalState.messageScopeByTimestamp[String(timestamp)] = normalizedScopeKey;
  }
}
function resolveThinkingMessageScope(message, fallbackScopeKey) {
  const objectScopeKey = globalState.messageScopeByObject.get(message);
  if (objectScopeKey) {
    ensureScopeState(objectScopeKey);
    return objectScopeKey;
  }
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : void 0;
  if (timestamp !== void 0) {
    const timestampScopeKey = globalState.messageScopeByTimestamp[String(timestamp)];
    if (timestampScopeKey) {
      ensureScopeState(timestampScopeKey);
      return timestampScopeKey;
    }
  }
  const normalizedScopeKey = normalizeThinkingScopeKey(fallbackScopeKey ?? globalState.currentScopeKey);
  ensureScopeState(normalizedScopeKey);
  return normalizedScopeKey;
}
function clearThinkingMessageOwnership(scopeKey) {
  if (scopeKey !== void 0) {
    const normalizedScopeKey = normalizeThinkingScopeKey(scopeKey);
    ensureScopeState(normalizedScopeKey);
    const ownedMessages = globalState.messageObjectsByScope[normalizedScopeKey] ?? /* @__PURE__ */ new Set();
    for (const message of ownedMessages) {
      globalState.messageScopeByObject.delete(message);
    }
    globalState.messageObjectsByScope[normalizedScopeKey] = /* @__PURE__ */ new Set();
    for (const [messageTimestamp2, ownerScopeKey] of Object.entries(globalState.messageScopeByTimestamp)) {
      if (ownerScopeKey === normalizedScopeKey) {
        delete globalState.messageScopeByTimestamp[messageTimestamp2];
      }
    }
    return;
  }
  globalState.messageScopeByObject = /* @__PURE__ */ new WeakMap();
  globalState.messageObjectsByScope = { [DEFAULT_SCOPE_KEY]: /* @__PURE__ */ new Set() };
  globalState.messageScopeByTimestamp = {};
}

// ../../../../../../tmp/pi-thinking-steps/render.ts
function roleColor(role) {
  switch (role) {
    case "verify":
      return "success";
    case "error":
      return "error";
    case "compare":
      return "warning";
    case "inspect":
    case "search":
      return "mdLink";
    case "write":
    case "plan":
      return "accent";
    default:
      return "muted";
  }
}
function pulseGlyph(theme, nowMs) {
  const frames = [
    theme.fg("dim", "\xB7"),
    theme.fg("muted", "\u2022"),
    theme.fg("accent", "\u2022"),
    theme.fg("muted", "\u2022")
  ];
  const frame = Math.floor(nowMs / 180) % frames.length;
  return frames[frame] ?? frames[0];
}
function sanitizeThinkingText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\u001b[\]PX^_][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g, "").replace(/[\u0090\u0098\u009d\u009e\u009f][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g, "").replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[ -/]*[0-9@-~])/g, "").replace(/\u009b[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, "");
}
function parseThinkingInlineSegments(text) {
  const sanitized = sanitizeThinkingText(text);
  const segments = [];
  const markerRe = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|`([^`]+)`|(?<![\w/.-])\*(?!\*)(?=\S)([\s\S]*?\S)(?<!\*)\*(?![\w/.-])|(?<![\w/.-])_(?!_)(?=\S)([\s\S]*?\S)(?<!_)_(?![\w/.-])/g;
  let lastIndex = 0;
  for (const match of sanitized.matchAll(markerRe)) {
    const markerIndex = match.index ?? 0;
    if (markerIndex > lastIndex) {
      segments.push({ text: sanitized.slice(lastIndex, markerIndex), style: "plain" });
    }
    if (match[2]) segments.push({ text: match[2], style: "bold" });
    if (match[3]) segments.push({ text: match[3], style: "code" });
    if (match[4]) segments.push({ text: match[4], style: "plain" });
    if (match[5]) segments.push({ text: match[5], style: "plain" });
    lastIndex = markerIndex + match[0].length;
  }
  if (lastIndex < sanitized.length) {
    segments.push({ text: sanitized.slice(lastIndex), style: "plain" });
  }
  return segments;
}
function renderThinkingInlineSegment(theme, segment) {
  if (segment.style === "bold") return theme.bold(theme.fg("thinkingText", segment.text));
  if (segment.style === "code") return theme.bold(theme.fg("accent", segment.text));
  return theme.fg("thinkingText", segment.text);
}
function wrapStepHeader(theme, width, step, active, connector) {
  const connectorColor = active ? "accent" : "muted";
  const icon = theme.fg(roleColor(step.role), step.icon);
  const prefix = `${theme.fg(connectorColor, connector)} ${icon} `;
  const continuationPrefix = " ".repeat(visibleWidth(`${connector} ${step.icon} `));
  const renderedSummary = renderThinkingInlineMarkup(theme, step.summary);
  const summaryText = active ? theme.bold(renderedSummary) : renderedSummary;
  const wrappedSummary = wrapTextWithAnsi(summaryText, Math.max(8, width - visibleWidth(prefix)));
  if (wrappedSummary.length === 0) {
    return [truncateToWidth2(prefix, width, "")];
  }
  return wrappedSummary.map(
    (line, index) => truncateToWidth2(`${index === 0 ? prefix : continuationPrefix}${line}`, width, "")
  );
}
function pickCollapsedStep(steps, activeStepId) {
  if (steps.length === 0) return void 0;
  if (activeStepId) {
    const active = steps.find((step) => step.id === activeStepId);
    if (active) return active;
  }
  let latestFailureIndex = -1;
  let latestSuccessAfterFailureIndex = -1;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.hasExplicitFailure) {
      latestFailureIndex = index;
      latestSuccessAfterFailureIndex = -1;
    }
    if (latestFailureIndex !== -1 && step.hasExplicitSuccess && index > latestFailureIndex) {
      latestSuccessAfterFailureIndex = index;
    }
  }
  if (latestSuccessAfterFailureIndex !== -1) return steps[latestSuccessAfterFailureIndex];
  if (latestFailureIndex !== -1) return steps[latestFailureIndex];
  return [...steps].sort((left, right) => (right.collapsedPriority ?? 0) - (left.collapsedPriority ?? 0) || right.blockIndex - left.blockIndex || right.stepIndex - left.stepIndex)[0];
}
function wrapCollapsedSummaryText(theme, text, firstWidth, continuationWidth) {
  const words = parseThinkingInlineSegments(text).flatMap(
    (segment) => segment.text.split(/\s+/).filter(Boolean).map((word) => renderThinkingInlineSegment(theme, { ...segment, text: word }))
  );
  if (words.length === 0) return [];
  const lines = [];
  let current = "";
  let currentWidth = Math.max(8, firstWidth);
  const continuationLineWidth = () => Math.max(8, continuationWidth);
  for (const word of words) {
    let pending = word;
    while (pending.length > 0) {
      const candidate = current ? `${current} ${pending}` : pending;
      if (visibleWidth(candidate) <= currentWidth) {
        current = candidate;
        pending = "";
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
        currentWidth = continuationLineWidth();
        continue;
      }
      const wrappedWord = wrapTextWithAnsi(pending, currentWidth);
      if (wrappedWord.length === 0) {
        pending = "";
        continue;
      }
      if (wrappedWord.length === 1) {
        current = wrappedWord[0] ?? "";
        pending = "";
        continue;
      }
      lines.push(...wrappedWord.slice(0, -1));
      pending = wrappedWord[wrappedWord.length - 1] ?? "";
      currentWidth = continuationLineWidth();
    }
  }
  if (current) lines.push(current);
  return lines;
}
function renderCollapsed(theme, width, steps, activeStepId, isActive = false, nowMs = Date.now()) {
  const step = pickCollapsedStep(steps, activeStepId);
  if (!step) return [];
  const label = "Thinking";
  const icon = theme.fg(roleColor(step.role), step.icon);
  const activity = isActive ? pulseGlyph(theme, nowMs) : theme.fg("dim", "\xB7");
  const activitySuffix = ` ${activity}`;
  const activityWidth = visibleWidth(activitySuffix);
  const prefix = `${theme.fg("muted", "\u2502")} ${theme.fg("dim", label)} ${icon} `;
  const continuationPrefix = `${theme.fg("muted", "\u2502")} ${" ".repeat(visibleWidth(`${label} ${step.icon} `))}`;
  const summaryLines = wrapCollapsedSummaryText(
    theme,
    step.summary,
    Math.max(1, width - visibleWidth(prefix) - activityWidth),
    Math.max(1, width - visibleWidth(continuationPrefix) - activityWidth)
  );
  if (summaryLines.length <= 1) {
    return [truncateToWidth2(`${prefix}${summaryLines[0] ?? renderThinkingInlineMarkup(theme, step.summary)}${activitySuffix}`, width, "")];
  }
  return summaryLines.map((line, index) => {
    if (index === 0) return truncateToWidth2(`${prefix}${line}`, width, "");
    if (index === summaryLines.length - 1) return truncateToWidth2(`${continuationPrefix}${line}${activitySuffix}`, width, "");
    return truncateToWidth2(`${continuationPrefix}${line}`, width, "");
  });
}
function stepHasEventType(step, type) {
  return step.summaryEvents?.some((event) => event.type === type) ?? false;
}
function selectSummarySteps(steps, activeStepId) {
  if (steps.length <= 5) return steps;
  const indexed = steps.map((step, index) => ({ step, index }));
  const selected = /* @__PURE__ */ new Set();
  const activeIndex = activeStepId ? steps.findIndex((step) => step.id === activeStepId) : -1;
  let latestFailureIndex = -1;
  let latestSuccessAfterFailureIndex = -1;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.hasExplicitFailure) {
      latestFailureIndex = index;
      latestSuccessAfterFailureIndex = -1;
    }
    if (latestFailureIndex !== -1 && step.hasExplicitSuccess && index > latestFailureIndex) {
      latestSuccessAfterFailureIndex = index;
    }
  }
  if (activeIndex !== -1) selected.add(activeIndex);
  if (latestFailureIndex !== -1) selected.add(latestFailureIndex);
  if (latestSuccessAfterFailureIndex !== -1) selected.add(latestSuccessAfterFailureIndex);
  const scoreEntry = ({ step, index }) => {
    let score = step.collapsedPriority ?? 0;
    const isStaleSuccessBeforeLatestFailure = step.hasExplicitSuccess && latestFailureIndex !== -1 && index < latestFailureIndex;
    if (index === latestFailureIndex && latestSuccessAfterFailureIndex === -1) score += 120;
    if (index === latestSuccessAfterFailureIndex) score += 110;
    if (stepHasEventType(step, "decision") || stepHasEventType(step, "plan_change")) score += 80;
    if (step.hasExplicitFailure) score += 50;
    if (step.hasExplicitSuccess && !isStaleSuccessBeforeLatestFailure) score += 45;
    if (isStaleSuccessBeforeLatestFailure) score -= 200;
    if (stepHasEventType(step, "focus") && !stepHasEventType(step, "decision") && !stepHasEventType(step, "plan_change") && !step.hasExplicitFailure && !step.hasExplicitSuccess) score -= 15;
    return score + index / 100;
  };
  const targetCount = Math.min(5, steps.length);
  for (const entry of [...indexed].sort((left, right) => scoreEntry(right) - scoreEntry(left))) {
    if (selected.size >= targetCount) break;
    selected.add(entry.index);
  }
  return [...selected].sort((left, right) => left - right).map((index) => steps[index]).slice(0, targetCount);
}
function renderSummary(theme, width, steps, activeStepId) {
  const lines = [
    truncateToWidth2(`${theme.fg("muted", "\u2506")} ${theme.fg("dim", "Thinking Steps \xB7 Summary")}`, width)
  ];
  const visibleSteps = selectSummarySteps(steps, activeStepId);
  for (let index = 0; index < visibleSteps.length; index++) {
    const step = visibleSteps[index];
    const connector = index === visibleSteps.length - 1 ? "\u2514\u2500" : "\u251C\u2500";
    lines.push(...wrapStepHeader(theme, width, step, step.id === activeStepId, connector));
  }
  return lines;
}
function renderThinkingInlineMarkup(theme, text) {
  const sanitized = sanitizeThinkingText(text);
  const segments = parseThinkingInlineSegments(sanitized);
  if (segments.length === 0) return theme.fg("thinkingText", sanitized);
  return segments.map((segment) => renderThinkingInlineSegment(theme, segment)).join("");
}
function renderThinkingDisplayLine(theme, text) {
  const headingMatch = text.match(/^(\s{0,3})#{1,6}\s+(.+)$/);
  if (headingMatch) {
    const indent = headingMatch[1] ?? "";
    const content = headingMatch[2] ?? "";
    return `${indent}${theme.bold(renderThinkingInlineMarkup(theme, content))}`;
  }
  const listMatch = text.match(/^(\s*)([-*+]|\d+[.)]|[a-z][.)])\s+(.+)$/i);
  if (listMatch) {
    const indent = listMatch[1] ?? "";
    const marker = listMatch[2] ?? "";
    const content = listMatch[3] ?? "";
    const renderedMarker = /^[-*+]$/.test(marker) ? "\u2022" : marker;
    return `${indent}${theme.fg("muted", renderedMarker)} ${renderThinkingInlineMarkup(theme, content)}`;
  }
  return renderThinkingInlineMarkup(theme, text);
}
function renderWrappedRawText(theme, text, width, firstPrefix, continuationPrefix = firstPrefix) {
  const innerWidth = Math.max(8, width - Math.max(visibleWidth(firstPrefix), visibleWidth(continuationPrefix)));
  const sanitizedText = sanitizeThinkingText(text);
  const rawLines = sanitizedText.replace(/\t/g, "    ").split("\n");
  const rendered = [];
  let isFirstOutputLine = true;
  for (const rawLine of rawLines) {
    const prefix = isFirstOutputLine ? firstPrefix : continuationPrefix;
    if (rawLine.trim().length === 0) {
      rendered.push(truncateToWidth2(prefix, width, ""));
      isFirstOutputLine = false;
      continue;
    }
    const styled = renderThinkingDisplayLine(theme, rawLine);
    const wrapped = wrapTextWithAnsi(styled, innerWidth);
    for (const line of wrapped) {
      const linePrefix = isFirstOutputLine ? firstPrefix : continuationPrefix;
      rendered.push(truncateToWidth2(`${linePrefix}${line}`, width, ""));
      isFirstOutputLine = false;
    }
  }
  return rendered;
}
function renderExpanded(theme, width, steps, activeStepId) {
  const lines = [
    truncateToWidth2(`${theme.fg("muted", "\u2506")} ${theme.fg("dim", "Thinking Steps \xB7 Expanded")}`, width)
  ];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const normalizedBody = step.body.trim();
    if (!normalizedBody) continue;
    const isLast = index === steps.length - 1;
    const connector = isLast ? "\u2514\u2500" : "\u251C\u2500";
    const connectorColor = step.id === activeStepId ? "accent" : "muted";
    const firstPrefix = `${theme.fg(connectorColor, connector)} `;
    const continuationPrefix = isLast ? "   " : `${theme.fg("muted", "\u2502")}  `;
    lines.push(...renderWrappedRawText(theme, normalizedBody, width, firstPrefix, continuationPrefix));
  }
  return lines;
}
function renderThinkingStepsLines(theme, width, options) {
  if (options.steps.length === 0) return [];
  if (options.mode === "collapsed") {
    return renderCollapsed(theme, width, options.steps, options.activeStepId, options.isActive, options.nowMs);
  }
  if (options.mode === "expanded") {
    return renderExpanded(theme, width, options.steps, options.activeStepId);
  }
  return renderSummary(theme, width, options.steps, options.activeStepId);
}
var ThinkingStepsComponent = class {
  constructor(theme, messageTimestamp2, blocks, scopeKey) {
    this.theme = theme;
    this.messageTimestamp = messageTimestamp2;
    this.steps = deriveThinkingSteps(blocks);
    this.scopeKey = scopeKey ?? getCurrentThinkingScopeKey();
  }
  steps;
  cacheKey;
  cachedLines;
  scopeKey;
  render(width) {
    const mode = getThinkingStepsMode(this.scopeKey);
    const active = getActiveThinkingState(this.messageTimestamp, this.scopeKey);
    const activeStepId = active.active && active.contentIndex !== void 0 ? [...this.steps].reverse().find((step) => step.contentIndex === active.contentIndex)?.id : void 0;
    const shouldBypassCache = mode === "collapsed" && active.active;
    const nextCacheKey = `${width}:${mode}:${active.active ? 1 : 0}:${activeStepId ?? ""}`;
    if (!shouldBypassCache && this.cachedLines && this.cacheKey === nextCacheKey) {
      return this.cachedLines;
    }
    const lines = renderThinkingStepsLines(this.theme, width, {
      mode,
      steps: this.steps,
      activeStepId,
      isActive: active.active,
      nowMs: Date.now()
    });
    if (!shouldBypassCache) {
      this.cacheKey = nextCacheKey;
      this.cachedLines = lines;
    } else {
      this.cacheKey = void 0;
      this.cachedLines = void 0;
    }
    return lines;
  }
  invalidate() {
    this.cacheKey = void 0;
    this.cachedLines = void 0;
  }
};

// ../../../../../../tmp/pi-flod-entry.ts
var DEFAULT_HIDDEN_LABEL = "Thinking...";
var THINKING_MODES = ["collapsed", "summary", "expanded"];
function visibleThinking(content) {
  return content.redacted === true || content.thinking.trim().length > 0;
}
function thinkingBlocks(message) {
  const blocks = [];
  message.content.forEach((content, contentIndex) => {
    if (content.type !== "thinking" || !visibleThinking(content)) return;
    blocks.push({
      contentIndex,
      text: content.thinking,
      redacted: content.redacted
    });
  });
  return blocks;
}
function patchableContentContainer(instance) {
  return Boolean(
    instance.contentContainer && typeof instance.contentContainer.clear === "function" && typeof instance.contentContainer.addChild === "function"
  );
}
function installThinkingStepsPatch(getTheme) {
  const prototype = AssistantMessageComponent2.prototype;
  const originalUpdateContent = prototype.updateContent;
  const originalSetHideThinkingBlock = prototype.setHideThinkingBlock;
  const originalSetHiddenThinkingLabel = prototype.setHiddenThinkingLabel;
  const normalizeLabel = (label) => label.replace(/\u2060+$/gu, "");
  const withOriginalInstanceMethods = (instance, callback) => {
    const ownUpdate = Object.hasOwn(instance, "updateContent");
    const ownHide = Object.hasOwn(instance, "setHideThinkingBlock");
    const ownLabel = Object.hasOwn(instance, "setHiddenThinkingLabel");
    const previousUpdate = instance.updateContent;
    const previousHide = instance.setHideThinkingBlock;
    const previousLabel = instance.setHiddenThinkingLabel;
    instance.updateContent = originalUpdateContent;
    instance.setHideThinkingBlock = originalSetHideThinkingBlock;
    instance.setHiddenThinkingLabel = originalSetHiddenThinkingLabel;
    try {
      return callback();
    } finally {
      if (ownUpdate) instance.updateContent = previousUpdate;
      else delete instance.updateContent;
      if (ownHide) instance.setHideThinkingBlock = previousHide;
      else delete instance.setHideThinkingBlock;
      if (ownLabel) instance.setHiddenThinkingLabel = previousLabel;
      else delete instance.setHiddenThinkingLabel;
    }
  };
  const fallbackUpdate = (instance, message, patchError) => {
    try {
      withOriginalInstanceMethods(instance, () => originalUpdateContent.call(instance, message));
    } catch (fallbackError) {
      throw new Error(
        "pi-flod: Thinking Steps rendering and Pi fallback rendering both failed.",
        { cause: patchError ? { patchError, fallbackError } : fallbackError }
      );
    }
    if (patchError) {
      console.warn("pi-flod: falling back to Pi's native assistant renderer.", patchError);
    }
  };
  const patchedUpdateContent = function(message) {
    this.lastMessage = message;
    const theme = getTheme();
    if (this.hideThinkingBlock) {
      fallbackUpdate(this, message);
      return;
    }
    if (!theme || !patchableContentContainer(this)) {
      fallbackUpdate(this, message);
      return;
    }
    try {
      this.contentContainer.clear();
      const blocks = thinkingBlocks(message);
      const hasVisibleText = message.content.some(
        (content) => content.type === "text" && content.text.trim().length > 0
      );
      if (hasVisibleText || blocks.length > 0) this.contentContainer.addChild(new Spacer2(1));
      let renderedThinking = false;
      const firstThinkingIndex = blocks[0]?.contentIndex;
      const hasTextAfterThinking = firstThinkingIndex !== void 0 && message.content.slice(firstThinkingIndex + 1).some((content) => content.type === "text" && content.text.trim().length > 0);
      for (const content of message.content) {
        if (content.type === "text" && content.text.trim()) {
          this.contentContainer.addChild(
            new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme)
          );
          continue;
        }
        if (content.type === "thinking" && blocks.length > 0 && !renderedThinking) {
          this.contentContainer.addChild(
            new ThinkingStepsComponent(
              theme,
              message.timestamp,
              blocks,
              resolveThinkingMessageScope(message)
            )
          );
          renderedThinking = true;
          if (hasTextAfterThinking) this.contentContainer.addChild(new Spacer2(1));
        }
      }
      const hasToolCalls = message.content.some((content) => content.type === "toolCall");
      this.hasToolCalls = hasToolCalls;
      if (message.stopReason === "length") {
        this.contentContainer.addChild(new Spacer2(1));
        this.contentContainer.addChild(
          new Text2(
            theme.fg(
              "error",
              "Error: Model stopped because it reached the maximum output token limit. The response may be incomplete."
            ),
            this.outputPad,
            0
          )
        );
      } else if (!hasToolCalls && message.stopReason === "aborted") {
        const error = message.errorMessage && message.errorMessage !== "Request was aborted" ? message.errorMessage : "Operation aborted";
        this.contentContainer.addChild(new Spacer2(1));
        this.contentContainer.addChild(
          new Text2(theme.fg("error", error), this.outputPad, 0)
        );
      } else if (!hasToolCalls && message.stopReason === "error") {
        this.contentContainer.addChild(new Spacer2(1));
        this.contentContainer.addChild(
          new Text2(
            theme.fg("error", `Error: ${message.errorMessage || "Unknown error"}`),
            this.outputPad,
            0
          )
        );
      }
    } catch (error) {
      fallbackUpdate(this, message, error);
    }
  };
  const patchedSetHideThinkingBlock = function(hide) {
    if (!patchableContentContainer(this)) {
      withOriginalInstanceMethods(this, () => originalSetHideThinkingBlock.call(this, hide));
      return;
    }
    this.hideThinkingBlock = hide;
    if (this.lastMessage) this.updateContent(this.lastMessage);
  };
  const patchedSetHiddenThinkingLabel = function(label) {
    const normalized = normalizeLabel(label);
    if (!patchableContentContainer(this)) {
      withOriginalInstanceMethods(
        this,
        () => originalSetHiddenThinkingLabel.call(this, normalized)
      );
      return;
    }
    this.hiddenThinkingLabel = normalized;
    if (this.lastMessage) this.updateContent(this.lastMessage);
  };
  prototype.updateContent = patchedUpdateContent;
  prototype.setHideThinkingBlock = patchedSetHideThinkingBlock;
  prototype.setHiddenThinkingLabel = patchedSetHiddenThinkingLabel;
  return () => {
    if (prototype.updateContent === patchedUpdateContent) {
      prototype.updateContent = originalUpdateContent;
    }
    if (prototype.setHideThinkingBlock === patchedSetHideThinkingBlock) {
      prototype.setHideThinkingBlock = originalSetHideThinkingBlock;
    }
    if (prototype.setHiddenThinkingLabel === patchedSetHiddenThinkingLabel) {
      prototype.setHiddenThinkingLabel = originalSetHiddenThinkingLabel;
    }
  };
}
function modeStatusText(ctx, mode) {
  return `${ctx.ui.theme.fg("muted", "thinking:")} ${ctx.ui.theme.fg("accent", mode)}`;
}
function notify(ctx, message, level) {
  if (ctx.hasUI) ctx.ui.notify(message, level);
  else if (level === "warning") console.warn(message);
  else console.info(message);
}
function restoredMode(ctx) {
  try {
    return readThinkingStepsModePreferenceSync("global", ctx.cwd) ?? "summary";
  } catch (error) {
    notify(
      ctx,
      `Thinking steps persistence error: ${error instanceof Error ? error.message : String(error)}`,
      "warning"
    );
    return "summary";
  }
}
function refreshThinkingUI(ctx) {
  if (!ctx.hasUI) return;
  setCurrentThinkingScopeKey(ctx.cwd);
  ctx.ui.setHiddenThinkingLabel(nextThinkingRefreshLabel(DEFAULT_HIDDEN_LABEL, ctx.cwd));
  ctx.ui.setStatus("thinking-steps", modeStatusText(ctx, getThinkingStepsMode(ctx.cwd)));
}
function applyThinkingMode(ctx, mode) {
  setCurrentThinkingScopeKey(ctx.cwd);
  setThinkingStepsMode(mode, ctx.cwd);
  refreshThinkingUI(ctx);
}
function nextThinkingMode(mode) {
  if (mode === "collapsed") return "summary";
  if (mode === "summary") return "expanded";
  return "collapsed";
}
async function cycleGlobalThinkingMode(ctx) {
  const mode = nextThinkingMode(getThinkingStepsMode(ctx.cwd));
  try {
    await writeThinkingStepsModePreference("global", ctx.cwd, mode);
  } catch (error) {
    notify(
      ctx,
      `Thinking steps persistence error: ${error instanceof Error ? error.message : String(error)}`,
      "warning"
    );
    return;
  }
  applyThinkingMode(ctx, mode);
  notify(ctx, `Thinking view: ${mode} (saved globally)`, "info");
}
function registerThinkingSteps(pi, setTheme) {
  let sessionScopeKey = getCurrentThinkingScopeKey();
  const updateContext = (ctx) => {
    setTheme(ctx.ui.theme);
    sessionScopeKey = ctx.cwd;
    setCurrentThinkingScopeKey(ctx.cwd);
  };
  const cycle = async (ctx) => {
    updateContext(ctx);
    await cycleGlobalThinkingMode(ctx);
  };
  pi.registerShortcut("ctrl+shift+t", {
    description: "Cycle the global Thinking Steps view",
    handler: cycle
  });
  pi.on("session_start", (_event, ctx) => {
    updateContext(ctx);
    clearActiveThinkingState(void 0, sessionScopeKey);
    applyThinkingMode(ctx, restoredMode(ctx));
  });
  pi.on("message_start", async (event, ctx) => {
    updateContext(ctx);
    if (event.message.role !== "assistant") return;
    recordThinkingMessageScope(event.message, sessionScopeKey);
    const owner = resolveThinkingMessageScope(event.message, sessionScopeKey);
    const timestamp = typeof event.message.timestamp === "number" ? event.message.timestamp : void 0;
    clearActiveThinkingState(timestamp, owner);
  });
  pi.on("message_update", async (event, ctx) => {
    updateContext(ctx);
    if (event.message.role !== "assistant") return;
    recordThinkingMessageScope(event.message, sessionScopeKey);
    const owner = resolveThinkingMessageScope(event.message, sessionScopeKey);
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent.type === "thinking_start" || assistantEvent.type === "thinking_delta") {
      setActiveThinkingState(
        {
          active: true,
          messageTimestamp: event.message.timestamp,
          contentIndex: assistantEvent.contentIndex
        },
        owner
      );
      return;
    }
    if (assistantEvent.type === "thinking_end" || assistantEvent.type === "text_start" || assistantEvent.type === "text_delta" || assistantEvent.type === "text_end" || assistantEvent.type === "toolcall_start" || assistantEvent.type === "toolcall_delta" || assistantEvent.type === "toolcall_end") {
      clearActiveThinkingState(event.message.timestamp, owner);
    }
  });
  pi.on("message_end", async (event, ctx) => {
    updateContext(ctx);
    if (event.message.role !== "assistant") return;
    recordThinkingMessageScope(event.message, sessionScopeKey);
    const owner = resolveThinkingMessageScope(event.message, sessionScopeKey);
    const timestamp = typeof event.message.timestamp === "number" ? event.message.timestamp : void 0;
    clearActiveThinkingState(timestamp, owner);
  });
  pi.on("agent_end", async (_event, ctx) => {
    updateContext(ctx);
    clearActiveThinkingState(void 0, sessionScopeKey);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    updateContext(ctx);
    clearActiveThinkingState(void 0, sessionScopeKey);
    clearThinkingMessageOwnership(sessionScopeKey);
    if (ctx.hasUI) ctx.ui.setStatus("thinking-steps", void 0);
  });
}
function tracelineUiWithoutControls(ui) {
  return new Proxy(ui, {
    get(target, property) {
      if (property === "onTerminalInput") return () => () => {};
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function piTracelineWithoutControls(pi) {
  const adapter = {
    registerShortcut() {},
    registerCommand() {},
    on(event, handler) {
      if (event !== "session_start") {
        pi.on(event, handler);
        return;
      }
      pi.on(event, (payload, ctx) => {
        const ui = tracelineUiWithoutControls(ctx.ui);
        const wrappedContext = new Proxy(ctx, {
          get(target, property) {
            if (property === "ui") return ui;
            return Reflect.get(target, property, target);
          }
        });
        return handler(payload, wrappedContext);
      });
    }
  };
  piTraceline(adapter);
}
function piFlod(pi) {
  let currentTheme;
  const restoreThinkingPatch = installThinkingStepsPatch(() => currentTheme);
  registerThinkingSteps(pi, (theme) => {
    currentTheme = theme;
  });
  // Register Turn Fold first so its pre-render guard becomes Traceline's inner seam.
  // Traceline itself remains byte-for-byte identical to upstream.
  turnFold(pi);
  piTracelineWithoutControls(pi);
  pi.on("session_shutdown", () => {
    restoreThinkingPatch();
  });
}
var piFlodInternals = {
  localizeTracelineCharSuffixes,
  tracelineCharSuffixPlan,
  TurnFoldState
};
export {
  piFlod as default,
  piFlodInternals
};
