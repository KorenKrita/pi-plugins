import type { Context } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_MODEL = "local-openai/deepseek-v4-flash";
const DEFAULT_PROMPT = `请生成一条中文加载短句，主题是“{theme}”。

当前任务：{task}

要求：程序员黑色幽默，克制，短句，不超过 {maxLength} 个字；结合当前任务；避免口号、套话和解释；结尾使用中文省略号。
{exclude}
只输出短句。`;
const SYSTEM_PROMPT = "你只生成简短的中文加载文案。严格只输出文案本身。";
const MAX_RECENT_VIBES = 5;

interface VibeConfig {
  theme: string | null;
  modelSpec: string;
  fallback: string;
  timeout: number;
  refreshInterval: number;
  promptTemplate: string;
  maxLength: number;
}

let config: VibeConfig = loadConfig();
let extensionCtx: ExtensionContext | null = null;
let currentGeneration: AbortController | null = null;
let isStreaming = false;
let lastVibeTime = 0;
let recentVibes: string[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSettingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".pi", "agent", "settings.json");
}

function readSettings(): Record<string, unknown> {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    console.debug(`[working-vibes] Failed to load ${path}:`, error);
    return {};
  }
}

function readSettingsForWrite(): Record<string, unknown> | null {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (isRecord(parsed)) return parsed;
    console.debug(`[working-vibes] Refusing to overwrite non-object settings at ${path}`);
    return null;
  } catch (error) {
    console.debug(`[working-vibes] Refusing to overwrite malformed settings at ${path}:`, error);
    return null;
  }
}

function loadConfig(): VibeConfig {
  const settings = readSettings();
  const rawTheme = typeof settings.workingVibe === "string" ? settings.workingVibe : null;
  const refreshSeconds = typeof settings.workingVibeRefreshInterval === "number" && Number.isFinite(settings.workingVibeRefreshInterval)
    ? Math.max(0, settings.workingVibeRefreshInterval)
    : 30;
  const maxLength = typeof settings.workingVibeMaxLength === "number" && Number.isFinite(settings.workingVibeMaxLength)
    ? Math.max(4, Math.floor(settings.workingVibeMaxLength))
    : 40;

  return {
    theme: rawTheme?.toLowerCase() === "off" ? null : rawTheme,
    modelSpec: typeof settings.workingVibeModel === "string" ? settings.workingVibeModel : DEFAULT_MODEL,
    fallback: typeof settings.workingVibeFallback === "string" ? settings.workingVibeFallback : "还在算…",
    timeout: 3000,
    refreshInterval: refreshSeconds * 1000,
    promptTemplate: typeof settings.workingVibePrompt === "string" ? settings.workingVibePrompt : DEFAULT_PROMPT,
    maxLength,
  };
}

