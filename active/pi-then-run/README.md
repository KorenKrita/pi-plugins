# pi-then-run

> 给写文件类工具加 `then_run` 参数，改完文件在同一次调用里跑校验命令。

**状态**：在用 · **来源**：KorenKrita 自写；本目录是本地 Git 项目 `~/Coding/pi-then-run` 在 2026-09-23（`db01671`）的快照。

中文速览：模型改完文件通常下一轮才跑测试/类型检查，多一次往返。本插件给 `replace`、`insert`、`write`、`edit` 等工具的 schema 追加可选的 `then_run: { command, timeout }`，写入成功后立即在项目目录执行命令，把 `[then_run:succeeded|failed|skipped]` 与输出追加到同一个工具结果；hashline 批量编辑只在批次最后一次调用执行。装了 pi-hashline-edit-pro 时可替代 NVlabs/SoL-Pi 的 Action Fusion。默认超时 120 秒（上限 900 秒），暂无配置文件。

安装（一行）：

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/pi-then-run
```

---

Adds an optional `then_run` argument to file-mutating tools registered by other Pi extensions — most usefully [pi-hashline-edit-pro](https://github.com/YuGiMob/pi-hashline-edit-pro)'s `replace` and `insert`, plus Pi's `write` — so the validation command you would run next executes in the same tool call. It replaces NVlabs/SoL-Pi Action Fusion when hashline is installed (see below).

```jsonc
// replace call
{ "remove_from": "JsEd", "remove_to": "JsEd", "replacement_lines": ["    return a + b"],
  "then_run": { "command": "bun test", "timeout": 120 } }
```

The tool result gains a trailing block:

```
[then_run:succeeded] $ bun test (exit 0)
3 pass
```

or `[then_run:failed] … (exit 1)` with the output, or `[then_run:skipped] … — <reason>` when nothing was written (mutation error, no-op, or an edit queued in a hashline batch — the batch's last call runs it).

## Complete validation logs

When command output exceeds 20,000 characters, the extension saves the complete combined stdout/stderr **before** making the head-and-tail preview. The result includes `Full output: <path>` and `details.then_run.fullOutputPath`; use `read` on that path to inspect omitted diagnostics.

Each log lives in a new private directory at `<session-directory>/then-run-<session-id>-<random>/output.log`. On POSIX, the directory is mode `0700` and the file is `0600`. Logs remain local, survive session resume, and are not automatically deleted. They can contain sensitive command output; treat them like the session transcript.

Relative `--session-dir` paths use Pi's process working directory (which can differ from the SDK session's project directory). Returned log paths are absolute.

Short output and skipped commands create no archive. If saving fails, or the session has no persistent directory, the complete output stays inline with an explicit `[then_run:archive_failed]` notice and `details.then_run.archiveError`. The command's success, exit code, timeout flag, and the mutation's error state are unchanged.

## Why not SoL-Pi Action Fusion

NVlabs/SoL-Pi's Action Fusion wraps Pi's built-in `edit`/`write`. If you use pi-hashline-edit-pro, `edit` is disabled and your edits go through `replace`/`insert`, which Action Fusion does not touch. This extension attaches to whatever tool names you configure without re-registering or forking them.

## How it attaches (no fork, no re-registration)

1. On `session_start` the `then_run` property is added to the target tools' live parameter schemas (TypeBox schemas are plain mutable objects and `pi.getAllTools()` returns them by reference), so the model sees it as a real parameter. Models that trust the schema over prose — Claude does — will not use an unadvertised field.
2. In the assistant `message_end` hook the argument is removed in place from the persisted tool call (so strict targets like hashline never see it) and parked by tool-call id.
3. In the toolResult `message_end` hook — after every extension's `tool_result` patch — the command runs and its output is appended.

Works in either load order relative to the target extension. Verified on Pi 0.85.1 with pi-hashline-edit-pro 4.2.1: single edit, same-file batch (only the last call runs), and both `packages` orders.

## Install

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/pi-then-run
```

Targets default to `replace`, `insert`, `write`, `edit`; default timeout 120 s (max 900). No configuration file yet.

## Develop

```bash
bun install && bun run verify
```
