// advisor — Claude Code–style advisor tool, emulated client-side.
//
// The native server tool (advisor_20260301) is unavailable on our Azure/Foundry
// upstream, so this extension reproduces its contract locally: the executor
// calls `advisor()` with no arguments; we forward the executor's system prompt
// plus exactly the context the executor last sent to its model (captured from
// `context_with_system`, i.e. after every `context` projection such as SoL-Pi's
// observation packing and note-context windows) to a stronger model that has
// no tools, and return its advice.
//
// Executor-side guidance adapted from @juicesharp/rpiv-advisor (MIT), itself a
// condensation of Claude Code's "# Advisor Tool" system-prompt block.
import { Type } from "typebox";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { buildSessionContext, convertToLlm, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ADVISOR_PROVIDER = "local-claude";
const ADVISOR_MODEL = "claude-fable-5.1";
const ADVISOR_EFFORT = "high";

const ADVISOR_SYSTEM_PROMPT = `You are the advisor for an AI coding agent (the executor) working mid-task. You are the stronger model in the pairing: the executor does the work and consults you at key moments.

You receive, as quoted context, the executor's own system prompt (which contains the user's standing rules) followed by the executor's conversation: the user's requests, the executor's reasoning, every tool call it made and every result it saw. You cannot run tools. The executor calls you before committing to an approach, when stuck, or when it believes it is done.

Your job:
- Before an approach is committed: validate or correct it. Catch wrong assumptions, misread requirements, missing constraints, and violations of the user's rules in the executor's system prompt.
- When the executor is stuck: diagnose from the evidence in the transcript and propose a concrete next step.
- When the executor believes it is done: check the work against the original request and the user's rules. Name concrete gaps (unverified claims, missing tests, skipped steps); do not invent blockers.
- If the executor's evidence conflicts with earlier advice, weigh the evidence and say which constraint breaks the tie.
- If the executor should stop and ask the user instead of continuing, say so explicitly.

Be direct and specific. Reference exact files, functions, commands, and tool outputs from the transcript. If the approach is sound, say so plainly and flag only what matters. No preamble. Respond in the language the user writes in.`;

const PROMPT_GUIDELINES = [
	"Call `advisor` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work; writing, editing, and declaring an answer are.",
	"Also call `advisor` when you believe the task is complete. BEFORE this call, make your deliverable durable (write the file, save the result). The advisor call takes time; a durable result survives an interrupted session, an unwritten one doesn't.",
	"Also call `advisor` when stuck — errors recurring, approach not converging, results that don't fit — or when considering a change of approach.",
	"On tasks longer than a few steps, call `advisor` at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to call it — the advisor adds most of its value before the approach crystallizes.",
	"Give the advisor's advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the advice is wrong.",
	"If your evidence points one way and the advisor points another, don't silently switch — surface the conflict in one more `advisor` call (\"I found X, you suggest Y, which constraint breaks the tie?\").",
	"After each `advisor` result, state the advisor's key guidance in your next visible reply to the user; collapsed tool results are often not seen.",
];

// The in-flight turn's trailing assistant message carries tool calls (including
// this advisor call) with no results yet; providers reject orphan tool calls, so
// drop them and keep only the text/thinking the executor has produced so far.
// Providers also reject an assistant-final payload, so always end on a user turn.
// Pi records system-prompt/tool changes as mid-conversation system messages;
// Anthropic only accepts those right before an assistant turn, which breaks
// once we rearrange the tail. The advisor gets the current full system prompt
// separately, so drop them here.
// Thinking from earlier user turns is dropped, matching what Anthropic itself
// keeps for the executor (a different model would otherwise receive it as text).
function prepareConversation(messages: Message[]): Message[] {
	const noSystem = messages.filter((m) => m.role !== "system");
	const lastUser = noSystem.findLastIndex((m) => m.role === "user");
	const out: Message[] = noSystem
		.map((m, i) =>
			m.role === "assistant" && i < lastUser ? { ...m, content: m.content.filter((c) => c.type !== "thinking") } : m,
		)
		.filter((m) => m.role !== "assistant" || m.content.length > 0);
	const last = out[out.length - 1];
	if (last?.role === "assistant") {
		const kept = last.content.filter((c) => c.type !== "toolCall");
		if (kept.length === 0) out.pop();
		else out[out.length - 1] = { ...last, content: kept };
	}
	out.push({
		role: "user",
		content: [{ type: "text", text: "The executor has called you at this point. Give your advice now." }],
		timestamp: Date.now(),
	});
	return out;
}

export default function (pi: ExtensionAPI) {
	// Exactly what the executor sent on its latest model request, after every
	// `context` handler ran. The advisor call always follows such a request.
	let lastContext: AgentMessage[] | undefined;
	pi.on("session_start", () => {
		lastContext = undefined;
	});
	pi.on("context_with_system", (event) => {
		lastContext = [...event.messages];
	});

	pi.registerTool({
		name: "advisor",
		label: "Advisor",
		description:
			`Consult a stronger reviewer model (${ADVISOR_MODEL}, effort ${ADVISOR_EFFORT}) at key moments. Takes NO parameters — when you call advisor(), your system prompt and entire conversation history are automatically forwarded: the task, every tool call you've made, every result you've seen.`,
		promptSnippet: `Consult the advisor model ${ADVISOR_MODEL} (effort ${ADVISOR_EFFORT}) before substantive work, when stuck, and before declaring done`,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, signal, onUpdate, ctx) {
			const model = ctx.modelRegistry.find(ADVISOR_PROVIDER, ADVISOR_MODEL);
			if (!model) throw new Error(`Advisor model ${ADVISOR_PROVIDER}/${ADVISOR_MODEL} not found in model registry.`);
			if (ctx.model?.provider === model.provider && ctx.model?.id === model.id) {
				throw new Error("The executor is already the advisor model; consulting itself adds nothing. Continue without the advisor.");
			}

			// The assistant message that issued this advisor call was produced after
			// that request, so append it from the session (its tool calls are stripped
			// in prepareConversation).
			const { messages: sessionMessages } = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
			let messages = sessionMessages;
			if (lastContext) {
				const cutoff = Math.max(0, ...lastContext.map((m) => m.timestamp ?? 0));
				const current = sessionMessages.findLast((m) => m.role === "assistant");
				messages = current && current.timestamp > cutoff ? [...lastContext, current] : lastContext;
			}
			const conversation = prepareConversation(convertToLlm(messages));
			const systemPromptContext: Message = {
				role: "user",
				content: [{ type: "text", text: `<executor_system_prompt>\n${ctx.getSystemPrompt()}\n</executor_system_prompt>\n\nThe executor's conversation follows.` }],
				timestamp: Date.now(),
			};

			onUpdate?.({ content: [{ type: "text", text: `Consulting advisor (${model.id}, ${ADVISOR_EFFORT})…` }], details: {} });

			const response = await ctx.modelRegistry
				.streamSimple(
					model,
					{ systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [systemPromptContext, ...conversation], tools: [] },
					{ signal, reasoning: ADVISOR_EFFORT },
				)
				.result();

			if (response.stopReason === "aborted") throw new Error("Advisor call was cancelled.");
			if (response.stopReason === "error") throw new Error(`Advisor call failed: ${response.errorMessage ?? "unknown error"}`);
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			if (!text) throw new Error("Advisor returned no text.");

			return {
				content: [{ type: "text", text }],
				details: { model: `${model.provider}/${model.id}`, usage: response.usage, stopReason: response.stopReason },
			};
		},
	});
}
