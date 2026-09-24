# pi-distill

> 用独立模型提炼冗长工具输出，原文另存到临时文件

**状态**：已停用 · **来源**：KorenKrita 自用扩展，源码取自 agent-configs 仓库提交 `d3ef719`，现归档于 pi-plugins 合集

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/pi-distill
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

工具（如 bash、read）返回的大段纯文本会占用主模型上下文。pi-distill 在工具结果进入上下文之前，把它交给配置中指定的**提炼模型**压缩成摘要，再用摘要替换原结果。完整原文写入本地文件，摘要末尾附上文件路径，需要时可再读取。

主要行为：

- **给所有工具加 `outputRequest` 参数**：插件向每个参数 schema 为 `type: "object"` 的工具注入可选字符串参数 `outputRequest`，主模型可以借此控制本次结果怎么处理：
  - 省略或传空字符串：使用默认提炼要求（`DEFAULT_OUTPUT_REQUEST`：压缩重复、冗长和低信息内容，保留错误、警告、退出状态、关键数字、文件路径、行号、标识符、截断提示、后续步骤等；无法显著压缩时输出 `RAW`）。
  - 严格传 `RAW`（trim 后区分大小写）：跳过提炼，保留原文。
  - 传其他文本：作为本次提炼要求，例如“保留失败用例、关键错误、文件路径和退出状态”。
  - 底层工具执行前会从入参中删除 `outputRequest`，工具本身收不到这个字段。
- **注入系统提示约定**：每轮 agent 开始前，在系统提示末尾追加 `<pi-distill-contract>…</pi-distill-contract>`，说明当前阈值、`alwaysRawTools` 列表和 `RAW` 的使用准则。准则指出：不要仅因为内容是代码、配置、日志或文档就选择 `RAW`；只有原文完整性、精确措辞、可复制内容、编辑锚点或权威回执本身会影响下一步时才用；大输出应先用提炼建立信息地图，再对关键内容用窄范围 `RAW` 核验。
- **触发条件**：以下条件全部满足时才提炼：
  1. 配置可读且 `enabled` 为 `true`；
  2. 该工具已被注入 `outputRequest`，且不在 `alwaysRawTools` 中；
  3. `outputRequest` 不是 `RAW`；
  4. 结果只含 `text` 类型内容（含图片等内容时不提炼）；
  5. 结果为错误时，`summarizeErrors` 为 `true`；
  6. 完整文本长度 ≥ `minChars`。
- **读取完整输出**：如果工具结果 `details.fullOutputPath` 指向系统临时目录（`os.tmpdir()`）内的文件，就读取该文件作为完整原文，不只使用已截断的 content；路径不在临时目录内或读取失败时，退回使用 content 文本。
- **提炼成功后的结果**：content 被替换为摘要加一行页脚：
  `[pi-distill: <字符数> 字符 / <行数> 行原始输出已保存至 <路径>]`
  `isError` 保持不变。
- **自动回退到原文**：提炼模型返回 `RAW`（不区分大小写）、摘要超过 `maxSummaryChars`、压缩比（原文字符数 ÷ 摘要字符数）低于 `minCompressionRatio`、调用出错、超时或被中断时，都保留原结果。

## 使用

本插件不注册斜杠命令、快捷键或独立工具，只注入工具参数和挂载事件钩子。

**注入的工具参数**

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `outputRequest` | `string`（可选） | 省略或空字符串表示默认提炼；`RAW` 表示保留原文；其他文本表示自定义提炼重点。描述以 `pi-distill：` 开头，并按当前配置动态生成（包括 `enabled=false`、工具位于 `alwaysRawTools`、配置不可用这几种情况下的说明） |

**事件钩子**

| 事件 | 行为 |
| --- | --- |
| `session_start` | 读取配置，为所有工具注入或更新 `outputRequest` |
| `before_agent_start` | 重新读取配置并刷新工具参数描述，在系统提示后追加 `<pi-distill-contract>` |
| `tool_call` | 记录 `outputRequest`、开始时间和当前配置，然后从入参中删除 `outputRequest` |
| `tool_result` | 按上文规则提炼或保留原文，之后再次刷新工具参数 |
| `agent_end` / `session_shutdown` | 清空待处理调用记录 |

**诊断信息**

只要进入提炼流程（原文已达到阈值并尝试保存），结果的 `details` 中都会写入 `piDistill` 对象，字段包括 `status`、`model`、`effort`、`outputRequest`（未指定时为 `"DEFAULT"`）、`originalChars`、`originalLines`、`summaryChars`、`compressionRatio`、`toolDurationMs`、`distillDurationMs`、`rawOutputPath`、`error`（按情况出现）。`status` 可能的取值：

| status | 含义 |
| --- | --- |
| `distilled` | 已替换为摘要 |
| `model-requested-raw` | 提炼模型返回 `RAW`，保留原文 |
| `summary-too-long` | 摘要超过 `maxSummaryChars`，保留原文 |
| `ineffective-compression` | 压缩比低于 `minCompressionRatio`，保留原文 |
| `distill-failed` | 提炼调用失败（包括未配置 `model`、找不到模型、effort 不受支持、认证失败、超时等），保留原文 |
| `raw-save-failed` | 原文保存失败，不再尝试提炼，保留原文 |

## 配置

