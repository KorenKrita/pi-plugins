/**
 * bg — background jobs for pi, plus one `bash` tool with explicit deadlines.
 *
 * Tools:
 *   bash       — overrides the built-in bash: (command, timeout, background, onTimeout)
 *   bg_status  — list jobs, or one job's status + output tail
 *   bg_wait    — wait for one job, or for every running job (id optional)
 *   bg_kill    — terminate a job
 *
 * The bash override keeps built-in behavior by delegating to
 * `createBashToolDefinition` with custom operations: streaming output, 50KB /
 * 2000-line truncation with the full output saved to a temp file, the renderers,
 * and the built-in error wording ("Command timed out after N seconds") all come
 * from there.
 *
 * Every session_shutdown reason terminates the jobs. /reload rebinds the
 * extension and discards all in-memory state, so letting jobs survive a reload
 * would leave untracked processes behind.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type BashOperations,
	createBashToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionContext,
	getShellConfig,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Status = "running" | "exited" | "killed" | "timeout";
/** What happens when `timeout` elapses. */
type OnTimeout = "kill" | "detach";

interface Job {
	id: string;
	command: string;
	cwd: string;
	pid: number;
	logPath: string;
	timeoutSec: number;
	onTimeout: OnTimeout;
	startedAt: number;
	endedAt?: number;
	/** Set when a kill is requested: freezes `elapsed` until the process is reaped. */
	killRequestedAt?: number;
	exitCode: number | null;
	signal: string | null;
	status: Status;
	/** Armed only for jobs that still have a live deadline (not for promoted runs). */
	timer?: NodeJS.Timeout;
	/** Hourly "still running" reminder. */
	reminderTimer?: NodeJS.Timeout;
	/** Killed by bg_kill / shutdown → no completion notification. */
	silent: boolean;
	/** Spawn failure text, when the child never started. */
	error?: string;
	/** Open log fd owned by the job (promoted foreground runs). */
	logFd?: number;
	/** Resolved by `finish`; lets bg_wait and shutdown await the real exit. */
	waiters: Array<() => void>;
}

