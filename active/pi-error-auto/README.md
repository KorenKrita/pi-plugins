# pi-error-auto

> 强制原生重试并隐形续跑中断的 Pi 回合

**状态**：在用 · **仓库**：https://github.com/KorenKrita/pi-error-auto（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/pi-error-auto
```

安装后即按内置默认配置启用；新开会话或在当前会话执行 `/reload` 生效。

## 功能

用户不必再手动输入 `continue`，也不会给模型发送任何提示文本。插件会在以下情况自动恢复回合：

1. **强制原生重试**：助手报错，既不是 context overflow，也不属于 Pi 原本可重试的错误，并且 `forceNativeRetryForUnhandledErrors` 为开启状态时，把错误改判为可重试，交给 Pi 自带的重试循环（次数与退避由 Pi 的 `retry` 设置决定）。
2. **错误匹配续跑**：`stopReason === "error"`，错误文本命中 `errorPatterns`、未命中 `deferredErrorPatterns`，并且没有走强制重试。
3. **长度截断**：`stopReason === "length"`，且剩余上下文足够。
4. **只有思考就停止**：`stopReason === "stop"`，但只输出了 thinking 内容，没有文本或工具调用。
5. **静默停止**：在用户消息、工具结果或本插件自己的续跑标记之后，助手停止了，但没有可见输出。

## 使用

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 斜杠命令 | `/pi-error-auto:setup` | 把内置 `config.json` 复制到 `~/.pi/agent/extensions/pi-error-auto/config.json`；文件已存在时只提示，不覆盖 |

中断回合时直接按 `Escape`，走 Pi 的内置中断流程。插件不注册快捷键。

## 配置

配置按以下顺序查找，使用第一个存在的文件：

1. `./.pi-error-auto.json`（仅受信任项目）
2. `./.pi/pi-error-auto.json`（仅受信任项目）
3. `~/.pi/agent/extensions/pi-error-auto/config.json`（当前使用此处）
4. 插件内置的 `config.json`

配置文件读取或解析失败时，会弹出警告并改用内置默认值。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `forceNativeRetryForUnhandledErrors` | `true` | 把非 overflow、原本不可重试的错误改判给 Pi 原生重试 |
| `notifyOnForcedRetry` | `true` | 强制重试时弹出 warning 通知 |
| `maxConsecutiveAutoContinues` | `99` | 连续隐形续跑的上限（不影响强制重试） |
| `notifyOnAutoContinue` | `true` | 续跑时（及达到上限时）弹出通知 |
| `autoContinueOnLength` | `true` | 遇到 `length` 截断时续跑 |
| `minRemainingTokensForLengthAutoContinue` | `16384` | 已知剩余上下文 ≤ 该值时不续跑，交给 Pi 压缩；设为 `0` 关闭此检查 |
| `autoContinueOnThinkingOnlyStop` | `true` | 只输出 thinking 就停止时续跑 |
| `autoContinueOnSilentStopAfterTool` | `true` | 各类静默停止时续跑（控制 3 种静默停止场景） |
| `deferredErrorPatterns` | 27 项，如 `overloaded`、`rate limit`、`429`、`500`/`502`/`503`/`504`、`timeout`、`WebSocket error` 等 | 认为 Pi 或其他层已在重试的错误，本插件不续跑；设为 `[]` 可关闭这项排除 |
| `errorPatterns` | 15 项，如 `上游流式响应中断`、`stream interrupted`、`premature close`、`ECONNRESET`、`ETIMEDOUT`、`unexpected end of JSON input` 等 | 由本插件续跑的瞬时错误；设为 `[]` 关闭基于错误的续跑 |

两个模式列表都按子串匹配，不区分大小写。完整列表见源码中的 `config.json`。

## 实现要点

- 只有一个入口 `index.ts`（即 `package.json` 中的 `pi.extensions`）。它监听 `message_end`，只处理 `stopReason` 为 `error`、`length` 和 `stop` 的助手消息。
- 强制重试（`forced-retry.ts`）：用 `isContextOverflow` 和 `isRetryableAssistantError` 判断，排除不需要改判的错误。对需要改判的错误，把 `errorMessage` 改成 `network error: pi-error-auto forced retry`，原始错误追加到消息内容（`[pi-error-auto original error]`），并写入 `pi-error-auto-original-error` diagnostic。已经改判过的消息不会再改。
- 隐形续跑（`invisible-continue.ts`）：用 `pi.sendMessage()` 发送一个空的自定义消息，参数为 `customType: "pi-error-auto:resume"`、`display: false`、`triggerTurn: true`、`deliverAs: "followUp"`。`context` hook 在把消息交给 provider 之前过滤掉这类标记，因此 LLM 收不到任何新文本；忙碌状态、队列、重试、压缩和中断仍由 Pi 的 `AgentSession` 管理。
- 续跑的判断逻辑在 `auto-continue.ts`，参考了 pi-hodor 的触发模型；隐形续跑的传递方式参考了 pi-invisible-continue。
- 如果 `ctx.signal` 已中止（例如 Esc 触发的 `This operation was aborted`），插件既不强制重试也不续跑，并暂停自动续跑，直到下一次真实的用户输入。
- 当前有排队消息（`hasPendingMessages()`）时不续跑；每条用户消息都会把连续续跑计数清零。

## 注意事项

- 强制重试会把鉴权、配额、计费、请求无效这类原本致命的错误也送进重试，出错时会一直重试到 Pi 的 `retry` 上限。不需要这种行为时，关闭 `forceNativeRetryForUnhandledErrors`。
- 每次续跑都会在会话记录里留下一条隐藏的自定义消息，只作记账用：TUI 不显示，也不会发给 LLM。
- 强制重试后，原始错误文本会作为一个文本块追加到该条助手消息里。
- 项目级配置只在项目受信任时才会读取。

## 历史

取代了早期的 `retry-all` 插件。
