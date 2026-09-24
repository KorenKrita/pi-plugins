# token-stats

> 每轮结束后在会话中追加一行 token、TTFT、TPS、缓存与费用统计

**状态**：已停用 · **来源**：KorenKrita 早期写的独立统计扩展，2026-07-17 备份到本合集的 `archived/`，后被 `session-cache-footer` 取代

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/token-stats
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

每个 agent turn（`turn_start` → `turn_end`）里，扩展汇总所有 assistant 消息的 usage 和流式时序。`turn_end` 时生成一行统计，用 `pi.appendEntry` 追加为 `token-stats` 类型的会话条目，并用 dim 颜色渲染。

各字段之间用 ` │ ` 分隔，按以下顺序输出（部分字段按条件出现）：

| 字段 | 出现条件 | 含义 |
|---|---|---|
| `LENGTH` / `ERROR` / `ABORTED` | `stopReason` 为 `length`、`error` 或 `aborted` 时 | 异常结束原因（大写） |
| `IN <n>` | 总是 | 本轮 `usage.input` 累加 |
| `OUT <n>` | 总是 | 本轮 `usage.output` 累加 |
| `THINK <n>` | `usage.reasoning` 为数字且累计 > 0 时 | 推理 token |
| `HIT <n> (<p>%)` | `cacheRead + cacheWrite > 0` 时 | 缓存读取量；命中率 = `cacheRead / (cacheRead + input + cacheWrite)`，四舍五入到整数 |
| `MISS <n>` | 同上 | 显示的是 `cacheWrite`（缓存写入量） |
| `TOOLS <n>` | 本轮有工具执行完成时 | `tool_execution_end` 次数 |
| `TTFT <t>` | 总是 | 从 `turn_start` 到本轮第一次 assistant `message_update` 的时间 |
| `<t>` | 总是 | 本轮总耗时（`turn_start` → `turn_end`） |
| `<x> t/s` / `~<x> t/s` / `— t/s` | 总是 | 输出速度：主分支测得的值不带前缀；回退分支的估算值带 `~`；无法测出时显示 `—` |
| `stall <t>×<n>` | 累计停顿时间 > 0 时 | 流式停顿总时长 × 停顿次数 |
| `$<cost>` | `usage.cost.total` 累计 > 0 时 | 本轮费用 |
| `$<rate>/M` | 有费用且 `totalTokens > 0` 时 | 混合单价 = `cost / (totalTokens / 1e6)`，保留 2 位小数 |

以下任一情况下，本轮**不输出**统计（与 pi-tps 的 null 条件一致）：没有 usage、`output <= 0`、没有收到首个 token，或拿不到模型信息（取 assistant 消息上的 `provider` + `model`）。

格式化规则：
- token 数：`567` → `567`，`1234` → `1.2k`，`2000` → `2k`，`1_500_000` → `1.5M`，另有 `B` 档；去掉末尾的 `.0`。
- 时长：60 秒以内显示 `2.3s`，60 分钟以内显示 `1m 30s`，更长显示 `2h 15m`。
- 费用：`< 0.001` 保留 5 位小数，`< 0.01` 保留 4 位，`< 1` 保留 3 位，其余保留 2 位。

## 使用

安装后自动生效，无工具、斜杠命令或快捷键。

| 类型 | 名称 | 作用 |
|---|---|---|
| 条目渲染器 | `token-stats`（`registerEntryRenderer`） | 以 `theme.fg("dim", …)` 渲染统计文本 |
| 事件 | `turn_start` | 重置本轮全部状态并记录起始时间 |
| 事件 | `message_start` | 仅处理 assistant 消息：记录消息开始时间，重置停顿时钟 |
| 事件 | `message_update` | 仅处理 assistant 消息：首次更新记为 TTFT；之后统计更新次数和流式窗口，并检测停顿 |
| 事件 | `tool_execution_start` | 把本轮标记为工具调用 turn |
| 事件 | `tool_execution_end` | 工具计数 +1 |
| 事件 | `message_end` | 仅处理 assistant 消息：累加生成时长，记录 `stopReason` 和模型，累加 usage |
| 事件 | `turn_end` | 计算 TPS 并追加统计条目 |

