// crew-lite — 线 A 单雇员记忆架构扩展（pi-crew TRACK-A.md §2）
//
// 只做四件事：
//   1. 最简 UI：每次 session 启动时保持工具输出折叠
//   2. ACM 索引管道：acm_travel 成功 → 索引行写 memini（LLM 写手 + 机械回退）
//   3. fold 提醒：budget 压力超阈值 → nextTurn 注入一条提醒（记 nudge-log）
//   4. 原生 compaction 监控：兜底一旦触发就记录为上下文维护事故
//
// 作用域保险：MEMINI_AGENT 为空则整个扩展 no-op（本扩展只属于雇员 workspace）。

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------- 配置 ----------
const MEMINI_BASE = process.env.MEMINI_BASE_URL || "http://127.0.0.1:8080"; // 公开版：原私有部署地址已替换为占位默认值
const AGENT = process.env.MEMINI_AGENT || "";
const KEYCHAIN_SERVICE = `memini-${AGENT}`; // key 不进 env/文件，从 keychain 取
const WRITER_PROVIDER = "local-openai";
const WRITER_MODEL_ID = "gemini-3.5-flash-lite";
const NUDGE_BUDGET_PCT = 75; // gauge budget 压力阈值（分母 min(window, 400K)）
const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;
const STATE_DIR = join(homedir(), ".crew-lite");

// ---------- 工具 ----------
function keychainSecret(): string | null {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", AGENT, "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return null;
  }
}

let cachedNamespace: string | null = null;
async function authoritativeNamespace(secret: string): Promise<string | null> {
  if (cachedNamespace) return cachedNamespace;
  try {
    const r = await fetch(`${MEMINI_BASE}/v1/handshake`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        project: {
          cwd_basename: process.cwd().split("/").pop() ?? "",
          toplevel_basename: process.cwd().split("/").pop() ?? "",
          toplevel_path: process.cwd(),
          agent: AGENT,
        },
        client: { name: "crew-lite", version: "0.1" },
      }),
    });
    if (r.ok) {
      const d = (await r.json()) as { namespace?: string };
      if (d.namespace) cachedNamespace = d.namespace;
    }
  } catch {
    /* 下次再试 */
  }
  return cachedNamespace;
}

function jsonl(file: string, obj: Record<string, unknown>) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(
      join(STATE_DIR, file),
      JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n",
    );
  } catch {
    /* 兜底日志失败不影响主流程 */
  }
}

type Handoff = {
  goal?: string;
  state?: string;
  next?: string;
  exclusions?: string;
  recover?: string;
};

function mechanicalContent(h: Handoff): string {
  const stateHead = (h.state || "").split(/[。\n]/)[0]?.trim() || "";
  return `${(h.goal || "").trim()} ⇒ ${stateHead}。next: ${(h.next || "").trim()}`.slice(0, 400);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b && typeof b === "object" && (b as { type?: string }).type === "text"
        ? ((b as { text?: string }).text ?? "")
        : "",
    )
    .join("");
}

