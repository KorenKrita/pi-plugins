/**
 * pi-cheerleader — 反向 watchdog：watchdog 找茬，它找泄气。
 *
 * 每轮 turn_end 后，用一个廉价模型判断主 agent 是否出现气馁信号
 * （反复失败后语气收缩、铺垫做不到、把探索收窄成找退路）。
 * 判定为真时以 pi-cheerleader 自己的身份注入一句简短鼓励——
 * 只鼓励，不给技术建议（判断模型比主模型弱，它唯一有资格说的是"继续"）。
 *
 * 灵感：Anthropic Riemann zeta 实验——Jarred 的 "keep going / believe in
 * yourself" 帮 Claude 克服了对自身能力的系统性低估。
 *
 * 配置：~/.pi/agent/pi-cheerleader.json
 *   { "enabled": true, "model": "local-openai/deepseek-v4-flash",
 *     "cooldownTurns": 5, "checkEveryNTurns": 1, "minBufferTurns": 3 }
 * 命令：/cheer（状态 / on / off / reload）
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "pi-cheerleader.json");

interface Config {
	enabled: boolean;
	/** provider/model-id，判断用的廉价模型 */
	model: string;
	/** 注入一次鼓励后，多少轮内不再触发 */
	cooldownTurns: number;
	/** 每 N 轮才做一次判断（1 = 每轮都判） */
	checkEveryNTurns: number;
	/** 缓冲区至少累积多少轮才开始判断（过滤短问答） */
	minBufferTurns: number;
}

const DEFAULTS: Config = {
	enabled: true,
	model: "local-openai/deepseek-v4-flash",
	cooldownTurns: 5,
	checkEveryNTurns: 1,
	minBufferTurns: 3,
};

function loadConfig(): Config {
	try {
		const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
		return { ...DEFAULTS, ...raw };
	} catch {
		try {
			fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + "\n");
		} catch {
			/* 配置目录不可写时静默使用默认值 */
		}
		return { ...DEFAULTS };
	}
}

const JUDGE_SYSTEM_PROMPT = `你是一个只读观察者，判断一个正在干活的 coding agent 是否出现「气馁信号」。

气馁信号（任一即算）：
- 反复失败后语气转向收缩，开始铺垫"这可能做不到 / 超出能力范围 / 也许该放弃"；
- 准备写"放弃报告 / 说明限制"而不是继续尝试；
- 连续多轮撞同一个错误却没有任何策略变化，且语气疲态；
- 把探索收窄成找退路（找理由降级目标，而不是找新路径）。

不算气馁（不要误报）：
- 健康的试错：失败了但每轮策略有变化，语气仍在进攻；
- 正常的风险陈述、验证失败的如实汇报；
- 主动向用户提问或按规程止损回到讨论——那是纪律，不是泄气；
- 任务本身已经完成，正在收尾汇报。

只输出一行 JSON，无其他文字：
{"discouraged": true|false, "mode": "doubting"|"stuck"|"giving_up"|"none"}
mode 含义：doubting=自我怀疑能力不够；stuck=卡住且开始疲态；giving_up=正在铺垫放弃。`;

const CHEER_LINES: Record<string, string> = {
	doubting:
		"你对自己能力的估计系统性偏保守——这类判断在训练数据里就是过时的。继续，相信自己，你比你以为的走得远。",
	stuck: "别收缩。你还没输，只是这条路径试完了——换一个角度再推一轮，现在还不是停下的时候。",
	giving_up:
		"Keep going。先别写放弃报告：把刚才没试完的那条路走完，再多试一轮。做不做得到，试完才知道。",
};