const KILL_GRACE_MS = 5_000;
const SHUTDOWN_GRACE_MS = 250;
const NOTIFY_DEBOUNCE_MS = 1_000;
const TAIL_LINES = 30;
const TAIL_BYTES = 4_000;
const MAX_RETAINED_FINISHED = 20;
/** Test hook: shorten the hourly reminder to exercise that path. */
const REMINDER_INTERVAL_MS = Number(process.env.PI_BG_REMINDER_MS) > 0 ? Number(process.env.PI_BG_REMINDER_MS) : 60 * 60 * 1000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export default function (pi: ExtensionAPI) {
	const jobs = new Map<string, Job>();
	/** Foreground runs that have not been promoted yet: killed on shutdown, never left behind. */
	const foregroundRuns = new Map<number, () => void>();
	let seq = 0;
	let ctxRef: ExtensionContext | undefined;
	let runDir = "";
	let pending: Job[] = [];
	let notifyTimer: NodeJS.Timeout | undefined;

	const fmtDur = (ms: number) => {
		const seconds = Math.max(0, Math.floor(ms / 1000));
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m${seconds % 60}s`;
		return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
	};
	/** Freeze at the kill request while the process dies, then at the real exit. */
	const elapsed = (j: Job) => fmtDur((j.endedAt ?? j.killRequestedAt ?? Date.now()) - j.startedAt);
	const isAlive = (j: Job) => j.endedAt === undefined;

	/** Read only the tail of the log: a multi-gigabyte build log must never be fully loaded. */
	function tail(j: Job, lines = TAIL_LINES): string {
		let fd: number | undefined;
		try {
			fd = openSync(j.logPath, "r");
			const size = fstatSync(fd).size;
			const readBytes = Math.min(size, TAIL_BYTES);
			const buf = Buffer.allocUnsafe(readBytes);
			let filled = 0;
			while (filled < readBytes) {
				const n = readSync(fd, buf, filled, readBytes - filled, size - readBytes + filled);
				if (n <= 0) break;
				filled += n;
			}
			let text = buf.subarray(0, filled).toString("utf8");
			// A byte offset taken mid-file can land inside a character or a line: drop that partial line.
			if (size > readBytes) {
				const firstBreak = text.indexOf("\n");
				text = firstBreak === -1 ? "" : text.slice(firstBreak + 1);
			}
			const arr = text.split("\n");
			if (arr.at(-1) === "") arr.pop();
			return arr.slice(-lines).join("\n") || "(no output)";
		} catch {
			return "(no output)";
		} finally {
			if (fd !== undefined) {
				try {
					closeSync(fd);
				} catch {
					/* already closed */
				}
			}
		}
	}

	function summary(j: Job, lines?: number): string {
		const state = isAlive(j)
			? j.status === "running"
				? `running (${elapsed(j)})`
				: `${j.status} — terminating (${elapsed(j)})`
			: `${j.status} exit=${j.exitCode ?? j.signal} after ${elapsed(j)}`;
		const deadline = j.timeoutSec > 0 ? `${j.timeoutSec}s → ${j.onTimeout}` : "none";
		const spawnError = j.error ? `\nspawn error: ${j.error}` : "";
		return `[${j.id}] ${clip(j.command, 120)} — ${state}${spawnError}\ntimeout: ${deadline}\nlog: ${j.logPath}\n--- tail ---\n${tail(j, lines)}`;
	}

	function refreshStatus() {
		if (!ctxRef) return; // cleared at shutdown; ctx is stale afterwards
		const n = [...jobs.values()].filter(isAlive).length + foregroundRuns.size;
		try {
			ctxRef.ui.setStatus("bg", n ? `bg: ${n} running` : "");
		} catch {
			ctxRef = undefined;
		}
	}

	/** Signal the whole process group; a negative pid only works because the child is detached. */
	function killTree(pid: number, sig: NodeJS.Signals) {
		if (!Number.isInteger(pid) || pid <= 0) return; // never signal pid 0 (group) or 1 (init)
		try {
			process.kill(-pid, sig);
		} catch {
			/* already gone */
		}
	}

	function kill(j: Job, status: Status, silent: boolean) {
		if (!isAlive(j)) return;
		j.silent = silent;
		j.status = status; // finish preserves status; endedAt stays unset while the process dies
		j.killRequestedAt = Date.now();
		killTree(j.pid, "SIGTERM");
		setTimeout(() => {
			if (isAlive(j)) killTree(j.pid, "SIGKILL");
		}, KILL_GRACE_MS).unref();
		refreshStatus();
	}

	/** Resolve when the job is reaped, the wait times out, or the caller aborts. */
	function waitForEnd(j: Job, timeoutMs: number, signal?: AbortSignal): Promise<void> {
		if (!isAlive(j) || signal?.aborted || timeoutMs <= 0) return Promise.resolve();
		return new Promise<void>((resolve) => {
			let settled = false;
			const settle = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", settle);
				j.waiters = j.waiters.filter((w) => w !== settle);
				resolve();
			};
			const timer = setTimeout(settle, timeoutMs);
			j.waiters.push(settle);
			signal?.addEventListener("abort", settle, { once: true });
		});
	}

	/** Keep the map bounded: only finished jobs are dropped, oldest first. */
	function evictFinished() {
		const finished = [...jobs.values()].filter((j) => !isAlive(j));
		for (const j of finished.slice(0, Math.max(0, finished.length - MAX_RETAINED_FINISHED))) {
			jobs.delete(j.id);
		}
	}

	/** One immediate steer message; used for watchdogs and hourly reminders, never batched. */
	function sendNotice(customType: string, text: string) {
		pi.sendMessage({ customType, content: text, display: true }, { deliverAs: "steer", triggerTurn: true });
	}

	function scheduleNotify(j: Job) {
		pending.push(j);
		if (notifyTimer) return;
		notifyTimer = setTimeout(() => {
			const batch = pending;
			pending = [];
			notifyTimer = undefined;
			const text = batch.map((x) => summary(x)).join("\n\n");
			pi.sendMessage(
				{
					customType: "bg-done",
					content: `Background job${batch.length > 1 ? "s" : ""} finished:\n\n${text}`,
					display: true,
				},
				{ deliverAs: "steer", triggerTurn: true },
			);
		}, NOTIFY_DEBOUNCE_MS);
	}

	/** After the first hour, report every hour that the job is still running. */
	function scheduleReminder(j: Job) {
		if (!(REMINDER_INTERVAL_MS > 0)) return;
		j.reminderTimer = setTimeout(() => {
			if (!isAlive(j)) return;
			sendNotice(
				"bg-reminder",
				`[${j.id}] ${clip(j.command, 80)} — still running (${elapsed(j)})\nlog: ${j.logPath}\nUse bg_status ${j.id} for the tail, bg_kill ${j.id} to stop it.`,
			);
			scheduleReminder(j);
		}, REMINDER_INTERVAL_MS);
		j.reminderTimer.unref();
	}

	/** Mirrors the PI_* injection the built-in bash does for its own children. */
	function sessionEnv(): NodeJS.ProcessEnv {
		const env = { ...process.env };
		for (const key of ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"]) {
			delete env[key];
		}
		const ctx = ctxRef;
		if (!ctx) return env;
		try {
			env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (sessionFile) env.PI_SESSION_FILE = sessionFile;
			const model = ctx.model;
			if (model) {
				env.PI_PROVIDER = model.provider;
				env.PI_MODEL = model.id;
			}
			if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
		} catch {
			/* ctx is stale after shutdown */
		}
		return env;
	}

	/** Wire a spawned child into the job table: exit bookkeeping, deadline, reminders. */
	function attachJob(job: Job, child: ChildProcess, armDeadline: boolean) {
		child.unref();
		const finish = (code: number | null, signal: string | null) => {
			if (job.timer) clearTimeout(job.timer);
			if (job.reminderTimer) clearTimeout(job.reminderTimer);
			if (job.endedAt !== undefined) return; // exit and error can both fire; the first one wins
			// Someone blocked in bg_wait reports this exit itself; a steer on top of it is noise.
			const awaited = job.waiters.length > 0;
			const waiters = job.waiters;
			job.waiters = [];
			job.endedAt = Date.now();
			job.exitCode = code;
			job.signal = signal;
			if (job.status === "running") job.status = "exited";
			if (job.logFd !== undefined) {
				try {
					closeSync(job.logFd);
				} catch {
					/* already closed */
				}
				job.logFd = undefined;
			}
			for (const w of waiters) w();
			refreshStatus();
			if (!job.silent && !awaited) scheduleNotify(job);
			evictFinished();
		};
		child.on("exit", finish);
		child.on("error", (error: unknown) => {
			job.error = error instanceof Error ? error.message : String(error);
			finish(-1, null);
		});
		if (armDeadline && job.timeoutSec > 0) {
			job.timer = setTimeout(() => {
				if (!isAlive(job)) return;
				if (job.onTimeout === "kill") {
					kill(job, "timeout", false);
					return;
				}
				// Watchdog: the deadline passed, the job keeps running, say so once.
				sendNotice(
					"bg-notice",
					`[${job.id}] ${clip(job.command, 80)} — still running past its ${job.timeoutSec}s deadline (${elapsed(job)})\nonTimeout is "detach", so it was not killed. log: ${job.logPath}`,
				);
			}, job.timeoutSec * 1000);
		}
		jobs.set(job.id, job);
		refreshStatus();
		scheduleReminder(job);
	}

	function newJob(fields: { command: string; cwd: string; pid: number; logPath: string; timeoutSec: number; onTimeout: OnTimeout; startedAt: number; status?: Status }): Job {
		return {
			id: `bg${++seq}`,
			command: fields.command,
			cwd: fields.cwd,
			pid: fields.pid,
			logPath: fields.logPath,
			timeoutSec: fields.timeoutSec,
			onTimeout: fields.onTimeout,
			startedAt: fields.startedAt,
			exitCode: null,
			signal: null,
			status: fields.status ?? "running",
			silent: false,
			waiters: [],
		};
	}

	function shellFor(cwd: string) {
		const settings = SettingsManager.create(cwd);
		const shell = getShellConfig(settings.getShellPath());
		const prefix = settings.getShellCommandPrefix();
		return { shell, prefix };
	}

	/** background: true — spawn detached with the log as stdout/stderr, return at once. */
	function spawnJob(command: string, cwd: string, timeoutSec: number, onTimeout: OnTimeout): Job {
		mkdirSync(runDir, { recursive: true });
		const id = `bg${seq + 1}`;
		const logPath = join(runDir, `${id}.log`);
		const fd = openSync(logPath, "w");
		const { shell, prefix } = shellFor(cwd);
		const full = prefix ? `${prefix}\n${command}` : command;
		const child = spawn(shell.shell, [...shell.args, full], {
			cwd,
			env: sessionEnv(),
			detached: true,
			stdio: ["ignore", fd, fd],
		});
		closeSync(fd);
		const job = newJob({ command, cwd, pid: child.pid ?? -1, logPath, timeoutSec, onTimeout, startedAt: Date.now() });
		attachJob(job, child, true);
		return job;
	}

	/**
	 * BashOperations that own the process, so a deadline can promote a foreground
	 * command into the job table instead of killing it. The built-in definition
	 * does the accumulation, truncation and formatting on top of this.
	 */
	function makeBashOperations(onTimeout: OnTimeout): BashOperations {
		return {
			exec: (command, cwd, { onData, signal, timeout, env }) =>
				new Promise<{ exitCode: number | null }>((resolve, reject) => {
					const startedAt = Date.now();
					// Only a run that can be promoted needs its output on disk.
					const needsLog = onTimeout === "detach";
					if (needsLog) mkdirSync(runDir, { recursive: true });
					const logPath = join(runDir, `run-${startedAt.toString(36)}-${seq + 1}.log`);
					const fd = needsLog ? openSync(logPath, "w") : undefined;
					const { shell } = shellFor(cwd);
					const child = spawn(shell.shell, [...shell.args, command], {
						cwd,
						env,
						detached: true,
						stdio: ["ignore", "pipe", "pipe"],
					});
					const pid = child.pid ?? -1;
					const timeoutSec = timeout && timeout > 0 ? timeout : 0;
					let settled = false;
					let promoted = false;
					let timedOut = false;
					let timer: NodeJS.Timeout | undefined;
					let killTimer: NodeJS.Timeout | undefined;
					const discardLog = () => {
						if (fd === undefined) return;
						try {
							closeSync(fd);
						} catch {
							/* already closed */
						}
						try {
							unlinkSync(logPath);
						} catch {
							/* already gone */
						}
					};
					const settle = (fn: () => void) => {
						if (settled) return;
						settled = true;
						if (timer) clearTimeout(timer);
						if (killTimer) clearTimeout(killTimer);
						signal?.removeEventListener("abort", onAbort);
						if (pid > 0) foregroundRuns.delete(pid);
						refreshStatus();
						fn();
					};
					const onAbort = () => {
						if (promoted) return; // it is a background job now; bg_kill owns it
						killTree(pid, "SIGTERM");
					};
					const write = (data: Buffer) => {
						if (fd !== undefined) {
							try {
								writeSync(fd, data);
							} catch {
								/* log closed */
							}
						}
						if (!settled) onData(data);
					};
					child.stdout?.on("data", write);
					child.stderr?.on("data", write);
					if (pid > 0) {
						foregroundRuns.set(pid, () => {
							killTree(pid, "SIGTERM");
							discardLog();
						});
					}
					refreshStatus();

					if (timeoutSec > 0) {
						timer = setTimeout(() => {
							if (settled || promoted) return;
							if (onTimeout === "kill") {
								timedOut = true;
								killTree(pid, "SIGTERM");
								killTimer = setTimeout(() => killTree(pid, "SIGKILL"), KILL_GRACE_MS);
								killTimer.unref();
								return;
							}
							// detach: keep the same process, hand it to the job table, return now.
							promoted = true;
							const job = newJob({
								command,
								cwd,
								pid,
								logPath,
								timeoutSec,
								onTimeout,
								startedAt,
							});
							job.logFd = fd;
							// Give the promoted run the job's own log name so bg_status paths match ids.
							const namedLog = join(runDir, `${job.id}.log`);
							try {
								renameSync(logPath, namedLog);
								job.logPath = namedLog;
							} catch {
								/* keep the temporary name */
							}
							attachJob(job, child, false);
							// The marker belongs in the tool result only — the job's log must stay pure command output.
							onData(
								Buffer.from(
									`\n[still running after ${timeoutSec}s — moved to background as ${job.id}; bg_status ${job.id} for the tail, bg_kill ${job.id} to stop it]\n`,
								),
							);
							settle(() => resolve({ exitCode: null }));
						}, timeoutSec * 1000);
					}

					const onError = (error: unknown) => {
						const message = error instanceof Error ? error.message : String(error);
						settle(() => {
							discardLog();
							reject(new Error(`spawn failed: ${message}`));
						});
					};
					child.on("error", onError);
					child.on("exit", (code, signalName) => {
						if (promoted) return; // the job table owns the bookkeeping now
						settle(() => {
							discardLog();
							if (timedOut) reject(new Error(`timeout:${timeoutSec}`));
							else if (signal?.aborted) reject(new Error("aborted"));
							else resolve({ exitCode: code });
						});
					});
					if (signal) {
						if (signal.aborted) onAbort();
						else signal.addEventListener("abort", onAbort, { once: true });
					}
				}),
		};
	}

	function need(id: string): Job {
		const j = jobs.get(id);
		if (!j) {
			throw new Error(
				`Unknown job ${id}. Known: ${[...jobs.keys()].join(", ") || "none"} (finished jobs are kept up to ${MAX_RETAINED_FINISHED}).`,
			);
		}
		return j;
	}

	// ── lifecycle ─────────────────────────────────────────────────
	pi.on("session_start", (_e, ctx) => {
		ctxRef = ctx;
		runDir = join(homedir(), ".pi", "agent", "bg", ctx.sessionManager.getSessionId());
	});

	pi.on("session_shutdown", async (_e) => {
		ctxRef = undefined;
		if (notifyTimer) clearTimeout(notifyTimer);
		notifyTimer = undefined;
		pending = [];
		for (const killRun of [...foregroundRuns.values()]) killRun();
		foregroundRuns.clear();
		const live = [...jobs.values()].filter(isAlive);
		for (const j of live) kill(j, "killed", true);
		// The SIGKILL escalation timer above never gets to run once pi exits, so reap here.
		if (live.length > 0) {
			await new Promise<void>((resolve) => {
				const bail = setTimeout(resolve, SHUTDOWN_GRACE_MS);
				let remaining = live.length;
				const done = () => {
					if (--remaining > 0) return;
					clearTimeout(bail);
					resolve();
				};
				for (const j of live) j.waiters.push(done);
			});
			for (const j of live) if (isAlive(j)) killTree(j.pid, "SIGKILL");
		}
		jobs.clear();
		try {
			rmSync(runDir, { recursive: true, force: true }); // sync: -p mode exits before any timer
		} catch {
			/* ignore */
		}
	});

	// ── tools ─────────────────────────────────────────────────────
	pi.registerTool({
		name: "bash",
		label: "bash",
		description:
			`Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first); if truncated, the full output is saved to a temp file. ` +
			`All four arguments are required: give an explicit timeout in seconds (0 = no deadline) and say what should happen when it elapses (onTimeout). ` +
			`background false waits for the result in this turn; background true returns a job id immediately and notifies you when the job finishes.`,
		promptSnippet: "Execute bash commands (ls, grep, find, etc.) with an explicit deadline",
		promptGuidelines: [
			"bash: state timeout in seconds and onTimeout deliberately — kill for lookups, checks and test runs; detach for builds or long jobs that must not be killed (they move to the background instead).",
			"bash: pass timeout 0 only for long-lived services and watchers; nothing will stop them except bg_kill or the end of the session.",
			"bash: use background true only when you have other work to do while it runs; background false waits and returns the result in this turn.",
			"You can inspect PI_* environment variables for current model and session details.",
			"Manage jobs with bg_status (state + tail), bg_wait (id optional = wait for every running job) and bg_kill.",
		],
		parameters: Type.Object({
			command: Type.String({ description: "Shell command" }),
			timeout: Type.Integer({
				minimum: 0,
				description:
					"Seconds until onTimeout applies. 0 = no deadline (long-lived services only). Typical: quick lookups 30-60, test suites 300-900, builds 900-1800.",
			}),
			background: Type.Boolean({
				description:
					"false: wait and return the result in this turn (anything that finishes in seconds). true: return a job id immediately and get notified when it finishes or hits onTimeout.",
			}),
			onTimeout: StringEnum(["kill", "detach"] as const, {
				description:
					'What happens when `timeout` elapses. "kill" terminates the command. "detach" lets it keep running: a foreground command moves to the background and this call returns early with the output so far.',
			}),
		}),
		prepareArguments: (args: unknown) => {
			const record = (args ?? {}) as Record<string, unknown>;
			const missing = (["command", "timeout", "background", "onTimeout"] as const).filter((k) => record[k] === undefined);
			if (missing.length > 0) {
				throw new Error(
					`bash requires all of: command, timeout, background, onTimeout. Missing: ${missing.join(", ")}. ` +
						'Pass timeout in seconds (0 = no deadline) and onTimeout "kill" or "detach".',
				);
			}
			return record as never;
		},
		async execute(_id, p, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("bash aborted before start");
			if (p.background) {
				const job = spawnJob(p.command, ctx.cwd, p.timeout, p.onTimeout);
				return {
					content: [
						{
							type: "text",
							text: `Started ${job.id} (pid ${job.pid}, timeout ${job.timeoutSec > 0 ? `${job.timeoutSec}s → ${job.onTimeout}` : "none"})\nlog: ${job.logPath}\nbg_status ${job.id} for the tail, bg_wait ${job.id} to block, bg_kill ${job.id} to stop it.`,
						},
					],
					details: {},
				};
			}
			const definition = createBashToolDefinition(ctx.cwd, {
				operations: makeBashOperations(p.onTimeout),
			});
			return definition.execute(
				_id,
				{ command: p.command, timeout: p.timeout > 0 ? p.timeout : undefined },
				signal,
				onUpdate,
				ctx,
			);
		},
	});

	pi.registerTool({
		name: "bg_status",
		label: "Background Status",
		description:
			"Without id: list all background jobs. With id: status, timeout, exit code, elapsed time and the last N lines of output.",
		parameters: Type.Object({
			id: Type.Optional(Type.String()),
			lines: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 200, description: `Tail lines (default ${TAIL_LINES})` }),
			),
		}),
		async execute(_id, p) {
			if (p.id) return { content: [{ type: "text", text: summary(need(p.id), p.lines) }], details: {} };
			const rows = [...jobs.values()].map(
				(j) => `${j.id}  ${j.status.padEnd(8)} ${elapsed(j).padStart(7)}  ${clip(j.command, 60)}`,
			);
			return { content: [{ type: "text", text: rows.join("\n") || "No background jobs." }], details: {} };
		},
	});

	pi.registerTool({
		name: "bg_wait",
		label: "Background Wait",
		description:
			"Block until a job exits (id omitted: until every running job exits) or maxWait seconds pass, then return status and output tails.",
		parameters: Type.Object({
			id: Type.Optional(Type.String({ description: "Job id. Omit to wait for every running job." })),
			maxWait: Type.Optional(
				Type.Integer({ minimum: 1, description: "Give up after this many seconds (default 120)." }),
			),
		}),
		async execute(_id, p, signal) {
			const maxWaitMs = (p.maxWait ?? 120) * 1000;
			if (p.id) {
				const j = need(p.id);
				await waitForEnd(j, maxWaitMs, signal);
				const note = isAlive(j)
					? signal?.aborted
						? "\n(still running — wait aborted)"
						: "\n(still running — bg_wait gave up)"
					: "";
				return { content: [{ type: "text", text: summary(j) + note }], details: {} };
			}
			const targets = [...jobs.values()].filter(isAlive);
			if (targets.length === 0) return { content: [{ type: "text", text: "No running jobs." }], details: {} };
			const deadline = Date.now() + maxWaitMs;
			await Promise.all(targets.map((j) => waitForEnd(j, Math.max(0, deadline - Date.now()), signal)));
			const stillRunning = targets.filter(isAlive).length;
			const text = targets.map((j) => summary(j)).join("\n\n");
			return {
				content: [
					{
						type: "text",
						text: `${text}${stillRunning > 0 ? `\n\n(${stillRunning} still running — bg_wait gave up)` : ""}`,
					},
				],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "bg_kill",
		label: "Background Kill",
		description:
			"Terminate a background job (SIGTERM, then SIGKILL after 5s). No completion notification is sent. This is the only way to stop a job started with timeout 0.",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, p) {
			const j = need(p.id);
			if (!isAlive(j)) {
				return { content: [{ type: "text", text: `${j.id} already ${j.status}` }], details: {} };
			}
			kill(j, "killed", true);
			return { content: [{ type: "text", text: `Killing ${j.id} (pid ${j.pid})` }], details: {} };
		},
	});
}
