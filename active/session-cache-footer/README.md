# session-cache-footer

> 自定义底栏，并在对话中插入 token、缓存、耗时与成本统计块

**状态**：在用 · **来源**：KorenKrita 自写的 Pi 扩展，原位于 `~/.pi/agent/extensions/session-cache-footer/`，由早期的 token-stats 统计功能演进而来

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/session-cache-footer
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

插件包含两部分：**会话底栏**和**统计块**。

### 1. 会话底栏（仅 TUI 模式）

`session_start` 时，如果 `ctx.mode === "tui"`，插件调用 `ctx.ui.setFooter` 替换底栏。底栏由上到下是：

1. **路径行**：当前 cwd。位于 `$HOME`（或 `USERPROFILE`）下时缩写成 `~`。有 git 分支时追加 ` (branch)`，有会话名时追加 ` • 会话名`。超出宽度时截断为 `...`。
2. **统计行**：
   - 左侧：`↑` 会话累计输入 token，`↓` 会话累计输出 token，`$` 会话累计成本（3 位小数）。数值来自当前会话所有 assistant 消息的 `usage`。模型走 OAuth 订阅时追加 ` (sub)`。最后是上下文占用 `百分比%/窗口大小`，百分比未知时显示 `?`。开启自动压缩（`SettingsManager.getCompactionEnabled()`）时追加 ` (auto)`。上下文占用超过 70% 显示警告色，超过 90% 显示错误色。
   - 右侧：模型 id。模型支持 reasoning 时追加 ` • <thinking level>`，thinking 关闭时显示 ` • thinking off`。可用 provider 多于 1 个时在前面加 `(provider)`，空间不够时先去掉 provider，再截断模型名。
   - token 数按 `k` / `M` 缩写：小于 1 万时保留一位小数，大于等于 1 万时取整。
3. **扩展状态行**（有状态时才显示）：其他扩展设置的状态文本。按 key 字母序排列，换行符和制表符替换为空格后拼成一行。

git 分支变化时底栏自动重绘。

### 2. token 统计块（`token-stats` 自定义条目）

插件监听 agent 生命周期事件，统计每个 turn 的指标，然后通过 `pi.appendEntry("token-stats", …)` 把统计块插入会话。显示方式由三种模式控制：

| 模式 | 含义（切换提示文案） | 行为 |
|---|---|---|
| `hidden` | 不展示 | 不插入统计块，指标照常统计 |
| `aggregate`（默认） | 单轮聚合展示 | 每次 agent 运行结束（`agent_end`）时插入一个汇总块，覆盖本次运行的所有 turn |
| `step` | 每步独立展示 | 每个 turn 结束（`turn_end`）时插入一个统计块 |

模式在 `agent_start` 时读取并锁定到本次运行结束，所以运行中切换模式要到**下一次运行**才生效，提示文案也写的是“下一整轮统计展示”。

统计块最上面是一条暗色分隔线，下面按语义分组显示，默认分成两行：

**第一行**
- `◷ 时钟 · duration`：结束时刻（按本地格式显示时:分）和总耗时
- `ttft · tps · model time · tool time`：首 token 延迟、输出速度、模型生成耗时、工具耗时
- `↓ in · ↑ out · think`：输入、输出、reasoning token
- `cache read · written · hit · saved`：缓存读取 token、缓存写入 token、命中率、缓存节省的费用

**第二行**
- `status · reason`：状态（`OK` / `LENGTH` / `ERROR` / `ABORTED`）和原始 stopReason
- `tools · failed · slowest · peak`：工具调用数、失败数、最慢的工具及其耗时、最大并发数
- `calls · retries · http · reset`：模型请求次数、重试次数（目前固定显示 `—`）、最后一次 HTTP 状态码、限流重置等待时间
- `stall`：停顿总时长 `×次数`
- `context · Δ`：上下文占用 `已用/窗口`，以及本 turn 或本次运行的上下文变化量（`+` 或 `−`）
- `cost · rate`：成本，以及每百万 token 的平均价格（`$x.xx/M`）

配色：
- `status`：`ERROR` 显示错误色，`ABORTED` / `LENGTH` 显示警告色，其他显示成功色。
- `http`：429 显示警告色，≥400 显示错误色，≥300 显示警告色，其他显示成功色。
- `context` 和 `Δ`：占用超过 70% 显示警告色，超过 90% 显示错误色。

终端宽度不够时按语义组换行。单个组放不下时，只在完整字段之间拆开。只有单个字段比终端还宽时才硬截断。分隔线比终端宽度短 2 列，避免写到最后一列导致折行残片。

## 使用

| 类型 | 标识 | 说明 |
|---|---|---|
| 快捷键 | `ctrl+shift+l` | 循环切换统计块显示模式：`step` → `hidden` → `aggregate` → `step`。切换结果写入配置文件，并弹出通知；写入失败时报错，模式保持不变 |
| 条目渲染器 | `token-stats` | `registerEntryRenderer`，把 `token-stats` 条目渲染成上面的统计块 |
| 底栏 | `ctx.ui.setFooter` | `session_start` 时安装，仅限 TUI 模式 |
| 事件钩子 | `agent_start` / `agent_end` | 重置聚合统计并锁定模式 / 在 `aggregate` 模式下插入汇总块 |
| 事件钩子 | `turn_start` / `turn_end` | 重置单 turn 计数并记录起始上下文 / 计算指标，在 `step` 模式下插入统计块 |
| 事件钩子 | `message_start` / `message_update` / `message_end` | 计算生成耗时、TTFT 和停顿，累加 usage，计算缓存节省 |
| 事件钩子 | `before_provider_request` / `after_provider_response` | 统计请求次数和上下文窗口 / 记录 HTTP 状态码和限流重置头 |
| 事件钩子 | `tool_execution_start` / `tool_execution_end` | 记录工具耗时区间、失败数、最慢工具和并发峰值 |
| 事件钩子 | `session_start` | 显示配置警告，安装底栏 |

