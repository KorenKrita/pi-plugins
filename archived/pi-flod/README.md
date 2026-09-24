# pi-flod

> 折叠整轮对话、单行化工具调用、分步摘要思考过程

**状态**：已停用 · **来源**：KorenKrita 自用插件，源码取自 agent-configs `ab58cc0`。`index.ts` 是打包产物（文件头为 `// @ts-nocheck`，由 `pi-flod-entry.ts`、`pi-flod-turn-fold/*`、`pi-thinking-steps/*` 合并而成），`traceline/` 目录内嵌 pi-traceline（pine-of-glass 扩展家族）的源码，按源码注释说明与上游逐字节一致

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/pi-flod
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

pi-flod 用来压缩 Pi TUI 聊天记录的篇幅，由三部分组合而成：**Turn Fold**（整轮折叠）、**Thinking Steps**（思考分步视图）、**Traceline**（工具调用单行化）。另外还做了几处小的显示调整。

### 1. Turn Fold：整轮折叠

插件把一条用户消息及其后的全部 assistant 消息、工具调用归为一个“轮次”（turn group），有两种模式：

- **`compact`**（默认）
  - **进行中的轮次**：
    - 保留最近 3 条含思考内容的 assistant 消息（`LIVE_THINKING_GROUP_LIMIT = 3`），以及其中最早一条之后发生的全部工具调用。
    - 如果本轮还没有思考内容，就只保留最近 8 个工具调用（`LIVE_TOOL_ONLY_LIMIT = 8`）。
    - 既有正文又有思考、但未被选中的 assistant 消息只显示正文（`text-only`）。
    - 带终止提示的消息保持原样，包括 `stopReason` 为 `aborted`、`length`，以及不含工具调用的 `error`。
    - 其余内容隐藏，并在最新一条被隐藏的活动处显示一行摘要：`▶ N earlier activities · N tools · N msgs`。
  - **已结束的轮次**（`agent_settled` 后）：
    - 轮次的第一个组件显示汇总行：`▶ Worked for 2m 5s · N tools · N msgs · N failures · interrupted`。数量为 0 的部分省略；有失败或被中断时用 `warning` 色，否则用 `muted` 色，都加粗。
    - 只保留“最终锚点”：优先取以 error 结束的 assistant 消息里的最后一个工具调用，其次取最后一条有可见内容或终止提示的 assistant 消息，再次取最后一个工具调用。
    - 如果最终锚点渲染为空且本轮被中断，显示 `Operation interrupted`。
    - 其余内容全部隐藏。
- **`expanded`**：所有行按原样渲染。

**附属行**会挂到所属轮次，并跟随其 assistant 消息一起显示或隐藏。附属行包括 `customType` 为 `token-stats` 的自定义条目，以及 Pi 的 “Cache miss … tokens re-billed” 提示（Spacer + Text 成对出现）。在 `expanded` 模式下，附属行始终显示。

**会话压缩或树导航**（`session_compact` / `session_tree`）后，插件会在下一个新组件渲染时，用 `sessionManager.buildContextEntries()` 重建历史分组，并把正在进行的轮次合并回来。

### 2. 工具行显示模式（Ctrl+O 三态循环）

插件接管 `ctrl+o` 按键（按下后事件被消费，不再交给 Pi 的原生处理），在三种工具行显示模式间循环：

| 模式 | 行为 |
|---|---|
| `oneLine`（默认） | 强制 Traceline 单行渲染。渲染期间临时把所有 assistant 行的 `hideThinkingBlock` 设为 `true`、把本行的 `expanded` 设为 `false`，渲染完恢复原值 |
| `preview` | 以 Pi 原生的展开方式渲染；超过 8 行（`TOOL_PREVIEW_MAX_LINES = 8`）时，只保留前 7 行，末尾加一行 dim 提示：`… N more lines · press again for full output` |
| `nativeExpanded` | Pi 原生的完整展开渲染，同时调用 `ctx.ui.setToolsExpanded(true)` |

切换时会同步调用 `setToolsExpanded(mode === "nativeExpanded")`。每次 `session_start` 都会重置为 `oneLine`，并调用 `setToolsExpanded(false)`。

### 3. Traceline：单行工具调用

内嵌的 pi-traceline 把每个工具调用压成一行，格式为 `▏ › verb 参数 … 1.2k ch`。它的主要行为（详见 `traceline/index.ts` 文件头注释）：

