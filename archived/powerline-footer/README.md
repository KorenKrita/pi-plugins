# powerline-footer

> 固定底部输入框，配 powerline 状态栏、聊天滚动和中文 Working Vibes

**状态**：已停用 · **来源**：KorenKrita 的本地扩展；按旧 README 列出的保留/删除功能，看起来是从第三方 pi-powerline-footer 精简改造来的，源码没有写上游作者或版权头

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/powerline-footer
```

这条命令先把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再用本地路径安装本插件；以后更新执行 `git -C ~/.pi/agent/pi-plugins pull`。本插件已停用，没有在当前 Pi 版本上验证过，可能需要适配。

## 功能

它替换 Pi 的默认编辑器和 footer：输入框、状态栏固定在终端底部，上方聊天记录单独滚动。

### 固定底部区域

- 编辑器、状态栏、扩展通知和最近一条提示词组成一个“固定区”（cluster），画在终端最底部。上面的区域用 scroll region 显示聊天记录。
- 固定区从上到下依次是：
  1. 编辑器上方 widget 容器、以 `[` 开头的扩展状态（通知行）、Pi 原状态容器；
  2. powerline 主状态行；
  3. 编辑器；
  4. powerline 次状态行、编辑器下方 widget 容器；
  5. 最近一条用户提示词（`↳ ...`，折成单行，超宽时截断）。
- 固定区最多占 `终端行数 - 1` 行。编辑器优先占位，剩下的行依次分给主状态行、次状态行、最近提示词和状态/通知行。编辑器内容超高时，按光标所在行（或以 `→ ` 开头的选中行）截取可见窗口。
- 编辑器基于 `CustomEditor`，改画了上下边框，首行加 ` > ` 提示符。提交后聊天区自动跳到底部。
- 终端真实光标总会停在编辑器的逻辑光标处（即使硬件光标隐藏也一样），这样 macOS 输入法的候选窗能跟着光标走。

### 状态栏

内置布局写死在源码里（`presets.ts`）：

| 位置 | 段 |
|---|---|
| left | `model`、`thinking`、`path`、`git` |
| right | `context_pct`、`token_in`、`token_out`、`token_total`、`cache_read`、`cache_write`、`cost`、`time_spent` |
| secondary | `extension_statuses` |

- 分隔符固定为 `slash`（` / `），图标固定用 Nerd Font。
- 响应式排版：所有可见段按 left → right → secondary 的顺序依次填进主状态行，一放不下就开始溢出；溢出的段按原顺序放进次状态行，遇到第一个放不下的段就停，后面的段不显示。
- 各段的行为：
  - `model`：显示模型名或 id，自动去掉 `Claude ` 前缀；`showThinkingLevel` 打开且模型支持 reasoning 时，追加 thinking 级别。
  - `thinking`：`think:off/min/low/med/high/xhigh`，`high`/`xhigh` 用彩虹渐变。
  - `path`：支持 `basename`/`abbreviated`/`full` 三种模式；会把 home 目录替换成 `~`，并去掉 `/work/` 前缀；`abbreviated` 超过 `maxLength` 时从左边截断，加 `…`。
  - `git`：显示分支；工作区有改动时分支变成 dirty 色，并显示 `*未暂存`、`+已暂存`、`?未跟踪` 的数量。detached HEAD 显示 `<短SHA> (detached)`。
  - `context_pct`：`百分比%/窗口大小`，自动压缩开启时带 auto 图标；超过 70% 用警告色，超过 90% 用错误色。检测到自定义压缩策略（见“注意事项”）时隐藏这一段。
  - `token_in`/`token_out`/`token_total`/`cache_read`/`cache_write`/`cost`：累计当前分支上所有 assistant 消息的用量，跳过 `error`/`aborted` 的消息；OAuth 订阅模型的 `cost` 显示 `(sub)`。
  - `time_spent`：从 `session_start` 起算的会话时长。
  - `extension_statuses`：其他扩展通过 `setExtensionStatus` 写入的状态，不含以 `[` 开头的通知类状态，用 `·` 连接。
- 生成中 context 优先按实时 `message_update` 的 usage 计算；非生成状态优先读 `ctx.getContextUsage()`，读不到再用最后一条 assistant 消息的 usage 和 `ctx.model.contextWindow` 估算。

### 聊天滚动、跳转与鼠标选择

- 鼠标滚轮每次滚 3 行；`super+up`/`super+down`（可配置）、`PageUp`/`PageDown`、`ctrl+shift+up`/`ctrl+shift+down` 每次滚 10 行。
- 快捷键可以在用户消息之间、LLM 消息之间跳转，也可以直接跳到底部（见“使用”）。用户消息包括 `UserMessageComponent` 和 `SkillInvocationMessageComponent`。
- 在聊天区或固定区按住左键拖动选择文本，松开后自动复制到剪贴板；双击某一行选中整行；拖到可视区上下边缘会自动滚动。
- 在选区内点右键会复制选区，并暂停鼠标上报 1200 ms，好让终端弹出原生右键菜单。之后 5 秒内每 100 ms 把剪贴板恢复成选区内容一次。
- 有 overlay 时，滚动、选择和固定区绘制都暂停，终端输出原样透传。

### Working Vibes

- 配置了主题（`workingVibe`）后，每次 `before_agent_start` 会先把 working message 设成 fallback 文案，再调用配置的模型，结合用户提示词前 150 字生成一条中文加载短句。默认模型是 DeepSeek V4 Flash（`local-openai/deepseek-v4-flash`）。
- 生成中遇到 `tool_call`，距上次生成超过 `workingVibeRefreshInterval` 就重新生成一条。提示内容优先取最近一条 assistant 文本的前 150 字；没有这段文本时，按 `read`/`write`/`edit`/`bash` 的参数拼一句描述。
- 最近 5 条文案会放进 prompt，避免重复；输出只取第一行，统一以 `…` 结尾，长度不超过 `workingVibeMaxLength`。
- 单次生成超时 3000 ms；找不到模型、认证失败或输出为空时，使用 fallback 文案。新请求开始时会取消上一个请求；`agent_end` 时取消生成并清空 working message。

## 使用

### 斜杠命令

| 命令 | 作用 |
|---|---|
| `/powerline` | 开关本插件：关闭时恢复默认编辑器和 footer，拆除固定区；带参数时只提示 `Usage: /powerline` |
| `/vibe` | 显示当前 vibe 主题和模型 |
| `/vibe <theme>` | 设置主题，并写入 `~/.pi/agent/settings.json` 的 `workingVibe` |
| `/vibe off` | 关闭 Working Vibes（从 settings 里删除 `workingVibe`） |
| `/vibe model` | 显示当前 vibe 模型 |
| `/vibe model <provider/modelId>` | 设置模型，必须含 `/`，并写入 `workingVibeModel` |

`settings.json` 格式有误或不是对象时，`/vibe` 拒绝覆盖文件，并提示 `not persisted; check settings.json`。

### 快捷键

| 配置键 | 默认值 | 作用 |
|---|---|---|
| `jumpPreviousUserMessage` | `ctrl+shift+u` | 跳到上一条用户消息 |
| `jumpNextUserMessage` | `ctrl+shift+i` | 跳到下一条用户消息 |
| `jumpPreviousLlmMessage` | `ctrl+alt+,` | 跳到上一条 LLM 消息 |
| `jumpNextLlmMessage` | `ctrl+alt+.` | 跳到下一条 LLM 消息 |
| `jumpChatBottom` | `ctrl+shift+g` | 聊天区跳到底部 |
| `scrollChatUp` | `super+up` | 聊天区上滚 10 行 |
| `scrollChatDown` | `super+down` | 聊天区下滚 10 行 |

前 5 个跳转快捷键用 `pi.registerShortcut` 注册，同时在 `onTerminalInput` 和编辑器 `handleInput` 里拦截。两个滚动快捷键由固定区合成器（compositor）处理。

### 事件钩子

| 事件 | 用途 |
|---|---|
| `session_start` | 重读设置和快捷键，检测自定义压缩，初始化 Working Vibes，安装编辑器、footer 和固定区 |
| `session_shutdown` | 卸下编辑器、footer 和 widget，拆除固定区；退出（`quit`）或重载（`reload`）时重置扩展键盘模式 |
| `tool_result` | `write`/`edit` 后让 git 状态缓存失效；`bash` 命令可能切分支时同时失效分支缓存，100 ms 后重绘 |
| `user_bash` | `!` 命令可能切分支时让缓存失效，并在 100/300/500 ms 各重绘一次 |
| `model_select` / `thinking_level_select` / `session_tree` | 刷新状态栏 |
| `before_agent_start` | 记录最近提示词，触发 vibe 生成 |
| `agent_start` / `agent_end` | 标记生成状态；vibe 开始或结束 |
| `message_update` / `message_end` / `turn_end` | 更新实时 usage，重绘状态栏 |
| `tool_call` | 按刷新间隔重新生成 vibe |

“可能切分支”指匹配以下模式：`git checkout|switch|branch -d/-D/-m/-M|merge|rebase|pull|reset|worktree`、`git stash pop|apply`。

## 配置

### settings.json（状态栏与快捷键）

先读 `~/.pi/agent/settings.json`，再深度合并项目里的 `<cwd>/.pi/settings.json`，项目设置优先。启动时和每次 `session_start` 都会重读。home 目录按 `HOME` → `USERPROFILE` → `os.homedir()` 的顺序解析。

| 键 | 说明 | 默认值 |
|---|---|---|
| `showLastPrompt` | 在固定区底部显示最近一条提示词；只有设成 `false` 才关闭 | `true` |
| `powerline.model.showThinkingLevel` | 在 `model` 段追加 thinking 级别 | `false` |
| `powerline.path.mode` | `basename` / `abbreviated` / `full` | `abbreviated` |
| `powerline.path.maxLength` | `abbreviated` 模式下的最大长度（取正整数） | `60` |
| `powerline.git.showBranch` / `showStaged` / `showUnstaged` / `showUntracked` | 各项 git 信息的开关 | 全部 `true` |
| `powerline.git.polling` | `full`：分支和文件状态；`branch`：只取分支；`off`：只用 Pi 自带的分支 | `full` |
| `powerline.customItems` | 自定义状态段（见下） | `[]` |
| `powerlineShortcuts.<key>` | 覆盖快捷键，key 见“快捷键”表 | 见上表 |

`powerline.customItems` 可以写成数组（每项带 `id`），也可以写成以 id 为键的对象。同 id 的项后面的覆盖前面的。

| 字段 | 说明 | 默认值 |
|---|---|---|
| `id` | 只能含 `[a-zA-Z0-9_-]` | 必填 |
| `statusKey` | 读取哪个扩展状态键 | 等于 `id` |
| `position` | `left` / `right` / `secondary` | `right` |
| `color` | Pi 主题色名，或 `#rrggbb` | 无 |
| `prefix` | 前缀，与值之间用 `·` 连接 | 无 |
| `hideWhenMissing` | 状态为空时隐藏；设成 `false` 时显示 prefix 或 id | `true` |
| `excludeFromExtensionStatuses` | 不在 `extension_statuses` 段和通知行里重复显示 | `true` |

快捷键规则：
- 修饰键只能是 `ctrl`/`alt`/`super`/`shift`，`cmd`/`command` 视为 `super`。
- 主键可以是单个字母或数字、`f1`–`f12`、命名键（如 `up`、`pageup`、`enter`），或者符号键。
- 带 `super` 的组合只支持 `super+up/down/home/end/pageup/pagedown` 和 `super+shift+up/down/home/end`。
- 非法值会被忽略。
- 与 Pi 保留键或 `TUI_KEYBINDINGS` 默认键冲突时，会自动换成一个还没占用的默认快捷键；换不到就保留原值，并输出 debug 日志。

### settings.json（Working Vibes）

只读全局的 `~/.pi/agent/settings.json`，不合并项目设置。

| 键 | 说明 | 默认值 |
|---|---|---|
| `workingVibe` | 主题字符串；不设或设成 `off` 时关闭 | 不设（关闭） |
| `workingVibeModel` | `provider/modelId` | `local-openai/deepseek-v4-flash` |
| `workingVibeFallback` | 生成失败或还没生成出来时显示的文案 | `还在算…` |
| `workingVibeRefreshInterval` | 工具调用期间重新生成的最小间隔（秒），最小 0 | `30` |
| `workingVibeMaxLength` | 文案最大长度，最小 4 | `40` |
| `workingVibePrompt` | 提示词模板，支持 `{theme}`、`{task}`、`{exclude}`、`{maxLength}` | 内置中文模板（程序员黑色幽默） |

### theme.json

插件目录下的 `theme.json`：
- `colors`：覆盖语义色，可用的键有 `model`、`path`、`gitDirty`、`gitClean`、`gitUnstaged`、`gitStaged`、`gitUntracked`、`thinking`、`thinkingMinimal`、`thinkingLow`、`thinkingMedium`、`context`、`contextWarn`、`contextError`、`cost`、`time`、`tokens`、`separator`、`border`。值可以是 `#rrggbb` 或 Pi 主题色名；主题色名无效时回退成 `text`。
- `icons`（可选）：覆盖图标，可用的键有 `model`、`folder`、`branch`、`git`、`tokens`、`context`、`time`、`cache`、`input`、`output`、`auto`。

颜色优先级：`theme.json` > 源码预设（`presets.ts` 引用的默认色）。`theme.json` 读取后缓存 5 秒。

状态栏布局、固定输入框、鼠标滚动、Nerd Font 和 `slash` 分隔符都写死在源码里，不能配置。改设置后执行 `/reload` 生效。

## 实现要点

- **接管终端渲染**：`TerminalSplitCompositor` 会：
  - 进入备用屏幕（`?1049h`）；
  - 把 `terminal.rows` 改成“总行数 − 固定区行数”，让 Pi 以为终端只有这么高；
  - 包装 `terminal.write`、`tui.render`、`tui.doRender` 和 `tui.compositeLineAt`：每次写入都先设置 scroll region，再用同步输出（`?2026`）重画固定区。
- **隐藏原组件，再在固定区里渲染**：编辑器容器、编辑器上下方的 widget 容器和 Pi 原状态容器，它们的 `render` 被替换成返回空数组，再在固定区里调用原来的 `render`。插件自己的 `setFooter` 组件也返回空行，只用来拿 `footerData` 和 `tui`。
- **自己维护聊天区滚动**：插件自己维护 `scrollOffset`；新内容到来且处于非底部位置时，偏移量随之增加，保持视图不动。滚动时用 `deleteAllKittyImages()` 清掉 Kitty 图片残影。
- **鼠标**：通过 SGR 鼠标上报（`?1002h?1006h`）解析滚轮、选择和右键，同时关掉 alternate scroll mode（`?1007l`）。
- **终端状态恢复**：`dispose` 和进程 `exit` 时恢复 scroll region、鼠标模式、备用屏幕和扩展键盘模式（kitty / modifyOtherKeys）。如果退出时 compositor 还没建好，就写一段应急重置序列。
- **渲染节流**：状态重绘去抖 33 ms；布局缓存 250 ms，生成中延长到 1000 ms；用户输入后 150 ms 内推迟状态栏重算，避免打字卡顿。`setExtensionStatus`/`clearExtensionStatuses` 被包装成调用后立即重绘，卸载时还原。
- **Git 查询**：异步 `spawn git`，不阻塞渲染。分支缓存 500 ms，文件状态缓存 1 s，命令超时分别为 200/500 ms。渲染时先返回旧值，同时在后台刷新；用失效计数器丢弃过期结果。
- **thinking 级别**：通过 `Reflect.get(ctx, "getThinkingLevel")` 读取，因为 ExtensionContext 0.80.6 的类型还没有声明这个方法。读不到时依次回退到事件里的级别、会话中的 `thinking_level_change` 记录，最后是 `off`。

## 注意事项

- **依赖**：运行时依赖 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`（含 `pi-ai/compat` 的 `complete`）和 `@earendil-works/pi-tui`，由 Pi 宿主提供，`package.json` 没有声明。终端需要 Nerd Font 才能正常显示图标。
- **依赖 Pi 内部实现**：插件直接改 `tui.children` 结构（按编辑器容器前后的相邻位置找状态容器和 widget 容器），以及 `terminal.rows`、`hardwareCursorRow`、`previousViewportTop`、`overlayStack`、`_modifyOtherKeysActive` 等内部属性。Pi 内部结构一变就可能失效，安装时找不到编辑器容器会直接抛错。
- **备用屏幕**：运行期间在备用屏幕里工作，终端自带的滚动历史用不上，聊天记录只能用插件的滚动功能查看。
- **Working Vibes 会额外调用模型**：每次提问都会调一次配置的模型，工具调用期间最多每个刷新间隔再调一次。默认模型 `local-openai/deepseek-v4-flash` 必须在 Pi 的 model registry 里存在且认证可用，否则一直显示 fallback 文案。
- **快捷键启动后不再重新注册**：`pi.registerShortcut` 在扩展加载时按启动时的设置注册。之后 `session_start` 重新解析只影响插件自己的输入拦截和滚动键，不会重新注册。
- **Git 目录**：git 命令在进程当前目录执行（没有传 `cwd`），不一定是 `ctx.cwd`。
- **与 pi-custom-compaction 的关系**：满足以下任一条件就隐藏 `context_pct` 段：
  - 存在 `~/.pi/agent/extensions/pi-custom-compaction`，并且 `<cwd>/.pi/compaction-policy.json`（优先）或 `~/.pi/agent/compaction-policy.json` 里 `enabled` 为 `true`；
  - 扩展状态里有 `compact-policy` 键。
- **与其他扩展的关系**：其他扩展设置的状态会显示在状态栏里（`[` 开头的作为通知行，其余进 `extension_statuses` 段）；它们的上方/下方 widget 也会被收进固定区。

### 相对上游删除的功能

以下功能在本版本中已删除：
- Bash mode 与 ghost suggestions
- Editor stash 与 stash history
- Welcome overlay/header
- Editor copy/cut 快捷键
- 其他 presets、separators 与 ASCII fallback
- 未实现的 subagents segment
- Working Vibes 的 file/batch 模式

## 历史

- 最初是 KorenKrita 的 Pi 本地扩展，入口为 `index.ts`，放在 `~/.pi/agent/extensions/powerline-footer/` 由 Pi 自动加载；`pi update --all` 不管理这个目录。
- 2026-07-12 前后在用。
- 2026-07-13 移除，归档到本仓库 `archived/powerline-footer`，源码取自 agent-configs `167e90e`。
