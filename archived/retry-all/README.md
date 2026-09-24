# retry-all

> 把不可重试的 API 错误改标为可重试，交给 Pi 原生重试

**状态**：已停用 · **来源**：KorenKrita 的 Pi 插件，源码取自 agent-configs `ff7fc90`，后被 pi-error-auto 取代

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/retry-all
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

Pi 只对它判定为“可重试”的助手/API 错误自动重试。像 `unexpected EOF` 这类无法识别的错误，或者 `insufficient_quota: billing limit reached` 这类 Pi 默认视为不可重试的错误，都会直接中止当前轮次。retry-all 会把这些错误**重新标记**为可重试的网络错误，让 Pi 原生的重试循环去处理。

触发时机：每条助手消息结束时（`message_end` 事件）。当消息同时满足以下条件时才会改写：

1. `role` 为 `assistant`；
2. `stopReason === "error"`，且 `errorMessage` 不为空；
3. 该消息还没被本插件改写过（`diagnostics` 中没有 `type` 为 `retry-all-original-error` 的条目）；
4. 不是上下文溢出（`isContextOverflow(message, contextWindow)` 为假），溢出交给 Pi 的压缩恢复处理，例如 `prompt is too long`；
5. Pi 原本不认为它可重试（`isRetryableAssistantError(message)` 为假），像 `503 service unavailable` 这类原生可重试错误保持不变。

以下情况不会处理：用户中止（`stopReason: "aborted"`）、正常结束的消息。

改写后的消息：

- `errorMessage` 替换为固定字符串 `network error: retry-all forced retry`，使 Pi 把它当作可重试错误；
- `content` 末尾追加一段文本 `[retry-all original error]\n<原始错误>`，保留原始错误原文；
- `diagnostics` 追加一条记录：`type: "retry-all-original-error"`、`timestamp`、`error: { message: <原始错误> }`、`details: { forcedRetry: true }`。

同时弹出一条 `warning` 级别的 UI 通知：`retry-all: forcing retry for <原始错误>`。

## 使用

安装后自动生效，没有工具、斜杠命令或快捷键。

| 类型 | 名称 | 作用 |
| --- | --- | --- |
| 事件钩子 | `message_end` | 检查助手错误消息，符合条件时返回 `{ message: replacement }` 替换原消息，并调用 `ctx.ui.notify(..., "warning")` |

`index.ts` 还导出了纯函数 `forceRetryMessage(message, contextWindow = 0)`：需要改写时返回新消息，否则返回 `undefined`。测试用的就是这个函数。

## 配置

无配置。上下文窗口大小取自 `ctx.model?.contextWindow`，取不到时为 `0`。

## 实现要点

- **复用 Pi 原生重试**：插件自己不实现重试循环，只改写错误分类，退避和重试流程都由 Pi 负责。
- **避开不可重试关键词**：源码注释说明，Pi 先检查不可重试关键词，再检查可重试标记。因此原始错误文本不能留在 `errorMessage` 中，否则仍会被判为不可重试。所以 `errorMessage` 整体替换为含 `network error` 的固定字符串。
- **原始错误不丢失**：原文同时写进 `content` 追加文本和 `diagnostics[].error.message` 两处。
- **防重复改写**：用 `diagnostics` 中的 `retry-all-original-error` 标记识别已改写的消息，不会再次处理。
- **放过上下文溢出**：溢出错误交给 Pi 的 compaction 恢复，不强制重试。
- **不改动原生可重试错误**：`isRetryableAssistantError` 已判定可重试的错误原样放行。
- 判定函数 `isContextOverflow`、`isRetryableAssistantError` 和类型 `AssistantMessage` 都来自 `@earendil-works/pi-ai`。

## 注意事项

- 依赖：peerDependency `@earendil-works/pi-coding-agent`（`*`），并从 `@earendil-works/pi-ai` 导入函数和类型。
- 额度耗尽、计费上限这类 Pi 默认不重试的错误也会被强制重试（有测试覆盖）。插件本身不限制重试次数。
- 被改写的消息里，`errorMessage` 不再是原始错误，要看原文请查消息内容或 `diagnostics`。
- 测试文件 `index.test.ts` 使用 `bun:test`。
- 已被 pi-error-auto 取代。

## 历史

- 2026-07-19：插件存在，源码取自 agent-configs `ff7fc90`。
- 2026-07-20：删除，相关功能由后来的 pi-error-auto 取代。