- 行首是 dim 的 `▏` 竖线加状态色的 `›`，行首缩进 2 列、右侧留 2 列边距。连续的工具行合成一个视觉块，块前留一个空行，块内不留空行。
- 家目录路径会缩写成 `~`；过长的调用从中间截断（dim 的 `…`），保留文件名和命令尾部。读、编辑、写文件时目录部分变暗，突出文件名。
- 右侧对齐显示结果字符数，例如 `1.2k ch`：
  - 低于 100 ch 时不显示，但同一块中有其他行显示字符数时仍会显示，以保持列对齐。
  - 默认达到 10 000 ch 显示 warning 色，达到 50 000 ch 显示 error 色。
- `edit` / `write` 行在文件名上直接标注 `+N -M`，不显示字符数。`write` 的写入前内容在 `setArgsComplete` 和 `markExecutionStarted` 两处抓取快照，用来计算差异。
- 多行 bash 命令压成一行，原换行处用 dim 的 `↵` 标记，同时去掉 `(timeout Ns)` 后缀。如果 `cd <dir> && ` 前缀与上一条 bash 相同，就折叠成 `⋯`。
- 能从输出中确认已改动共享状态的 bash 行（例如 `git push`），改为以结果开头的写法：`pushed main $ git push`。
- 连续分页读取同一文件时，合并成一行，例如 `read path:1-200,201-400 · 2 calls`；连续读取同一目录下的多个文件时，合并成目录行。
- 相邻且已折叠的思考块合并为一行 `Thinking: …` 预览。
- 隐藏 Pi 在 Ctrl+T 后追加的 `Thinking blocks: hidden/visible` 状态行及其前面的 Spacer。
- 渲染出错时回退到 Pi 原生渲染。

pi-flod 对 Traceline 的额外处理：

- **字符数本地化**：同时包含 `▏` 和 `›` 的行，如果末尾是 `x.xk ch` 且实际字符数小于 1000，就改为精确值，例如 `0.4k ch` 显示为 `412 ch`。
  - 如果这一行是连续读取折叠的第一行，字符数取折叠内所有行的总和。
- **禁用 Traceline 自带的控制**：Traceline 的 `registerShortcut` / `registerCommand` 被替换为空操作，`session_start` 中的 `ctx.ui.onTerminalInput` 也被替换为空实现。因此 Traceline 在 Ctrl+T 时先收起 Ctrl+O 展开状态的逻辑不会生效，Ctrl+T 完全交给 Pi 原生处理。

### 4. Thinking Steps：思考分步视图

插件替换 `AssistantMessageComponent.prototype.updateContent`，把 assistant 消息中非空（或被 redacted）的 thinking 块交给 `ThinkingStepsComponent` 渲染。一条消息里的多个 thinking 块合并到同一个组件中。

**拆分与摘要**：

- 思考文本按段落、标题和列表项拆成多个“步骤”。每个步骤用启发式规则生成一句摘要，最多 84 字符（`SUMMARY_MAX_CHARS`）。规则包括基于 TF-IDF 的中心度、位置和结构先验、动作/决策/失败等线索词，以及 MMR 去重（`MMR_LAMBDA = 0.7`）。
- 每个步骤会推断一个角色，并配上对应图标：

  | 角色 | 图标 |
  |---|---|
  | `inspect` | `◫` |
  | `plan` | `◇` |
  | `compare` | `↔` |
  | `verify` | `✓` |
  | `write` | `✎` |
  | `search` | `⌕` |
  | `error` | `!` |
  | 其他 | `·` |

- 被 redacted 且内容为空的块，显示 `Reasoning is hidden by the provider.`

**三种视图模式**：

| 模式 | 渲染 |
|---|---|
| `collapsed` | 单行：`│ Thinking <图标> <摘要>`。优先选当前正在进行的步骤；其次选最近一次失败之后的成功步骤，或最近的失败步骤；再按优先级选。思考进行中时，行尾显示跳动的脉冲点 |
| `summary`（默认） | 标题为 `Thinking Steps · Summary`，下面用树形列出最多 5 个关键步骤。当前步骤、最近的失败或成功、决策和改变计划的步骤会优先入选 |
| `expanded` | 标题为 `Thinking Steps · Expanded`，下面用树形列出每个步骤的完整正文，保留标题、列表和行内粗体/代码样式，并过滤控制字符和 ANSI 转义 |

**其他行为**：

