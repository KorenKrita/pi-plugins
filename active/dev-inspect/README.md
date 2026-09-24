# dev-inspect

> 查看系统提示词、逐次调用的 token 用量和上下文构成的调试命令

**状态**：在用 · **来源**：KorenKrita 自用的开发调试扩展，原为单文件扩展 `~/.pi/agent/extensions/dev-inspect.ts`，现收录于 pi-plugins 合集

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/dev-inspect
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

开发和调试 Pi 或其他扩展时，经常要回答这几个问题：模型实际收到的系统提示词是什么？开放了哪些工具？每次 LLM 调用花了多少 token、缓存命中多少？上下文窗口被什么占满了？读过的文件覆盖了哪些行？本扩展提供三个斜杠命令来查看这些信息。每个命令执行前都会先 `ctx.waitForIdle()`，等 agent 空闲后再采集数据，然后用 `pi.appendEntry` 往会话写入一条自定义条目，由扩展注册的渲染器显示出来。

### `/show-sysprompt`：生效的系统提示词与工具 schema

依次写入两条条目：

- **System prompt**：`ctx.getSystemPrompt()` 的完整内容。
- **Available tools**：只列出当前**激活**的工具（`pi.getActiveTools()` 与 `pi.getAllTools()` 取交集）。格式如下：
  ```
  <tool> - <description>
    <param>: <type> [required|optional] - <param description>
  ```
  没有参数的工具显示 `(no parameters)`；没有任何激活工具时显示 `No active tools.`。

两条条目默认折叠，只显示标题和行数（如 `(123 lines, Ctrl+o to expand)`），按 Ctrl+o 展开或折叠。

### `/llm-stats`：当前分支每次 LLM 调用的 token 用量

遍历 `ctx.sessionManager.getBranch()` 里的消息条目，每条带 `usage` 的 assistant 消息生成一行，各列含义如下：

| 列 | 含义 |
|---|---|
| `#` | 序号 |
| `delta` | 与上一条 assistant 消息的时间差（`+Ns`）；第一条显示本地时间 `HH:MM:SS`；拿不到时间戳时为 `-` |
| `model` | `provider/model`，缺失的部分显示为 `?` |
| `start` | 这次调用由什么触发：上一条消息是 user 时为 `user`，是 toolResult 时为 `tools`，其他情况为 `other` |
| `fresh` | `usage.input`（未命中缓存的输入） |
| `cacheR` | `usage.cacheRead` |
| `cacheW` | `usage.cacheWrite`；只要有一行不为 0 就显示该列，否则隐藏 |
| `input` | `fresh + cacheR + cacheW` |
| `output` | `usage.output` |
| `stop` | `stopReason` |
| `tools` | 本次回复中 toolCall 的工具名，用逗号分隔；没有时为 `-` |

数值会缩写为 `k` / `m` 形式（如 `12k`、`1.5m`）。没有 `usage` 的 assistant 消息不生成行，但它的时间戳仍然会作为下一行 `delta` 的计算基准。如果分支里没有带 usage 的 assistant 消息，显示 `No assistant messages with usage.`。

### `/show-context`：上下文 token 构成与文件读取覆盖图

写入一条条目，内容分为两部分。

**1. Context token breakdown（token 估算）**