## 配置

无配置。阈值都是源码里的常量（与 `@monotykamary/pi-tps` 1.3.3 对齐）：

| 常量 | 值 | 用途 |
|---|---|---|
| `STALL_THRESHOLD_MS` | `500` | 两次更新间隔 ≥ 此值时算作一次推理停顿 |
| `MIN_STREAM_MS` | `1` | 主分支要求的最小流式窗口 |
| `MIN_STREAM_UPDATES` | `5` | 主分支要求的最少非 TTFT 更新次数 |
| `MIN_INTER_CHUNK_MS` | `1` | 主分支要求的最小平均块间隔 |
| `MIN_GENERATION_MS` | `200` | 有效生成窗口的下限 |
| `ACTIVE_TIME_THRESHOLD_MS` | `200` | 回退分支判断"停顿占主导"的有效时长阈值 |
| `STALL_REDUCTION_DENOM` | `2` | 停顿占主导时只扣除 1/2 停顿时间 |
| `STALL_DOMINANCE_RATIO` | `0.85` | 停顿超过生成窗口的 85% 即视为占主导 |
| `MAX_PLAUSIBLE_TPS` | `10_000` | 超过此值视为缓冲刷新或分发造成的伪影，结果置空（约为已知最快商用推理 ~2k tok/s 的 5 倍） |

## 实现要点

- **TTFT 与流式窗口分开计时**：每轮第一次 `message_update` 只用来记 TTFT 和设定停顿时钟起点，不算进更新次数和流式窗口，因为它和 `message_start` 之间的间隔属于 provider 解析开销。
- **停顿检测**：更新间隔 ≥ 500ms 时，把整段间隔计入 `stallMs`（阈值只用于判断是否停顿，不会从间隔中扣除）；连续停顿只计一次。`message_start` 和 `message_end` 都会重置停顿时钟，所以工具执行期间的空档不算推理停顿。
- **三分支 TPS 判定（`computeTps`，对齐 pi-tps `buildTelemetry()`）**：
  - 主分支：非 TTFT 更新 ≥ 5 次、平均块间隔 ≥ 1ms、`streamMs − stallMs ≥ 200ms`，且停顿时间少于非停顿时间。此时 TPS = `output / (streamMs − stallMs)`。
  - 回退分支：更新 ≥ 2 次且 `generationMs ≥ 200ms`。用整个生成窗口（`message_start` → `message_end` 之和）减去停顿时间；这个窗口包含 TTFT，有意偏低估。停顿占主导时只扣一半停顿时间，窗口下限为 200ms。
  - 其他情况（突发式交付、时序退化）返回 null。
- **按模型的 TPS 上限（`applyModelCap`）**：以 `provider:modelId` 为键，记录主分支测得的最高 TPS。工具调用 turn 的输出短、窗口小，TPS 容易虚高，因此会被压到这个上限以内；如果该模型还没有可靠的测量值，则直接置空。上限只存在内存里，与 pi-tps 相同。
- **按 turn 聚合**：一个 turn 里有多条 assistant 消息时，usage、费用和生成时长都会累加；模型信息取第一条带 `provider`/`model` 的消息；`stopReason` 取最后一次非空值。
- **显示方式**：统计写成独立的会话条目（`appendEntry`），不占用 footer 或状态栏。

## 注意事项

- 依赖 `@earendil-works/pi-coding-agent`（peerDependency），以及 `@earendil-works/pi-tui` 的 `Text` 组件。
- 已停用，功能已被 `session-cache-footer` 取代。
- TPS 模型上限只保存在内存中，会话重启后清空。
- 所有时间都在扩展侧根据事件到达时刻用 `performance.now()` 测量。
- `MISS` 显示的是 `cacheWrite`，并非"未命中的全部输入"。

## 历史

- 早期作为独立扩展，用于统计 token、TTFT、TPS、缓存和费用；TPS 判定逻辑对齐 `@monotykamary/pi-tps` 1.3.3。
- 后被 `session-cache-footer` 取代。
- 2026-07-17 备份到 `archived/token-stats`。