// ---------- 扩展主体 ----------
export default function crewLite(pi: ExtensionAPI) {
  if (!AGENT) return; // 作用域保险：无雇员身份，整体 no-op

  let lastNudgeAt = 0;
  let lastTravelAt = 0;

  // ---- 1. 最简 UI：工具结果默认折叠，仍可用 Ctrl+O 临时展开 ----
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setToolsExpanded(false);
  });

  // ---- 2. ACM 索引管道 ----
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "acm_travel" || event.isError) return;
    lastTravelAt = Date.now();

    const input = (event.input ?? {}) as {
      target?: string;
      handoff?: Handoff | string;
    };
    let h: Handoff = {};
    if (typeof input.handoff === "string") {
      try {
        h = JSON.parse(input.handoff) as Handoff;
      } catch {
        h = { goal: input.handoff.slice(0, 200) };
      }
    } else if (input.handoff && typeof input.handoff === "object") {
      h = input.handoff;
    }
    if (!h.goal && !h.state) return;

    const sessionFile = ctx.sessionManager.getSessionFile() ?? "ephemeral";
    const resultText = extractText(event.content);
    const backup =
      /backup[^'"]*['"]([A-Za-z0-9._-]+)['"]/i.exec(resultText)?.[1] ?? "";

    // LLM 写手（modelRegistry.complete 自动鉴权；失败回退机械拼接）
    let content = "";
    let writer: "llm" | "mechanical" = "mechanical";
    try {
      const model = ctx.modelRegistry.find(WRITER_PROVIDER, WRITER_MODEL_ID);
      if (!model) jsonl("writer-error.jsonl", { err: "model not found in registry" });
      if (model) {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth?.ok || !auth.apiKey) {
          jsonl("writer-error.jsonl", { err: "no auth for writer model" });
          throw new Error("no-auth");
        }
        const resp = await complete(model, {
          messages: [
            {
              role: "user",
              content:
                "把下面的工作交接记录压成一行中文索引（<=80字），只输出这一行。要求：写结论与关键标识符（文件名/命令/数字），不写过程，未来按主题搜索时能命中。\n\n" +
                `goal: ${h.goal ?? ""}\nstate: ${h.state ?? ""}\nnext: ${h.next ?? ""}\nexclusions: ${h.exclusions ?? ""}`,
            },
          ],
        }, { apiKey: auth.apiKey, headers: auth.headers });
        const text = extractText(resp?.content).trim();
        if (text) {
          content = text.split("\n")[0].slice(0, 300);
          writer = "llm";
        }
      }
    } catch (err) {
      jsonl("writer-error.jsonl", { err: String(err).slice(0, 500) });
    }
    if (!content) content = mechanicalContent(h);

    const payload = {
      content,
      tier: "semantic", // episodic 会被服务端 low_signal 闸拦（2026-08-03 实测），索引行本就是 durable 检索条目
      level: "explicit",
      tags: ["acm-index"],
      ttl_seconds: -1,
      metadata: {
        kind: "acm-index",
        writer,
        session: sessionFile,
        target: input.target ?? "",
        backup,
        exclusions: h.exclusions ?? "",
        folded_at: new Date().toISOString(),
      },
    };

    const secret = keychainSecret();
    let ok = false;
    if (secret) {
      try {
        const ns = await authoritativeNamespace(secret);
        if (!ns) throw new Error("no authoritative namespace");
        const r = await fetch(`${MEMINI_BASE}/v1/memories`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "X-Memini-Namespace": ns,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const data = (await r.json().catch(() => ({}))) as { stored?: boolean };
          ok = data.stored !== false;
        }
      } catch {
        ok = false;
      }
    }
    if (!ok) jsonl("index-fallback.jsonl", { payload }); // 静默降级，不回填
    jsonl("index-log.jsonl", { ok, writer, content: content.slice(0, 120) });
  });

  // ---- 3. fold 提醒（nextTurn 档，不打断当前工作）----
  pi.on("turn_end", async (_event, ctx) => {
    const usage = ctx.getContextUsage();
    if (!usage || usage.tokens === null) return;
    const pct = (usage.tokens / Math.min(usage.contextWindow, 400_000)) * 100;
    if (pct < NUDGE_BUDGET_PCT) return;
    const now = Date.now();
    if (now - lastNudgeAt < NUDGE_COOLDOWN_MS) return;
    if (now - lastTravelAt < NUDGE_COOLDOWN_MS) return; // 刚 fold 过，不催
    lastNudgeAt = now;

    pi.sendMessage(
      {
        customType: "crew-lite-nudge",
        content:
          "[crew-lite] budget 压力已超 75%。对刚收尾的段落跑一次 fold test：能不看原文写出具体 handoff 就 fold；写不出说明未消化，继续工作——两个结果都正确。",
        display: true,
      },
      { deliverAs: "nextTurn" },
    );
    jsonl("nudge-log.jsonl", { pct: Math.round(pct) });
  });

  // ---- 4. 原生 compaction 仅作熔断兜底；触发即进入事故恢复 ----
  pi.on("session_compact", (event) => {
    const tokensBefore = event.compactionEntry.tokensBefore;
    jsonl("native-compaction-incident.jsonl", {
      reason: event.reason,
      willRetry: event.willRetry,
      fromExtension: event.fromExtension,
      tokensBefore,
    });
    pi.sendMessage(
      {
        customType: "crew-lite-compaction-incident",
        content:
          `[crew-lite] 上下文维护事故：Pi 原生 compaction 已触发（reason=${event.reason}, tokensBefore=${tokensBefore}）。` +
          "它只是最后熔断，不代表正常维护成功；继续工作前检查摘要，并从 ACM timeline、session JSONL 与 memini 恢复可能丢失的关键状态，再记录根因。",
        display: true,
      },
      { deliverAs: "nextTurn" },
    );
  });
}