- 标题行格式为 `≈估算总量 / 上下文窗口 (百分比) · Pi meter <ctx.getContextUsage().tokens>`。拿不到 Pi 自身的计量值时显示 `Pi meter unavailable`。上下文窗口优先取 `getContextUsage().contextWindow`，没有则取 `ctx.model.contextWindow`。
- 估算规则：字符数 ÷ 4；每张图片按 4800 字符计（约 1.2k token）；不计入 provider 的协议封装开销。
- 一条按类别着色的堆叠条，总长度对应上下文窗口；拿不到窗口大小时对应估算总量。未占用的部分用 `░` 表示。
- 分两组列出每个类别的估算 token 数、占比和计数：
  - **Prompt prefix**
    - `System prompt · base`：系统提示词扣除下面两段后的剩余部分
    - `Startup context files`：`<project_context>` 段（按 Pi 的格式重建后，只有能在系统提示词中原样找到时才单独计入）
    - `Advertised skills`：`formatSkillsForPrompt` 生成的技能列表段（同样要求原样命中；计数不含 `disableModelInvocation` 的技能）
    - `Tool definitions`：激活工具的 `{name, description, parameters}` 序列化为 JSON 后的长度
  - **Effective messages**（来自 `buildSessionContext(entries, leafId)`，即压缩或分支处理后实际生效的消息）
    - `User messages`
    - `Loaded skill bodies`：被 `parseSkillBlock` 识别出的技能块。块内附带的用户文本仍计入 User messages
    - `Assistant text`、`Assistant thinking`
    - `Tool calls`：工具名加上 JSON 参数
    - `Tool results`：文本部分
    - `Compactions`、`Branch summaries`、`User shell runs`：经 `convertToLlm` 转换后的文本长度；带 `excludeFromContext` 的 bash 执行不计入
    - `Custom messages`
    - `Images / media`
  - `Tool calls` 和 `Tool results` 下面还会按工具名展开子项（`├──` / `└──`），按字符数从多到少排序，并把该类别的 token 数按比例分给各子项。

**2. Context read map（文件读取覆盖图）**

每个出现在上下文中的文件显示为一条横条，**每个单元格代表 10 行**。

- 证据来源：
  - `startup-context`：启动时加载的上下文文件，覆盖其全文行数
  - `advertised-skill`：已公布给模型的技能文件，只覆盖 frontmatter 部分（第 1 行到结束 `---` 所在行；没有 frontmatter 时只算第 1 行）。文件不存在时跳过
  - `loaded-skill-body`：用户消息中的技能块，覆盖 frontmatter 之后的正文。`location` 中含 `${` 时跳过
  - `tool-read`：`read` 工具调用。按 `toolCallId` 与成功的（非 `isError`）结果配对，起始行取 `offset`（默认 1），行数取结果文本的行数，有 `limit` 时以 `limit` 为上限。结果是图片时记为 media，该文件总行数按 1 计
- 单元格字形：用盲文点阵表示读取次数。左半格表示前 5 行，右半格表示后 5 行，点数依次对应 1 / 2 / 3 / 4+ 次（`⣀` `⣤` `⣶` `⣿`）。没被读过的单元格留空。
- 单元格颜色：来源优先级为 `tool-read` > `loaded-skill-body` > 其他，同优先级取最近的一次。颜色含义为：系统提示词（启动上下文或已公布技能）用 `borderAccent`；已加载技能用 `accent`；read 工具按时间远近分三档：recent 用 `warning`，mid 用 `toolTitle`，old 用 `dim`（按证据序号占最大序号的比例划分，阈值 > 0.66 和 > 0.33）。
- 文件排序：启动上下文文件排最前，其次是已公布技能，两组内部都保持原始顺序；其余文件按最近一次证据从新到旧排列，相同时按路径排序。
- 文件总行数：文件存在时直接读磁盘计算；不存在时用证据的结束行兜底，文件名以 `warning` 色标出。
- 路径显示：在 `cwd` 下的文件显示相对路径，其余显示绝对路径。超过 50 字符的路径从中间截断（`…/…`）。
- 布局：终端宽度 ≥ 100 时，路径右对齐占 50 列，横条画在同一行；宽度更小时路径单独占一行。横条太长时换行，续行用 `↴` / `↳` 标记。
- 超链接：文件名和每个单元格都带 OSC 8 超链接，默认是 `file://…#L<行号>`。当 `TERM_PROGRAM=vscode` 时，单元格链接改为 `vscode://file<path>:<行号>:1`。
- 没有任何文件证据时显示 `No file-backed context evidence.`；条目数据不合法时显示 `Invalid context map data.`。

## 使用

### 斜杠命令

