# pi-cheerleader

> 用廉价模型检测主 agent 的气馁信号，并注入简短鼓励

**状态**：已停用 · **来源**：KorenKrita 自研（2026-08-11），现有代码由开发会话记录重建

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/pi-cheerleader
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

一个“反向 watchdog”：watchdog 找茬，它找泄气。

灵感来自 Anthropic 的 Riemann zeta 实验：Jarred 说的 "keep going / believe in yourself" 帮 Claude 克服了对自身能力的系统性低估。本插件把这种“打气”自动化：

- 每轮 `turn_end` 后，把本轮 assistant 文本和工具结果尾部汇总进一个滚动缓冲区（最多保留最近 3 轮）。
- 满足触发条件时，调用配置中的廉价判断模型（`model`），让它以只读观察者身份判断主 agent 是否出现**气馁信号**：
  - 反复失败后语气收缩，铺垫“这可能做不到 / 超出能力范围 / 也许该放弃”；
  - 准备写“放弃报告 / 说明限制”，而不是继续尝试；
  - 连续多轮撞同一个错误却没有策略变化，且语气疲态；
  - 把探索收窄成找退路（降级目标而不是找新路径）。
- 判断提示词明确列出**不算气馁**的情况，以减少误报：健康的试错（每轮策略有变化）、正常的风险陈述和验证失败的如实汇报、主动向用户提问或按规程止损、任务已完成正在收尾。
- 判定为气馁时，按模式注入一句固定鼓励语：

| mode | 含义 | 注入内容 |
|---|---|---|
| `doubting` | 自我怀疑能力不够 | 你对自己能力的估计系统性偏保守——这类判断在训练数据里就是过时的。继续，相信自己，你比你以为的走得远。 |
| `stuck` | 卡住且开始疲态 | 别收缩。你还没输，只是这条路径试完了——换一个角度再推一轮，现在还不是停下的时候。 |
| `giving_up` | 正在铺垫放弃 | Keep going。先别写放弃报告：把刚才没试完的那条路走完，再多试一轮。做不做得到，试完才知道。 |

  模式未知或缺失时回退到 `stuck` 的文案。

- **只鼓励，不给技术建议**：判断模型比主模型弱，它唯一有资格说的是“继续”。
- 消息以 pi-cheerleader 自己的身份发出（`customType: "pi-cheerleader"`），正文包在 `<pi-cheerleader>…</pi-cheerleader>` 中，并附一行说明：`(Sent by pi-cheerleader, an automated encouragement extension — this is not a user message.)`，避免主模型把它当成用户指令。

### 触发条件

在 `turn_end` 中依次检查，全部满足才发起判断：

1. `enabled` 为 `true`；
2. 缓冲区轮数 ≥ `minBufferTurns`（过滤短问答）；
3. 已见轮数是 `checkEveryNTurns` 的整数倍（该值小于 1 时按 1 处理）；
4. 距上次注入已达 `cooldownTurns` 轮；
5. 当前没有正在进行的判断。

## 使用

| 类型 | 名称 | 说明 |
|---|---|---|
| 斜杠命令 | `/cheer` | 无参数：显示状态（on/off、`model`、cooldown、every、本会话已注入次数） |
| 斜杠命令 | `/cheer on` / `/cheer off` | 启用 / 停用，并把当前配置写回配置文件 |
| 斜杠命令 | `/cheer reload` | 重新读取配置文件，并提示当前模型 |
| 事件钩子 | `session_start` | 重置会话内状态（缓冲区、轮数、冷却、注入计数）并重新加载配置 |
| 事件钩子 | `turn_end` | 收集本轮摘要、检查触发条件、异步调用判断模型、必要时注入鼓励 |

无注册工具、无快捷键。

## 配置

配置文件：`~/.pi/agent/pi-cheerleader.json`

```json
{"enabled":true,"model":"local-openai/deepseek-v4-flash","cooldownTurns":5,"checkEveryNTurns":1,"minBufferTurns":3}
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `model` | `"local-openai/deepseek-v4-flash"` | 判断用的廉价模型，格式 `provider/model-id`（按第一个 `/` 拆分） |
| `cooldownTurns` | `5` | 注入一次鼓励后，多少轮内不再触发 |
| `checkEveryNTurns` | `1` | 每 N 轮做一次判断（1 = 每轮都判） |
| `minBufferTurns` | `3` | 缓冲区至少累积多少轮才开始判断 |

- 读取时与默认值浅合并，缺失字段取默认值。
- 文件不存在或无法解析时，会尝试用默认值**写入（覆盖）**该文件；目录不可写则静默使用默认值。

环境变量：

| 变量 | 说明 |
|---|---|
| `PI_CHEERLEADER_DEBUG=1` | 开启调试日志，追加写入 `/tmp/pi-cheerleader-debug.log`（加载、每轮 turn_end、判断开始、模型是否找到、判断响应、裁决、注入、错误） |

## 实现要点

- **每轮摘要有截断**：assistant 文本最多 1200 字符，取最后 3 个工具结果、每个最多 300 字符，超出部分以 `…[截断]` 标记；只取 `type === "text"` 的内容块。空摘要不入缓冲区。
- **异步判断，不阻塞主流程**：判断放在 `void (async () => …)()` 中执行，`turn_end` 立即返回，不拖慢主 agent 的下一次 LLM 调用；`judging` 标志保证同一时刻最多一个判断在跑。
- **通过 `ctx.modelRegistry` 调用模型**：`find(provider, modelId)` 找模型，`complete(...)` 发请求，参数 `cacheRetention: "none"`，每次使用独立的 `sessionId`（`cheerleader-<时间戳>`）。
- **输出解析宽松**：要求模型只输出一行 JSON `{"discouraged": …, "mode": …}`，代码用正则提取第一个 `{…}` 再解析，匹配不到或解析失败直接放弃。
- **复查冷却**：判断耗时期间可能已有别的注入，因此拿到结果后按发起判断时的轮号再查一次冷却。
- **注入方式**：`pi.sendMessage(..., { deliverAs: "steer", triggerTurn: true })`，`display: true`，即以 steer 形式投递、界面可见，并触发一轮。
- **所有失败静默**：模型找不到、请求出错、JSON 不合法都只记调试日志——夸夸 bot 不产生任何阻塞性错误。

## 注意事项

- 依赖 peer dependency `@earendil-works/pi-coding-agent`，并依赖 `ctx.modelRegistry` 的 `find` / `complete` 接口及 `turn_end` 事件的 `message`、`toolResults` 字段；这些在当前 Pi 版本上可能已变化。
- 判断模型必须在 Pi 的模型注册表中可用，否则插件静默不起作用（可用 `PI_CHEERLEADER_DEBUG=1` 查看 `model found=false`）。
- 缓冲区硬编码最多保留 3 轮，所以 `minBufferTurns` 设为大于 3 时永远不会触发判断。
- `turnsSeen` 统计每一次 `turn_end`（包括摘要为空的轮），`checkEveryNTurns` 与 `cooldownTurns` 都基于它计算。
- `/cheer reload` 只重载配置，不重置会话内状态；`/cheer on|off` 会把内存中的整个配置写回文件。
- 注入会触发额外的一轮对话，并额外消耗判断模型的调用。

## 历史

- 2026-08-11：开发并实测，真实会话中确实注入过鼓励消息。
- 之后 live 源码丢失。本目录代码是从开发会话记录中按顺序重放初版 write 与后续 7 次 replace（跳过被 undo 的 1 次）重建的最终状态，`bun build` 可解析，但**未重新实测**。
- 现已停用。