本插件没有注册工具或斜杠命令。

## 配置

配置文件：`~/.pi/agent/session-cache-footer.json`

```json
{
  "displayMode": "aggregate"
}
```

| 字段 | 取值 | 默认值 |
|---|---|---|
| `displayMode` | `"hidden"` / `"aggregate"` / `"step"` | `"aggregate"` |

- 扩展加载时读取配置。文件不存在时自动创建，并写入 `aggregate`。
- 值无效、读取失败或创建失败时都退回 `aggregate`，并在 TUI 会话开始时弹出警告通知。
- 用 `ctrl+shift+l` 切换模式时会写回这个文件。写入是原子的：先写 `session-cache-footer.json.<pid>.tmp`，再 `rename` 覆盖；失败时删除临时文件。
- 无环境变量配置。显示路径时读取 `HOME` / `USERPROFILE` 来缩写 `~`。

## 实现要点

- **TPS 两级算法**：
  - 主算法：满足以下条件时，用 `输出 token /（流式跨度 − 停顿）` 计算，结果不带前缀：流式更新 ≥ 5 次、有效生成时间 ≥ 200ms、停顿时长小于有效时长。流式跨度指从第二次 `message_update` 到最后一次的时间。
  - 退化算法：条件不满足时，改用基于 `message_start`→`message_end` 生成时长的估算，结果带 `~` 前缀。停顿占比过高（有效时长 < 200ms，或停顿 > 生成时长的 85%）时，只扣除一半停顿时间。
  - 结果超过 10,000 t/s 视为不可信，显示 `—/s`。
  - 聚合模式的 TPS 一律按 `总输出 /（总生成时长 − 总停顿）` 估算，带 `~` 前缀。
- **按模型限制 TPS 上限**：同一 `provider:modelId` 用主算法测得的最高 TPS 会被记下。涉及工具调用的 turn 算出的 TPS 不会超过这个值，避免工具穿插导致速度被高估。
- **停顿检测**：相邻两次 `message_update` 间隔 ≥ 500ms 计为停顿。连续的停顿间隔只算一次，时长累加。
- **工具时间取区间并集**：并行执行的工具耗时不会重复计算。`turn_end` 时仍未结束的工具按执行到当前时刻计入，也参与最慢工具的比较。
- **缓存节省**：`(input 单价 − cacheRead 单价) × cacheRead token`，单价取自 `ctx.modelRegistry` 中的模型定价。支持按输入总量（input + cacheRead + cacheWrite）匹配 `tiers` 分档价格，选用满足条件的最高 `inputTokensAbove` 档。
- **限流重置时间**：依次检查以下响应头，取第一个非空值：`retry-after`、`x-ratelimit-reset-requests`、`ratelimit-reset`、`x-ratelimit-reset`、`anthropic-ratelimit-requests-reset`、`x-ratelimit-reset-tokens`、`anthropic-ratelimit-tokens-reset`。
  - 数值：秒数，或秒/毫秒级时间戳。
  - 时长串：如 `1m30s`、`500ms`。
  - 日期字符串。
  - 结果格式化为 `now` / `45s` / `2m30s` / `1h5m` / `1d2h` 等。
- **条目数据格式与向后兼容**：条目文本是用 ` │ ` 连接的 `LABEL value` 片段，例如 `STATUS OK`、`HIT 12k (80%)`。渲染器仍能解析旧版无标签格式：`LENGTH|ERROR|ABORTED`、`stall …`、`… t/s`、`$…/M`、`$…`、纯时长，以及只有 `WINDOW` 没有 `CONTEXT` 的旧条目。缺失字段显示默认占位值。
- **聚合口径**：
  - `ttft` 取第一个 turn 的值。
  - `duration` 从 `agent_start` 开始计时。
  - `status` 保留最后一个非 `OK` 的状态。
  - `http`、`reset`、`reason` 取最后一个 turn 的值。
  - `peak`、`slowest` 取所有 turn 中的最大值。
  - `Δ` 是从首个 turn 开始到最后一个 turn 结束的上下文变化。

## 注意事项

- 依赖 `@earendil-works/pi-coding-agent`（peerDependency）和 `@earendil-works/pi-tui`。
- 底栏只在 TUI 模式下安装。统计条目在所有模式下都会按显示模式写入会话。
- 本插件用 `setFooter` 替换底栏，会与其他同样调用 `setFooter` 的扩展冲突。其他扩展设置的状态文本会显示在第三行。
- 底栏的累计 token 和成本只统计会话条目中 assistant 消息的 `usage.input` / `usage.output` / `usage.cost.total`，不包含缓存读写 token。
- `retries` 字段目前没有数据来源，始终显示 `—`。
- 上下文窗口依次取自 `ctx.getContextUsage()`、模型注册表、请求时的 `ctx.model.contextWindow`，三者都没有时显示 `—`。
- 自动压缩开关（`(auto)` 标记）只在 `session_start` 时读取一次，会话中途修改设置不会更新。
- `hidden` 模式只是不插入统计块，统计计算照常进行。

## 历史

- 早期是独立的 token-stats 统计功能。本插件沿用了 `token-stats` 条目类型，渲染器保留了对旧版无标签格式的解析。
- 当前版本在同一个扩展里同时提供统计块和自定义底栏。原先放在 `~/.pi/agent/extensions/session-cache-footer/`，现收录到本合集的 `active/session-cache-footer`。