| 命令 | 说明 |
|---|---|
| `/show-sysprompt` | Show the effective system prompt and active tool schemas. |
| `/llm-stats` | Show per-call token usage for assistant responses in the current branch. |
| `/show-context` | Show token and file coverage breakdowns for the current model context. |

三个命令都不需要参数。

### 自定义条目类型与渲染器

| 条目类型 | 写入命令 | 渲染 |
|---|---|---|
| `dev-inspect.system-prompt` | `/show-sysprompt` | 可折叠，Ctrl+o 展开 |
| `dev-inspect.tool-schemas` | `/show-sysprompt` | 可折叠，Ctrl+o 展开 |
| `dev-inspect.llm-stats` | `/llm-stats` | 表格 |
| `dev-inspect.context-map` | `/show-context` | token 构成 + 文件覆盖图（随终端宽度自适应） |

不注册工具、快捷键或事件钩子。

## 配置

无配置。以下常量写死在源码中：

| 常量 | 值 | 含义 |
|---|---|---|
| `CHARS_PER_TOKEN` | `4` | token 估算除数 |
| `ESTIMATED_IMAGE_CHARS` | `4800` | 每张图片折算的字符数 |
| `LINES_PER_CELL` | `10` | 覆盖图中每个单元格代表的行数 |

唯一读取的环境变量是 `TERM_PROGRAM`：值为 `vscode` 时，单元格超链接使用 `vscode://file` 协议。

## 实现要点

- **只读展示**：命令只采集数据，再通过 `pi.appendEntry` 写入自定义条目，由 `pi.registerEntryRenderer` 渲染，不修改会话里已有的消息。
- **先等空闲**：每个命令先执行 `ctx.waitForIdle()`，避免在流式输出过程中采到不完整的数据。
- **数据来源不同**：`/llm-stats` 用 `sessionManager.getBranch()`，看的是当前分支上的全部原始消息；`/show-context` 用 `buildSessionContext(getEntries(), getLeafId())`，看的是压缩或分支摘要处理后实际生效的上下文。
- **系统提示词拆分靠字符串重建**：扩展按 Pi 的格式重建 `<project_context>` 段，并调用 `formatSkillsForPrompt` 生成技能段，再到系统提示词中做 `includes` 匹配后扣除。匹配不上时，这部分会并入 `System prompt · base`。
- **token 是粗略估算**：统一按字符数 ÷ 4 计算，只用来看各部分的相对占比。标题行同时显示 Pi 自身的计量值（Pi meter）供对照。
- **子项按比例分配**：Tool calls / Tool results 按工具名拆分时，用累计比例求边界，最后一项取剩余值，保证子项之和等于类别总数。
- **覆盖图对应真实行号**：read 的 `offset`/`limit` 被换算成行区间，技能文件按 frontmatter 分成"已公布"和"已加载正文"两段，所以能看出模型实际看过文件的哪些行。

## 注意事项

- 依赖 `@earendil-works/pi-coding-agent`（peer dependency）和 `@earendil-works/pi-tui`，用到的 API 包括 `buildSessionContext`、`convertToLlm`、`formatSkillsForPrompt`、`parseSkillBlock`、`ctx.getSystemPromptOptions()`、`ctx.getContextUsage()` 等。
- 文件覆盖图只识别名为 `read` 的工具，其他读取方式（如 bash 里的 `cat`）不会计入。read 结果的行数按返回文本的行数计算，如果工具在输出中附加了额外行，结果可能有偏差。
- 覆盖图显示的文件总行数取自执行命令时磁盘上的文件内容。文件在读取之后被修改过的话，显示会和当时读到的内容不一致。
- 超链接依赖终端对 OSC 8 的支持。
- 这是开发调试工具，写入的条目会留在会话记录里。

## 历史

- 最初是单文件扩展 `~/.pi/agent/extensions/dev-inspect.ts`，用于开发调试。
- 后来整理为独立的包（`package.json` 中 `pi.extensions: ["./index.ts"]`），收录到 pi-plugins 合集的 `active/dev-inspect`。