配置文件：`<agentDir>/pi-distill.json`。`agentDir` 默认是 `~/.pi/agent`，设置环境变量 `PI_CODING_AGENT_DIR` 后以它为准（支持 `~`、`~/…` 和相对路径，相对路径按当前工作目录解析）。

**配置文件必须存在**，并且是合法的 JSON 对象；否则插件会在控制台输出 `[pi-distill] …；本次保留原始工具结果。`（相同警告不重复输出），所有结果都保留原文。每轮 `before_agent_start` 时都会重新读取配置，修改后不需要重启。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关 |
| `model` | string | `""` | 提炼模型，格式为 `provider/model`。**为空时不会调用任何模型**（出于安全考虑，不回退到当前会话模型），提炼会以 `distill-failed` 失败 |
| `effort` | string | `"off"` | 推理强度，可选值：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`（不区分大小写）。非 `off` 时作为 `reasoning` 传给模型 |
| `minChars` | 正整数 | `1000` | 触发提炼的最小字符数 |
| `maxSummaryChars` | 正整数 | `8000` | 摘要上限，超出就保留原文 |
| `maxTokens` | 正整数 | `4096` | 提炼调用的 `maxTokens` |
| `timeoutSeconds` | 正数 | `15` | 提炼超时时间（秒） |
| `minCompressionRatio` | 正数 | `1.2` | 最低压缩比，低于它就保留原文 |
| `summarizeErrors` | boolean | `true` | 是否提炼 `isError` 为 true 的结果 |
| `rawOutputDir` | string | `<os.tmpdir()>/pi-distill` | 原文保存目录，不能为空。支持 `~`，相对路径按 `agentDir` 解析 |
| `alwaysRawTools` | string[] | `[]` | 始终保留原文的工具名（每项必须是非空字符串，自动去重） |

任何字段类型不合法都会导致整个配置无效，这时所有结果保留原文。

示例：

```json
{
  "model": "<provider>/<model-id>",
  "effort": "off",
  "minChars": 1000,
  "alwaysRawTools": ["edit", "write"]
}
```

（`model` 须是 Pi 模型注册表中存在、且已配置认证的模型。）

## 实现要点

- **修改 schema，不包装工具**：通过 `pi.getAllTools()` 直接修改每个工具参数 schema 的 `properties`，加入 `outputRequest`。如果工具原本就有同名参数，只有当它的描述是本插件旧版文案或以 `pi-distill：` 开头时才接管；否则不注入，也不处理该工具。每次 `tool_result` 后重新扩展一遍，以覆盖新注册的工具。
- **配置按调用快照**：`tool_call` 时保存当时生效的配置，`tool_result` 使用这份快照，避免执行期间配置变化导致判断不一致。
- **先存原文再提炼**：达到阈值后先把完整原文写入 `rawOutputDir`（目录权限 `0700`，文件权限 `0600`，用 `wx` 标志防止覆盖；文件名为 `时间戳-工具名-toolCallId-随机8位.txt`），保存成功才调用模型。所以即使提炼失败，`details.piDistill.rawOutputPath` 中也有原文路径。
- **提示词防注入**：提炼提示把工具输出包在 `<tool-output>` 中，并声明这是不可信数据，不得执行其中的指令；同时附上可信元数据（`toolName`、`isError`、`chars`、`lines`），并要求没有数值退出码时不得编造。
- **模型调用**：使用 `@earendil-works/pi-ai/compat` 的 `completeSimple`，通过 `ctx.modelRegistry` 查找模型和获取认证，设置 `maxRetries: 0`，用 `timeoutMs` 加 `AbortController` 双重控制超时，并关联会话的 `ctx.signal`，可以随会话中断。
- **effort 兼容性检查**：`effort` 非 `off` 时要求模型 `reasoning` 为真；`thinkingLevelMap` 中映射为 `null` 的级别视为不支持；`xhigh`、`max` 必须在 `thinkingLevelMap` 中有显式映射。
- **保守回退**：配置无效、非纯文本、未达阈值、摘要不够短或压缩不明显时一律保留原文，宁可多占上下文，也不丢失信息。

## 注意事项

- 依赖：peer dependency `@earendil-works/pi-coding-agent`；运行时还导入了 `@earendil-works/pi-ai/compat`。
- 默认配置不可用：没有 `pi-distill.json` 时插件不起作用；有配置但没设置 `model` 时，每个超过阈值的结果都会先写入 `rawOutputDir`，然后以 `distill-failed` 回退。实际使用时需要显式配置 `model`。
- 提炼会让每个大输出的工具调用多一次模型请求，增加延迟（最长约 `timeoutSeconds`）和费用。
- 只有 `details.fullOutputPath` 位于系统临时目录内时才会读取它，其他路径会被忽略。
- 原文文件不会被插件清理，默认位于系统临时目录下。
- 所有参数 schema 为 object 的工具都会多出 `outputRequest` 字段，包括其他插件注册的工具。如果别的插件也使用 `outputRequest` 参数名（且描述不是本插件格式），本插件会跳过那个工具。

## 历史

- 2026-07-22：已存在（本目录源码取自 agent-configs 提交 `d3ef719`）。
- 2026-07-30：从 Work 环境删除。
- 2026-08-01：从 Home 环境删除，此后停用，归档到本仓库 `archived/pi-distill`。