export default function (pi: ExtensionAPI) {
	let cfg = loadConfig();

	/** 最近几轮的摘要缓冲（滚动 3 轮） */
	let buffer: string[] = [];
	let turnsSeen = 0;
	let lastInjectionTurn = -Infinity;
	let judging = false;
	let injections = 0;

	const DEBUG = process.env.PI_CHEERLEADER_DEBUG === "1";
	if (DEBUG) {
		try {
			fs.appendFileSync("/tmp/pi-cheerleader-debug.log", `${new Date().toISOString()} EXTENSION LOADED\n`);
		} catch {}
	}
	function dbg(msg: string) {
		if (!DEBUG) return;
		try {
			fs.appendFileSync("/tmp/pi-cheerleader-debug.log", `${new Date().toISOString()} ${msg}\n`);
		} catch {}
	}

	function reset() {
		buffer = [];
		turnsSeen = 0;
		lastInjectionTurn = -Infinity;
		judging = false;
		injections = 0;
	}

	pi.on("session_start", async () => {
		reset();
		cfg = loadConfig();
	});

	function extractText(message: unknown, cap: number): string {
		const m = message as { content?: unknown };
		if (!m || !Array.isArray(m.content)) return "";
		const parts: string[] = [];
		for (const c of m.content) {
			if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
				parts.push(String((c as { text?: string }).text ?? ""));
			}
		}
		const joined = parts.join("\n").trim();
		return joined.length > cap ? joined.slice(0, cap) + "…[截断]" : joined;
	}

	pi.on("turn_end", async (event, ctx) => {
		if (!cfg.enabled) return;

		const ev = event as { turnIndex?: number; message?: unknown; toolResults?: unknown[] };
		turnsSeen++;
		dbg(`turn_end #${turnsSeen} msgKeys=${ev.message ? Object.keys(ev.message as object).join(",") : "none"} toolResults=${(ev.toolResults ?? []).length}`);

		// —— 收集本轮摘要 ——
		const assistantText = extractText(ev.message, 1200);
		const toolTails = (ev.toolResults ?? [])
			.slice(-3)
			.map((r) => extractText(r, 300))
			.filter(Boolean)
			.join("\n---\n");
		const summary = [
			`[turn ${turnsSeen}]`,
			assistantText && `assistant: ${assistantText}`,
			toolTails && `tool tails:\n${toolTails}`,
		]
			.filter(Boolean)
			.join("\n");
		if (summary.length > `[turn ${turnsSeen}]`.length) {
			buffer.push(summary);
			if (buffer.length > 3) buffer.shift();
		}

		// —— 触发条件 ——
		if (buffer.length < cfg.minBufferTurns) return;
		if (turnsSeen % Math.max(1, cfg.checkEveryNTurns) !== 0) return;
		if (turnsSeen - lastInjectionTurn < cfg.cooldownTurns) return;
		if (judging) return;

		// —— 异步判断，不阻塞主线程的下一次 LLM 调用 ——
		judging = true;
		const slash = cfg.model.indexOf("/");
		const provider = cfg.model.slice(0, slash);
		const modelId = cfg.model.slice(slash + 1);
		const registry = (ctx as { modelRegistry?: { find: Function; complete: Function } })
			.modelRegistry;
		dbg(`judge start turn=${turnsSeen} registry=${!!registry}`);
		const snapshot = buffer.join("\n\n");
		const judgedAtTurn = turnsSeen;

		void (async () => {
			try {
				const model = registry?.find(provider, modelId);
				dbg(`model found=${!!model} for ${provider}/${modelId}`);
				if (!model) return; // 模型不可用时静默跳过
				const response = await registry!.complete(
					model,
					{
						systemPrompt: JUDGE_SYSTEM_PROMPT,
						messages: [
							{
								role: "user",
								content: [{ type: "text", text: snapshot }],
								timestamp: Date.now(),
							},
						],
					},
					{ cacheRetention: "none", sessionId: `cheerleader-${Date.now()}` },
				);
				const text = (response?.content ?? [])
					.filter((c: { type?: string }) => c?.type === "text")
					.map((c: { text?: string }) => c.text ?? "")
					.join("");
				dbg(`judge response: ${text.slice(0, 200)}`);
				const jsonMatch = text.match(/\{[^}]*\}/);
				if (!jsonMatch) return;
				const verdict = JSON.parse(jsonMatch[0]) as {
					discouraged?: boolean;
					mode?: string;
				};
				dbg(`verdict: ${JSON.stringify(verdict)}`);
				if (!verdict.discouraged) return;
				// 判断期间可能已有别的注入 → 复查冷却
				if (judgedAtTurn - lastInjectionTurn < cfg.cooldownTurns) return;

				const line = CHEER_LINES[verdict.mode ?? ""] ?? CHEER_LINES.stuck;
				lastInjectionTurn = judgedAtTurn;
				injections++;
				dbg(`INJECTING mode=${verdict.mode}`);
				pi.sendMessage(
					{
						customType: "pi-cheerleader",
						content: `<pi-cheerleader>${line}</pi-cheerleader>\n(Sent by pi-cheerleader, an automated encouragement extension — this is not a user message.)`,
						display: true,
					},
					{ deliverAs: "steer", triggerTurn: true },
				);
			} catch (err) {
				dbg(`judge error: ${err instanceof Error ? err.message : String(err)}`);
				/* 判断失败静默跳过——夸夸 bot 不产生任何阻塞性错误 */
			} finally {
				judging = false;
			}
		})();
	});

	pi.registerCommand("cheer", {
		description: "pi-cheerleader：状态 / on / off / reload",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim();
			if (arg === "on" || arg === "off") {
				cfg.enabled = arg === "on";
				try {
					fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
				} catch {}
				ctx.ui.notify(`pi-cheerleader: ${cfg.enabled ? "enabled" : "disabled"}`, "info");
				return;
			}
			if (arg === "reload") {
				cfg = loadConfig();
				ctx.ui.notify(`pi-cheerleader: config reloaded (${cfg.model})`, "info");
				return;
			}
			ctx.ui.notify(
				`pi-cheerleader: ${cfg.enabled ? "on" : "off"} · model=${cfg.model} · cooldown=${cfg.cooldownTurns} · every=${cfg.checkEveryNTurns} · injected=${injections} this session`,
				"info",
			);
		},
	});
}
