# pi-frame

> 给 Pi 对话记录加边框、工具输出三档切换与回合折叠

**状态**：在用 · **仓库**：https://github.com/KorenKrita/pi-frame（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/pi-frame
```

## 功能

- **消息边框**：thinking 块套圆角虚线框（标题 `thinking`），隐藏 thinking 时只显示一条带标签的虚线；助手正文左侧加 `┃` 强调色竖条。
- **工具显示三档**（`Ctrl+O` 轮换）：
  | 模式 | 显示 |
  | --- | --- |
  | `1-line` | 每个工具一行：工具名、参数摘要、估算输出 token 数；过长摘要会省略中间 |
  | `preview` | 完整 **Input**（格式化 JSON）+ **Output** 前 10 个逻辑行 |
  | `native` | 完整 Input 与 Output |

  两种详细模式都不截断 Input；Output 只拼接工具返回的文本块，无法找回工具自身已截断的内容。有自定义渲染器的工具，会在原始 I/O 下方保留 Pi 原生的 **Tool view**（代码高亮、edit diff、图片等）。仅改渲染，不改工具 schema、执行、参数或结果，也不往模型上下文追加内容。
- **回合折叠**（`Ctrl+Shift+O`）：已结束的回合中的工具活动和中间文字折叠成一行摘要；正在生成的最后一个回合不折叠。
- **复制模式**（`/cp`）：去掉所有边框侧栏（只留上下横线），方便终端鼠标选中复制纯文本。
- **用户输入框**：用户消息渲染为带边框的盒子，左上图标、右上发送时间、右下 provider/model。时间、模型、thinking 等级取自会话分支条目（`message`、`model_change`、`thinking_level_change`），恢复会话后标签不变。纯显示层，消息仍走 Pi 原生用户消息路径，不影响 `before_agent_start` 和读用户消息的其它扩展。旧会话里 pi-topping 记录的 `pi-topping-prompt` 消息仍能渲染。
- **工作加载行**：Pi 工作时显示转圈动画、随机动作词、shimmer、token 活动条、token 速率、已用时间、输出 token 数，以及与所选模型不同时的实际响应模型；每项可开关、改色、重排。动作词来自内置中文词表（`loader/words.ts`）与可选中文词包（AI 娘、二次元、程序员黑话、甄嬛传，默认全关），也可自定义。
- **状态栏**：把编辑器包进一个方框，边框上分组显示 Pi 图标、模型、provider、thinking 等级、路径、git、PR、会话名、token 速率、feeds、Pi 统计、context 条与统计、滚动提示等。feeds 显示其它扩展以 custom entry 发布的数字（默认预置 pi-prompt-cache 的节省金额）。
- Pi 底部状态区（key `pi-frame`）显示当前状态，如 `frame 1-line · folded · copy`。

## 使用

| 类型 | 名称 | 作用 |
| --- | --- | --- |
| 快捷键 | `Ctrl+O` | 轮换全局工具模式 `1-line` → `preview` → `native`；全屏模式下保持当前阅读位置 |
| 快捷键 | `Ctrl+Shift+O` | 折叠/展开已结束的回合 |
| 快捷键 | `Ctrl+T` | Pi 原生 thinking 显示切换（未改动，仅换外框样式） |
| 斜杠命令 | `/frame-settings` | 先选页面（输入框 / 加载动画 / 状态栏 / 工具显示），进入带实时预览的中文设置菜单，⏎ 应用 |
| 斜杠命令 | `/cp` | 切换复制模式 |
| 鼠标 | 点击工具名 | `1-line` 下单独展开/收起该工具的 Input + Output 预览（仅无修饰键左键；拖动选择不会触发） |
| 鼠标 | 点击 Output 块 | 切换该块的预览/完整显示 |

单行的局部展开只在当前视图有效：再次选择相同全局模式不会重置；切到另一个全局模式会清空局部展开与 Output 覆盖。

## 配置

优先通过 `/frame-settings` 修改。持久化位置（基于 Pi 的 agent 目录 `getAgentDir()`，通常为 `~/.pi/agent`）：

| 文件 / 位置 | 内容 |
| --- | --- |
| `~/.pi/agent/pi-frame/prompt-loader.json` | 输入框与加载行设置（`decorations`、`features`、`loaderOrder`、`wordPacks`） |
| `~/.pi/agent/pi-frame/statusline.json` | 状态栏设置 |
| `~/.pi/agent/pi-frame/word-packs.json` | 自定义动作词包（可选） |
| 会话 custom entry `pi-frame-config` | 工具模式 `toolMode` 与折叠状态 `foldMode`，按会话保存 |

部分默认值：

- 工具模式 `toolMode`：`oneLine`（即 `1-line`）；折叠 `foldMode`：`expanded`；复制模式启动时总是关闭，不持久化。
- 输入框：`decorateUserPrompt: true`，`borderStyle: "double"`（可选 `double`/`single`/`rounded`/`heavy`），`borderColor: "thinking-level"`，`promptIcon`/`promptTimestamp`/`promptProvider`/`promptModel` 均为 `true`，`useNerdFont: true`。
- 加载行：`animatedSpinner`、`shimmer`、`tokenActivityMonitor` 为 `true`；`shimmerDirection: "ltr"`，`shimmerSpeed: "normal"`，`meterDirection: "rtl"`；`spinnerColor: "thinking-level"`，`meterColor: "accent"`，`tokenRateColor: "warning"`，`responseModelColor: "accent"`；`wordPacks: {}`（词包默认全关）。
- 状态栏：`transparent: true`，`separator: "powerline-thin"`（可选 `powerline`/`powerline-thin`/`slash`/`pipe`/`ascii`），`symbols: "nerd"`（`nerd`/`unicode`/`ascii`），`borderStyle: "rounded"`，`rainbowBorder: true`，`rainbowAnimation: true`，`nvidiaGreenBorder: true`，`nvidiaGreenAnimation: true`，`embedWorkingStatus: false`；默认 `feeds` 为 `{ customType: "pi-prompt-cache/savings", field: "savedUsd", prefix: "CS", format: "currency" }`，但 `feeds` 段默认关闭。
- 自定义词包 `word-packs.json`：`{ "packs": [{ "id", "name", "description?", "attribution?", "words": [{ "present_tense", "past_tense" }] }] }`；`id` 需匹配 `^[a-z][a-z0-9-]{0,63}$`，且不能与内置 `acg`、`ai-girl`、`dev-slang`、`zhen-huan` 重名；文件解析失败时静默忽略。

首次运行时若 pi-frame 自己的文件不存在，会读取 `~/.pi/agent/pi-topping/settings.json` 和 `~/.pi/agent/pi-topping-statusline/settings.json` 作为初始值。

## 实现要点

- 通过替换 `ToolExecutionComponent`、`AssistantMessageComponent`、`UserMessageComponent`、`CustomMessageComponent`、`BashExecutionComponent` 的 prototype 方法（`render`、`handleMouse`、`updateContent`）实现边框和工具渲染；原始方法与状态保存在 `globalThis[Symbol.for("pi-frame")]`，`/reload` 时替换状态而不重复包裹。
- `Ctrl+O` 通过 `ctx.ui.onTerminalInput` 抢先拦截并消费按键；`native` 映射到 Pi 的 `setToolsExpanded(true)`，`1-line`/`preview` 都映射为 `false`，三档状态由插件自行维护。
- 回合折叠 hook 聊天容器的 `render`，每次渲染前重算折叠计划（`computeFoldPlan`）；连续工具行去掉行间空行。
- 工具 Output 按内容字段值（而非对象引用）缓存，兼顾流式原地修改的结果和大量历史输出的重绘性能；输出会剥离终端控制序列。
- 用户输入框元数据按会话分支（`getBranch` / `buildContextEntries`）匹配，宽度不足 16 列回退到 Pi 原生渲染。
- 加载行与输入框改编自 [pi-topping](https://github.com/underactive/pi-topping)，状态栏移植自 [pi-topping-statusline](https://github.com/underactive/pi-topping-statusline)（均为 MIT，见 `loader/LICENSE`、`statusline/LICENSE`）；与 pi-topping 不同，不拦截改写 `input`，也不显示完成标记。
- 仅在 TUI 模式（`ctx.hasUI && ctx.mode === "tui"`）下生效。

## 注意事项

- 依赖 Pi 内部组件结构，原 README 注明当前在 Pi 0.85.1 上验证；升级 Pi 后需重新检查。
- 修改扩展后可用 `/reload`，但其它已安装扩展可能在 reload 时中止后台任务；重启 Pi 同样会加载新版本。
- Output 区只含文本块，工具自身已截断的内容无法恢复；图片仍走 Pi 原生渲染路径。
- 状态栏图标默认使用 Nerd Font 符号，终端字体不支持时可在设置里改为 `unicode` 或 `ascii`。
- 未打包 pi-topping 的英文词包。

## 历史

- 2026-09-03：新建，取代 pi-flod。
- 2026-09-09：试验过两个边框变体：v2-rules（只画上下横线）和 v3-rail（左侧反色色条）。
- 当前以本地路径 `~/Coding/pi-frame` 安装（其 origin 即上述 GitHub 仓库）。
