# pi-codex-ws-compaction

> 为自定义 Responses provider 提供 Codex 风格远程压缩 v2

**状态**：已停用 · **仓库**：https://github.com/KorenKrita/pi-codex-ws-compaction（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/pi-codex-ws-compaction
```

已停用插件未在当前 Pi 版本上验证，可能需要适配（`peerDependencies` 限定 Pi `>=0.81.1 <0.82.0`，Node.js `>=22`）。

前置条件：`~/.pi/agent/models.json` 中已声明一个 `api: "openai-responses"` 的 provider，且其 Responses 端点支持通过 HTTP 进行 compaction v2（`compaction_trigger` + 不透明的 `compaction` 产物）。修改配置或安装后需执行 `/reload`。

## 功能

- 对指定 provider 的指定模型接管 `streamSimple`：所有轮次通过 Pi 标准 Responses 客户端以普通 HTTP SSE 流式请求。
- Pi 压缩时，并行执行两件事：生成可移植的 Pi 文本摘要，以及向 `<baseUrl>/responses` 发起带 `x-codex-beta-features: remote_compaction_v2` 头和末尾 `{ "type": "compaction_trigger" }` 的请求，拿到服务端不透明的 `compaction` 产物。
- 将产物与近期用户消息一起保存在 Pi 的 compaction 条目（`details.remoteCompaction`）中；之后的轮次把它作为请求 `input` 回放，使 provider 保留加密的压缩上下文。
- 每次请求都剥离 `previous_response_id`，请求无状态且自包含，因此 Pi 压缩、会话树导航、ACM 回溯等上下文改写会在下一次请求立即生效。
- 远程压缩失败而本地摘要成功时，退回使用 Pi 文本摘要（有 UI 时弹出 warning）；两者都失败则交回 Pi 默认压缩流程。

不支持：旧版 `/responses/compact` 端点、Azure、ChatGPT OAuth/Codex provider、WebSocket 传输、`previous_response_id` 续接。

## 使用

无工具、斜杠命令或快捷键。安装并配置后自动生效，挂在 Pi 的压缩流程与 provider 请求上。

## 配置

路径：`~/.pi/agent/pi-codex-ws-compaction.json`（仅全局，不读项目级配置；文件不存在时全部使用默认值）。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 是否启用；`false` 时扩展不注册任何东西 |
| `provider` | string | `"local-responses"` | 要覆盖的 Pi provider id（精确匹配） |
| `models` | string[] | `["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]` | 模型 id 白名单（精确匹配，非空，自动去重） |
| `notify` | boolean | `false` | 首次对某模型生效时显示一次 TUI 提示 |

旧配置中的 `websocketUrl` 字段会被接受但忽略。配置非法（JSON 错误、类型不符、空字符串/空数组）时扩展加载直接报错，不会静默回退。API key 不从此配置读取，由 Pi 按 provider 正常解析。

示例：

```json
{
  "enabled": true,
  "provider": "local-responses",
  "models": ["gpt-5.5", "gpt-5.4"],
  "notify": false
}
```

## 实现要点

- 入口 `src/index.ts`（`package.json` 的 `pi.extensions`）：用 `pi.registerProvider(provider, { api: "openai-responses", streamSimple })` 覆盖已有 provider，只替换流函数，保留其模型与鉴权。
- `src/custom-stream.ts`：通过 `onPayload` 改写请求体——有匹配的远程压缩状态时把 `input` 替换为显式历史并删除 `messages`/`previous_response_id`，否则只删除 `previous_response_id`；非白名单模型直接走 `streamSimpleOpenAIResponses`。
- `session_before_compact` 中用 `Promise.allSettled` 并行调用本地摘要与远程压缩；远程请求体含 `store: false`、`stream: true`、`include: ["reasoning.encrypted_content"]`、`prompt_cache_key`（会话 id），并复用 `before_provider_request` 中观察到的 `reasoning`/`text` 配置。
- 远程响应必须收到 `response.completed` 且恰好一个 `compaction` 项，否则视为失败；回放历史 = 保留的真实用户消息（约 20,000 token 预算，从最新往前截断）+ `compaction` 项。
- 产物以 `modelKey`（`provider:api:id`）标记，仅在 provider、API、模型 id 全部匹配时回放；`message_end` 时把新消息追加到显式历史。
- 运行时状态（`src/state.ts`）为内存 Map：在 `session_before_switch`/`session_before_fork`/`session_before_tree`/`session_shutdown` 清除，在 `session_start`/`session_tree`/`session_compact` 时从当前分支重建，因此 reload/resume 后可恢复。
- 请求附带 Codex 身份头 `x-codex-installation-id`、`x-codex-window-id`、`session_id`；安装 id 读自 `$CODEX_HOME/installation_id`（默认 `~/.codex`），缺失或无效时会生成并写入。

## 注意事项

- 会话上下文会发送到配置的 provider/网关；不透明压缩产物会持久化在本地会话 JSONL 中。
- 可能在 `~/.codex/installation_id`（或 `$CODEX_HOME`）写入文件。
- 包名中的 "ws" 是历史遗留：0.2.0 起已移除 WebSocket 传输，全部走 HTTP SSE。
- 快速禁用：配置中设 `{ "enabled": false }` 后 `/reload`；卸载：`pi remove pi-codex-ws-compaction`。
- 派生自 [`algal/pi-openai-server-compaction`](https://github.com/algal/pi-openai-server-compaction)（Alexis Gallagher），MIT 许可。

## 历史

- 0.1.0（2026-07-22）：首个版本，普通轮次强制走 WebSocket 并支持 `previous_response_id` 续接。
- 2026-07-27：配置历史中注册过该插件。
- 0.2.0（2026-08-02）：移除 WebSocket 与 `previous_response_id` 续接，改为全 HTTP SSE 无状态请求。
- 当前：未加载，已停用；`~/.pi/agent/pi-codex-ws-compaction.json` 配置残留仍在。