function persistSetting(key: "workingVibe" | "workingVibeModel", value: string | null): boolean {
  const path = getSettingsPath();
  const settings = readSettingsForWrite();
  if (settings === null) return false;
  const nextSettings = { ...settings };
  if (value === null) delete nextSettings[key];
  else nextSettings[key] = value;

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(nextSettings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[working-vibes] Failed to persist ${key} to ${path}:`, error);
    return false;
  }
}

function buildPrompt(theme: string, userPrompt: string): string {
  const exclude = recentVibes.length > 0 ? `避免重复这些文案：${recentVibes.join("、")}` : "";
  return config.promptTemplate
    .replace(/\{theme\}/g, theme)
    .replace(/\{task\}/g, userPrompt.slice(0, 150))
    .replace(/\{exclude\}/g, exclude)
    .replace(/\{maxLength\}/g, String(config.maxLength));
}

function parseResponse(response: string): string {
  let vibe = response.trim().split("\n")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const body = vibe.replace(/[.…]+$/, "").trim();
  if (!body) return config.fallback;

  vibe = `${body}…`;
  if (vibe.length > config.maxLength) {
    vibe = `${vibe.slice(0, config.maxLength - 1).replace(/[.…]+$/, "")}…`;
  }
  return vibe;
}

function buildAiContext(prompt: string): Context {
  return {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [{ type: "text", text: prompt }],
      timestamp: Date.now(),
    }],
  };
}

async function generateVibe(prompt: string, signal: AbortSignal): Promise<string> {
  if (!extensionCtx || !config.theme) return config.fallback;

  const slashIndex = config.modelSpec.indexOf("/");
  if (slashIndex < 1) return config.fallback;
  const provider = config.modelSpec.slice(0, slashIndex);
  const modelId = config.modelSpec.slice(slashIndex + 1);
  if (!modelId) return config.fallback;

  const model = extensionCtx.modelRegistry.find(provider, modelId);
  if (!model) {
    console.debug(`[working-vibes] Model not found: ${config.modelSpec}`);
    return config.fallback;
  }

  const auth = await extensionCtx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    console.debug(`[working-vibes] Auth failed for ${provider}: ${auth.error}`);
    return config.fallback;
  }

  const response = await complete(model, buildAiContext(buildPrompt(config.theme, prompt)), {
    apiKey: auth.apiKey,
    headers: auth.headers,
    signal,
  });
  const text = response.content.find((content) => content.type === "text")?.text ?? "";
  if (!text && response.stopReason === "error" && response.errorMessage) {
    console.debug(`[working-vibes] Generation failed: ${response.errorMessage}`);
  }
  return parseResponse(text);
}

async function generateAndUpdate(prompt: string, setWorkingMessage: (message?: string) => void): Promise<void> {
  currentGeneration?.abort();
  const controller = new AbortController();
  currentGeneration = controller;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeout)]);

  try {
    const vibe = await generateVibe(prompt, signal);
    if (!isStreaming || controller.signal.aborted) return;

    recentVibes = vibe === config.fallback
      ? recentVibes
      : [vibe, ...recentVibes.filter((recent) => recent !== vibe)].slice(0, MAX_RECENT_VIBES);
    setWorkingMessage(vibe);
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      console.debug("[working-vibes] Generation failed:", error);
    }
  }
}

export function initVibeManager(ctx: ExtensionContext): void {
  extensionCtx = ctx;
  config = loadConfig();
}

export function getVibeTheme(): string | null {
  return config.theme;
}

export function setVibeTheme(theme: string | null): boolean {
  config = { ...config, theme };
  recentVibes = [];
  return persistSetting("workingVibe", theme);
}

export function getVibeModel(): string {
  return config.modelSpec;
}

export function setVibeModel(modelSpec: string): boolean {
  config = { ...config, modelSpec };
  return persistSetting("workingVibeModel", modelSpec);
}

export function onVibeBeforeAgentStart(prompt: string, setWorkingMessage: (message?: string) => void): void {
  if (!config.theme || !extensionCtx) return;

  isStreaming = true;
  setWorkingMessage(config.fallback);
  lastVibeTime = Date.now();
  void generateAndUpdate(prompt, setWorkingMessage);
}

export function onVibeAgentStart(): void {
  isStreaming = true;
}

export function onVibeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  setWorkingMessage: (message?: string) => void,
  agentContext?: string,
): void {
  if (!config.theme || !extensionCtx || !isStreaming) return;

  const now = Date.now();
  if (now - lastVibeTime < config.refreshInterval) return;

  let hint = agentContext && agentContext.length > 10 ? agentContext.slice(0, 150) : `使用 ${toolName} 工具`;
  if (!agentContext || agentContext.length <= 10) {
    if (toolName === "read" && toolInput.path) hint = `读取文件：${toolInput.path}`;
    else if (toolName === "write" && toolInput.path) hint = `写入文件：${toolInput.path}`;
    else if (toolName === "edit" && toolInput.path) hint = `编辑文件：${toolInput.path}`;
    else if (toolName === "bash" && toolInput.command) hint = `执行命令：${String(toolInput.command).slice(0, 60)}`;
  }

  lastVibeTime = now;
  void generateAndUpdate(hint, setWorkingMessage);
}

export function onVibeAgentEnd(setWorkingMessage: (message?: string) => void): void {
  isStreaming = false;
  currentGeneration?.abort();
  currentGeneration = null;
  setWorkingMessage(undefined);
}
