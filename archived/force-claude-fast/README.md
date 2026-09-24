# force-claude-fast

> 强制所有 Claude 模型请求使用 AWS Bedrock Priority 服务层级

**状态**：已停用 · **来源**：KorenKrita 自用扩展，源码取自 agent-configs 仓库 4628b48，入口函数为 `forceClaudeAwsPriority`

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/force-claude-fast
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

通过 Bedrock 或兼容 Bedrock 的网关调用 Claude 时，本扩展会在每次请求里声明使用 AWS Bedrock 的 Priority Tier（服务层级 `priority`），不需要逐次手动设置。

行为细节：

- **触发条件**：仅当前模型 `ctx.model` 存在，且其 `id` 转小写后包含 `claude` 时生效；其他模型的请求原样放行。
- **请求体（payload）**：在 `before_provider_request` 阶段：
  - 删除 Anthropic 原生 Fast Mode 字段 `speed`（与 Bedrock 服务层级无关，若存在则移除）；
  - 写入 `service_tier: "priority"`（已有值会被覆盖）；
  - 返回修改后的新 payload 对象。
- **请求头（headers）**：在 `before_provider_headers` 阶段：
  - 先删除所有名称与 `X-Amzn-Bedrock-Service-Tier` 大小写不敏感匹配的已有请求头；
  - 再写入 `X-Amzn-Bedrock-Service-Tier: priority`。
- 请求体与请求头两处同时注入，使直连 Bedrock 兼容端点和经网关转发两条路径的行为一致（Claude Code 的 Bedrock 传输层使用的就是这个 AWS 请求头）。
- 若 `event.payload` 或 `event.headers` 不是普通对象（为 `null`、数组或非对象时），对应钩子不做任何修改。

## 使用

安装后自动生效，没有工具、斜杠命令或快捷键。注册的事件钩子如下：

| 事件 | 作用 | 生效条件 |
| --- | --- | --- |
| `before_provider_request` | 从 payload 中移除 `speed`，设置 `service_tier: "priority"` | 模型 id 含 `claude`，且 payload 是对象 |
| `before_provider_headers` | 就地替换请求头为 `X-Amzn-Bedrock-Service-Tier: priority` | 模型 id 含 `claude`，且 headers 是对象 |

## 配置

无配置。服务层级 `priority` 与请求头名 `X-Amzn-Bedrock-Service-Tier` 都是源码中的常量（`PRIORITY_SERVICE_TIER`、`BEDROCK_SERVICE_TIER_HEADER`），要修改只能改源码。

## 实现要点

- **按模型 id 匹配而非 provider**：本地 provider 名为 `local-claude`，判断 `provider === "anthropic"` 不可靠，因此改为检查模型 id 是否包含 `claude`（不区分大小写）。
- **双通道注入**：兼容 Bedrock 的网关接受请求体里的 `service_tier` 字段，而 Bedrock 传输层使用 `X-Amzn-Bedrock-Service-Tier` 请求头，两处都写入可以覆盖两种路径。
- **清理冲突字段**：通过解构去掉 `speed`，避免把 Anthropic 原生 Fast Mode 参数与 Bedrock 服务层级混在一起发送。
- **请求头去重**：HTTP 头名不区分大小写，先删除所有大小写变体再写入，保证最终只有一个值为 `priority` 的该请求头。
- **payload 返回新对象，headers 就地修改**：`before_provider_request` 返回新对象替换原 payload；`before_provider_headers` 直接修改 `event.headers`，不返回值。
- **类型守卫**：`isObject` 排除 `null` 和数组，非普通对象时直接跳过，避免误改。

## 注意事项

- 依赖 peer dependency `@earendil-works/pi-coding-agent`，并要求其提供 `before_provider_request` 与 `before_provider_headers` 两个事件。
- 模型匹配规则较宽：id 中任何位置含 `claude` 都会被强制设为 Priority，包括不走 Bedrock 的 Claude 端点；这类端点会收到 `service_tier` 字段和 AWS 请求头，是否接受取决于该端点。
- 无条件覆盖：用户或其他扩展设置的 `service_tier`、同名请求头都会被替换为 `priority`，`speed` 字段会被删除。若与其他修改这些字段的扩展同时使用，结果取决于钩子的执行顺序。
- Priority Tier 的计费和可用性由 AWS Bedrock 或所用网关决定，本扩展只负责发出请求声明。
- `package.json` 标记为 `private`，`description` 为空。

## 历史

- 2026-07-22：扩展存在于 agent-configs（源码取自提交 4628b48）。
- 2026-07-23：删除，现归档于本仓库 `archived/force-claude-fast`。