- 状态栏 `thinking-steps` 槽位显示 `thinking: <mode>`。
- 按 Ctrl+Shift+T 切换模式并写入全局偏好文件，然后提示 `Thinking view: <mode> (saved globally)`。
- 流式输出期间，插件通过 `thinking_start` / `thinking_delta` 跟踪当前正在进行的思考块，收到 `thinking_end`、text 事件或 toolcall 事件时清除。
- 当 `hideThinkingBlock` 为真（Pi 的 Ctrl+T 已隐藏思考）时，回退到 Pi 原生渲染（隐藏标签为 `Thinking...`）。
- 如果补丁渲染出错，也会回退到原生渲染，并在控制台输出 `console.warn`。
- 消息以 `stopReason` 为 `length`、`aborted` 或 `error` 结束时，会追加与 Pi 原生一致的错误提示。

### 5. 其他显示调整

- **用户消息时间戳**：`UserMessageComponent` 的最后一行右对齐显示本轮开始时间（dim 色）。当天的消息显示 `HH:MM`，否则显示 `YYYY-MM-DD HH:MM`。
  - 没有附带用户消息的 `SkillInvocationMessageComponent` 也会显示时间戳。
  - 如果最后一行以 OSC 133 区段结束符开头，会保留该前缀。
- **去掉用户消息前的空行**：紧挨在用户消息或技能调用行前面的 `Spacer` 不再渲染。
- **去掉工具行横向内边距**：工具行的 `contentBox`、`contentText` 的 `paddingX` 被设为 0。

## 使用

### 快捷键

| 按键 | 作用 | 注册方式 |
|---|---|---|
| `ctrl+shift+o` | 在 `compact` 和 `expanded` 之间切换整轮折叠模式，并写入会话条目 | `pi.registerShortcut`（描述：Toggle compact and expanded transcript rendering） |
| `ctrl+o` | 在 `oneLine` → `preview` → `nativeExpanded` 之间循环工具行显示模式 | `ctx.ui.onTerminalInput` 拦截并消费（忽略按键释放和重复事件） |
| `ctrl+shift+t` | 在 `collapsed` → `summary` → `expanded` 之间循环思考视图模式，并保存为全局偏好 | `pi.registerShortcut`（描述：Cycle the global Thinking Steps view） |
| `ctrl+t` | 不注册，仍是 Pi 原生的思考显示/隐藏开关；Traceline 会隐藏它产生的状态行 | — |

无斜杠命令，无工具。

### 事件钩子

| 事件 | 用途 |
|---|---|
| `session_start` | 记录主题；重置工具行模式；从当前分支恢复折叠模式；加载历史分组；读取思考视图偏好；抓取 TUI 并包装 `requestRender`；更新状态栏 |
| `session_compact` / `session_tree` | 推迟到下一个新组件渲染时，再重建历史分组 |
| `agent_start` | 确保有一个活动的轮次 |
| `message_start` / `message_update` / `message_end` | 维护轮次分组和 assistant 快照；跟踪当前正在进行的思考块；消息 `aborted` 时把轮次标记为中断 |
| `tool_execution_start` / `tool_execution_end` | 登记工具调用及失败状态 |
| `agent_settled` | 结束当前轮次，切换为已结束的轮次显示 |
| `agent_end` | 清除当前正在进行的思考状态 |
| `session_shutdown` | 取消输入监听，恢复所有原型补丁和 `requestRender`，清空状态栏槽位 |

## 配置

| 位置 | 内容 |
|---|---|
| `~/.pi/agent/state/thinking-steps.json` | 思考视图全局偏好，格式为 `{"mode": "collapsed" \| "summary" \| "expanded"}`，默认 `summary`。由 Ctrl+Shift+T 写入；家目录优先取环境变量 `HOME`，没有再取 `os.homedir()`。读取时也接受别名：`collapse`/`c`、`summaries`/`s`、`expand`/`full`/`e`。文件内容无效或无法解析时会弹出警告，并回退到 `summary` |
| 会话条目 `customType: "onurpi-turn-fold-config"` | 整轮折叠模式 `{ mode: "compact" \| "expanded" }`。由 Ctrl+Shift+O 通过 `pi.appendEntry` 写入当前会话；`session_start` 时取当前分支中最后一条有效值，默认 `compact` |
| `~/.pi/agent/pi-traceline.json`、`<cwd>/.pi/pi-traceline.json` | Traceline 配置：先读用户级，再读项目级，后者覆盖前者。`cwd` 取插件加载时的 `process.cwd()`。字段见下表 |

`pi-traceline.json` 字段：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `sizeWarningChars` | `10000` | 结果字符数达到此值，字符数显示 warning 色 |
| `sizeErrorChars` | `50000` | 结果字符数达到此值，字符数显示 error 色；实际取值不小于 `sizeWarningChars` |

