# universal-tidy

> 把所有工具调用统一渲染成紧凑的两行摘要

**状态**：已停用 · **来源**：KorenKrita 自写的本地扩展，借鉴 [`pi-tidy-tools`](https://github.com/mikeyobrien/pi-tidy-tools) 的视觉风格，用运行时 patch 实现；源码取自 agent-configs `4da53c8`

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/universal-tidy
```

这条命令会把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再按本地路径安装这个插件。更新时运行 `git -C ~/.pi/agent/pi-plugins pull`。这个插件已停用，没有在当前 Pi 版本上验证过，可能需要适配。

## 功能

Pi 里不同工具（内置、扩展、MCP/外部、动态注册）的调用行和结果行风格各不相同。有的输出很长，还会带 Hashline 锚点。universal-tidy 把**所有**工具统一显示成两行：

```text
  ┊ ✓ 📖 read ~/project/README.md (<1s)
  ┊   limit 12 → 7 lines
```

它**不**重新注册、也不替换任何工具。工具的 schema、参数、执行模式和 `execute()` 实现都保持原样，只改 Pi 内部 `ToolExecutionComponent` 的显示方式。

`pi-tidy-tools` 的视觉风格里借鉴了这些：低调的 gutter、表示状态的符号、按工具类别区分的图标、简短的结果摘要、能识别 ANSI 的截断，以及展开后保留原始输出。

**第一行（调用行）**

- 格式：`┊ <状态> <图标> <工具名> <标题> (<耗时>)`。
- 状态符号：执行中显示暗色 `·`，出错显示红色 `✗`，成功显示绿色 `✓`。
- 图标和颜色按工具名匹配（按 `_` 分词）：
  - 名字包含 `read/grep/find/search/fetch/get/list/scan/lookup`：显示 `📖`，青色。
  - 名字包含 `write/edit/replace/patch/update/create/delete/remove`：显示 `✏️`，黄色。
  - 名字包含 `bash/shell/exec/run/command`：显示 `⚡`，品红。
  - 其他工具：显示 `◆`，品红。
- 标题：工具参数里本来就有 `reasoning` 字符串时，优先用它（插件**从不**往 schema 注入新字段）；否则用目标摘要：
  - 工具名匹配 `grep|find|search` 且参数里有 `pattern` 时，显示为 `“pattern” in path`。
  - 否则按 `path`、`file`、`command`、`query`、`url`、`pattern`、`action`、`name` 的顺序，取第一个有值的键。
  - 都没有时，取第一个可显示的字段，显示为 `key=value`。这一步会跳过匹配 `secret|token|password|passwd|api.?key|authorization|cookie` 的键，以及 `reasoning` 和 `description`。
  - 数组最多显示前 3 项，其余显示为 `+N`。
  - `path`/`file` 里的 home 目录会缩写成 `~`。
- 耗时：`tool_execution_start` 时开始计时，`tool_result` 时停止。执行中每 1 秒刷新一次。显示格式为 `<1s`、`2.4s`、`42s`、`1m 05s`、`2m`。
- 行太长时，只截断标题（末尾加 `…`），右侧的耗时始终可见。

**第二行（结果行）**

- 格式：`┊   <次要信息> → <结果摘要>`。成功时摘要为绿色，出错时为红色。
- 次要信息：有 `reasoning` 时显示目标摘要；否则由 `offset`、`limit`、`numResults` 组成，如 `from line 13 · limit 12`。
- 结果摘要按以下优先级确定（摘要生成前会先剥掉每行开头的 Hashline 锚点，如 `RT5│`）：
  1. 出错：取第一行非空文本，没有文本时显示 `error`。
  2. `details` 里的结构化计数，依次检查 `totalResults`、`resultCount`、`matches`、`matchCount`、`files`、`fileCount`、`items`、`itemCount`、`count`（数字或数组长度都算），显示为 `N results/matches/files/items`。
  3. 工具名匹配 `edit|replace|patch` 且 `details.diff` 存在：显示 `+新增/-删除`。
  4. 工具名是 `read`：显示 `N lines`。
  5. 工具名匹配 `bash|shell|exec|command`：`details.exitCode` 非 0 时显示 `exit N`，否则显示 `done`。
  6. 工具名匹配 `write|create` 且参数里有 `content`：显示写入的行数。
  7. 只有图片、没有文本：显示 `N images`。
  8. 多行文本：显示 `N lines`；单行文本超过 72 字符：显示 `done`；其他情况原样显示。
- 执行中（partial）不显示结果行。

**展开（expanded）**

先保留上面两行摘要，再调用该工具**原本的**结果渲染器，把它的输出缩进到 gutter 下方显示，因此 diff、Markdown 和第三方专用展示都不会丢。原渲染器抛出异常或不存在时，改为显示原始全文。

**背景色**

继续使用 Pi 的 `toolPendingBg`、`toolSuccessBg`、`toolErrorBg` 三种状态背景。图片路径和渲染器的清理生命周期也保持不变。

## 使用

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 斜杠命令 | `/tidy-ui status` | 查看状态。patch 生效时提示 `Universal Tidy is active (private TUI patch, Pi 0.80.6 tested).`，失效时给出原因。不带参数时等同于 `status`，其他参数会显示用法提示 |
| 事件钩子 | `tool_execution_start` | 记录开始时间，清除旧计时器 |
| 事件钩子 | `tool_result` | 记录耗时和是否出错，停止刷新计时器 |
| 事件钩子 | `session_start` | patch 安装失败时发出 `Universal Tidy disabled: …` 警告 |
| 事件钩子 | `session_shutdown` | 释放 patch，恢复原始方法 |

## 配置

没有配置项。

仓库里的视觉回归脚本 `visual/preview.ts` 会读取以下环境变量：

- `PI_GLOBAL_NODE_MODULES`：Pi 全局 `node_modules` 的路径，默认 `/home/krita/.bun/install/global/node_modules`。
- `FORCE_COLOR`：脚本内部会强制设为 `3`。

## 实现要点

- **运行时 patch，而不是重新注册工具**：只替换 `ToolExecutionComponent.prototype` 上的 `hasRendererDefinition`（恒为 `true`）、`getRenderShell`（恒为 `"self"`）、`getCallRenderer` 和 `getResultRenderer`。这样不会影响其他扩展的 schema、执行逻辑和加载关系。
- **定位内部模块**：先用 `import.meta.resolve("@earendil-works/pi-coding-agent")` 从公开入口推出 `modes/interactive/components/tool-execution.js`，找不到时再从 `process.argv[1]`（CLI 路径）推导。不硬编码用户的安装目录。
- **安全降级**：找不到模块、找不到导出，或者上面 4 个方法中有一个不是函数时，插件不做任何修改（no-op），并在 `session_start` 时发出警告。
- **引用计数和所有权检查**：patch 状态挂在 `Symbol.for("korenkrita.pi.universal-tidy.patch.v1")` 上，重复加载时只增加引用计数。释放时，只有这 4 个方法仍然是本插件装上的版本，才会恢复原方法并清理计时器和状态，不会覆盖别人后来打的 patch。
- **不注入 `reasoning`**：注入会改变公共工具契约、降低兼容性。工具本来就有 `reasoning` 时才用它做标题。
- **配色取舍**：`glass` 主题的 `muted` 是 `#00ff00`，所以目标文本用 `toolOutput` 颜色。状态色和工具类别色沿用上游那类 ANSI 语义，免得整行都是荧光绿、看不出层次。
- **宽度安全**：所有行都按终端宽度做 ANSI 感知截断，再补齐背景色。展开内容按 gutter 缩进后的宽度渲染。
- **展开时委托原渲染器**：调用原渲染器时传入 `lastComponent: undefined`。原渲染器依赖私有行状态、因而抛错时，改用原始文本兜底。

## 注意事项

- 依赖 Pi 的**私有内部 API**，目标版本是 Pi `0.80.6`，`/tidy-ui status` 也标注为 “Pi 0.80.6 tested”。Pi 升级后需要重新跑单元测试、视觉回归、类型检查和 smoke 检查。
- peer 依赖：`@earendil-works/pi-coding-agent`。运行时还会用到 `@earendil-works/pi-tui`。
- 折叠状态下，第三方工具自己的 `renderCall`/`renderResult` 会被隐藏，只在展开时委托给它们的结果渲染器。和其他自定义工具渲染插件（如 `pi-tidy-tools`）同时启用时，本插件会接管所有工具行的外观。
- 单元测试：`format.test.ts`（`bun:test`）覆盖目标摘要、密钥字段过滤、Hashline 剥离、结构化计数、diff/写入行数和耗时格式。
- 视觉回归：`visual/preview.ts` 用真实的 `ToolExecutionComponent` 和当前的 `glass` 主题（truecolor），在 80、120、160 列三种宽度下渲染 8 个场景，共 24 帧。场景包括：read、bash、grep 出错、web_search 结构化计数、执行中、展开 read、第三方渲染器折叠和展开。脚本要求 Pi/TUI 都是 `0.80.6`，并断言以下几点：不超宽、gutter 不丢、Hashline 不泄露、第三方渲染器折叠时不泄露、展开时正确委托。原始用法（路径是原作者机器上的）：

  ```bash
  cd ~/.pi/agent/extensions/universal-tidy
  NODE_PATH=/home/krita/.bun/install/global/node_modules \
  PI_GLOBAL_NODE_MODULES=/home/krita/.bun/install/global/node_modules \
  FORCE_COLOR=3 \
  bun run visual/preview.ts
  ```

  产物写到 `visual/artifacts/preview.txt` 和 `visual/artifacts/preview.html`。主题路径硬编码为 `/home/krita/.pi/agent/themes/glass.json`。
- 停用和回滚（原先放在扩展目录时的做法）：把目录改名后运行 `/reload`；要恢复，把名字改回来再 `/reload`。

  ```bash
  mv ~/.pi/agent/extensions/universal-tidy ~/.pi/agent/extensions/universal-tidy.disabled
  ```

- `implementation-notes.html` 记录了当时的设计决策（中文）。

## 历史

- 2026-07-13：开始使用。只借鉴 `pi-tidy-tools` 的视觉风格，改用本地运行时 patch 实现，没有沿用它重新注册工具和注入 reasoning schema 的做法。
- 2026-07-16：移除，归档到 `archived/universal-tidy`。源码取自 agent-configs `4da53c8`。