两个字段都必须是正数，会向下取整；非法值会被忽略。

## 实现要点

- **原型级补丁**：插件替换 Pi 和 pi-tui 类原型上的方法，包括 `Container.prototype.addChild` / `render`、`Spacer.prototype.render`、`UserMessageComponent` / `SkillInvocationMessageComponent` 的 `render`，以及 `AssistantMessageComponent` 的 `updateContent` / `setHideThinkingBlock` / `setHiddenThinkingLabel`。插件不修改 `node_modules`；`session_shutdown` 时逐一还原，还原前会检查当前方法是否仍是本插件装上的补丁。
- **组合顺序**：注册顺序是 Thinking Steps → Turn Fold → Traceline。Turn Fold 先包装 `requestRender`，并通过 `tui.__piFlodRenderBridge` 把自己暴露为 Traceline 的内层；它在微任务里才启用，保证 Traceline 的原型补丁先落地，Turn Fold 最终作为最外层的渲染策略。
- **Pi 0.84 的 TUI Proxy**：源码注释说明，Pi 0.84 传给 widget 工厂的是一个稳定的 Proxy。如果直接保存 `tui.requestRender`，得到的是转发闭包，替换后会形成递归。因此插件改为调用渲染器原型上的 `requestRender`。
- **插入时就包装**：通过 `Container.prototype.addChild` 在行插入时包装 assistant 行和工具行，避免恢复历史时闪现一帧未折叠的画面。
- **视图计算**：`TurnFoldState` 给每个组件分配递增序号和所属轮次，由 `viewFor()` 计算显示方式。显示方式分为 `original`、`hidden`、`text-only`、`streaming-summary`、`settled-summary`、`settled-final`、`settled-summary-final`。assistant 消息用 `timestamp:序号` 作为键，区分时间戳相同的多条消息。
- **Thinking Steps 全局状态**：状态挂在 `globalThis[Symbol.for("pi-extensions.thinking-steps.state")]` 上，按 `cwd` 分作用域。重复加载时会补全缺失字段，而不是覆盖已有状态。
- **Traceline 不改动**：Traceline 源码保持原样，pi-flod 只通过适配器（空的 `registerShortcut` / `registerCommand` 和包装过的 `ctx.ui`）去掉它的按键控制，并借用它的 `internals`（`isToolRow`、`isAssistantRow`、`readRun`、`stripAnsi` 等）。
- **失败降级**：
  - Turn Fold 补丁安装失败时，只输出一次 `pi-flod: could not compose Turn Fold outside Traceline; native rendering remains available.`
  - Thinking Steps 补丁与原生渲染都失败时，抛出 `pi-flod: Thinking Steps rendering and Pi fallback rendering both failed.`

## 注意事项

- **依赖**：peer 依赖为 `@earendil-works/pi-coding-agent`（任意版本），运行时还会导入 `@earendil-works/pi-tui`。
- **兼容性风险**：
  - 插件大量依赖 Pi 的内部结构，包括私有字段（`toolCallId`、`lastMessage`、`hideThinkingBlock`、`expanded`、`contentContainer`、`outputPad`、`markdownTheme`、`paddingX` 等）以及 Pi 0.84 的 TUI Proxy 行为，Pi 升级后很容易失效。
  - 插件已停用，未在当前 Pi 版本上验证。
- **快捷键冲突**：插件接管 `ctrl+o`，会覆盖 Pi 原生的工具展开快捷键和其他使用该键的扩展；`ctrl+shift+o`、`ctrl+shift+t` 也可能与其他扩展冲突。
- **与独立插件同时安装**：`index.ts` 已内嵌 Turn Fold、Thinking Steps 和 Traceline，不要再同时安装独立的 pi-traceline 或 thinking-steps 类插件。它们共用 `globalThis` 上的状态和原型补丁版本号，同时安装可能互相干扰。
- **Thinking Steps 与 Ctrl+T**：Pi 的 Ctrl+T 隐藏思考后，Thinking Steps 回退为 Pi 原生的 `Thinking...` 标签，这时由 Traceline 负责合并这些标签。
- **显示语言**：摘要启发式规则只针对英文思考文本（线索词和正则都是英文），界面文案也是英文。
- **源码形态**：`index.ts` 是 `// @ts-nocheck` 的打包产物，不适合直接维护。

## 历史

- 2026-07-22：已存在于 agent-configs，本目录源码取自提交 `ab58cc0`。
- 2026-08-06：移除，由 pi-frame 取代。
- 注意名称就是 **pi-flod**，不是 pi-fold。
