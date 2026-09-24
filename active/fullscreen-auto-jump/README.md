# fullscreen-auto-jump

> 全屏模式下长回答结束后，自动跳到回答第一行

**状态**：在用 · **来源**：KorenKrita 自写；2026-08-06 由 fixed-input 扩展的部分文件演进而来（`assistant-range.ts` 移植自 `fixed-editor/assistant-range.ts`）

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/fullscreen-auto-jump
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

助手回答比屏幕还高时，Pi 会把对话记录（transcript）停在回答的**末尾**，读的时候就得从半句话开始。本扩展在本轮结束（`agent_settled`）后，把视口移到这条回答的**第一行**。

它面向 Pi 的全屏（alternate-screen）transcript，**不接管渲染**，只读取 transcript 的几何信息，再调用公开的滚动 API。

| 时机 | 行为 |
| --- | --- |
| 新一轮开始（`before_agent_start`） | 调用 `scrollToBottom()` 把 transcript 固定到底部，让回答在视野里流式输出（上一轮跳转后视口停在别处也一样）。 |
| 本轮结束，回答高于视口 | 视口跳到回答第一行。 |
| 本轮结束，回答放得下 | 不动，Pi 自带的跟随末尾已经能显示全文。 |
| 用户滚走了，而且没有回来 | 不跳。 |
| 用户滚走后又回到底部 | 照样跳（停在底部就表示“给我看新回答”）。 |
| 有 overlay / 对话框打开 | 不跳。 |

测量时不算 thinking 块和工具调用：跳转目标是“人能读的回答正文”开始的地方，不是本轮输出开始的地方。

补充细节（来自源码）：

- 只看**最后一个**助手消息组件。如果它没有文字内容（例如只有工具调用，或 `stopReason: "error"` 的报错消息），就不跳，也不会退回去找更早那条带文字的回答。
- 回答范围按当前 transcript 内容宽度重新渲染后计算，行数会随终端宽度变化。
- 目标位置会被限制在 `[0, contentHeight - viewportHeight]` 以内，不会滚过文档末尾；回答刚好等于视口高度也算“放得下”。
- 只在 `ctx.mode === "tui"` 且 `ctx.hasUI` 时生效；print / 无头模式下完全不动。

## 使用

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 斜杠命令 | `/fullscreen-auto-jump` | 报告扩展是否生效，并对当前回答重跑一次跳转。非全屏环境下以 `warning` 提示 `fullscreen-auto-jump: inactive (this Pi build has no fullscreen transcript)`；全屏环境下提示 `fullscreen-auto-jump: active — <detail>`，`<detail>` 可能是 `jumped to line N`、`no jump (<reason>)` 或 `no measurable answer`。本次重跑拿不到结果时，改为显示上一次 `agent_settled` 的决策。 |
| 事件钩子 | `session_start` | 在 TUI 模式下抓取 TUI 实例。 |
| 事件钩子 | `before_agent_start` | 把 transcript 滚回底部。 |
| 事件钩子 | `agent_settled` | 等新的布局帧出来后，测量并决定是否跳转。 |
| 事件钩子 | `session_shutdown` | 清空抓到的 TUI 和上一次的决策。 |

不跳转时的原因（`reason`）：

| reason | 含义 |
| --- | --- |
| `user-scrolled-away` | 结束时 `isFollowingOutput` 为 false，即用户滚走了。 |
| `degenerate-viewport` | 视口高度非有限值或 ≤ 0。 |
| `answer-fits` | 回答行数 ≤ 视口高度。 |
| `already-there` | 视口已经在目标位置。 |

## 配置

无配置。

## 实现要点

- **文件分工**：

  | 文件 | 作用 |
  | --- | --- |
  | `index.ts` | 挂接钩子：`session_start`、`before_agent_start`、`agent_settled`、`session_shutdown`，并注册命令。 |
  | `adapter.ts` | 兼容不同版本的桥接层，连到全屏 transcript 及其几何信息。 |
  | `policy.ts` | 纯滚动决策（`decideJump`），不访问 TUI。 |
  | `assistant-range.ts` | 找出最后一条助手回答的正文行范围。 |
  | `capture.ts` | 用一次性的 widget factory 抓取 TUI。 |

- **抓取 TUI**：`session_start` 时用键 `__fullscreen_auto_jump_capture` 调用 `ui.setWidget`，在 factory 回调里拿到 TUI，随后立刻 `setWidget(key, undefined)` 清掉，不会留下可见的 widget。
- **识别全屏界面**：TUI 必须带 `Symbol.for("@earendil-works/pi-tui/viewport")` 标记，并且具备 `setLayoutRoot`、`scrollBy`、`scrollToBottom`、数值型 `viewportTop` 和布尔型 `isFollowingOutput`，否则视为 inline transcript，什么都不做。
- **几何信息读取**：公开接口没有暴露主 ScrollView 和它的尺寸，所以从 `currentLayout` 帧里防御性地读取：用 `primaryScrollView`、`scrollTop`、`getContentWidth()`，再从 `root` 盒子树中找对应 box 的 `rect`。视口尺寸取自帧，**内容高度则用实时文档 `render(contentWidth)` 的行数**，不用帧里缓存的行。任何一步形状不对或抛异常，都返回 null。
- **`currentLayout` 只在节流的渲染过程中重建**（约 16ms）。到 `agent_settled` 时，帧可能还停留在回答追加**之前**的文档，ScrollView 也会按过时的内容高度去截断滚动，测量结果会让跳转落点偏短。所以 `waitForFreshLayout` 会先调用 `requestRender()`，再每 4ms 轮询帧的对象身份，直到出现新帧；最多等 120ms，避免一个从不重渲染的构建把钩子卡住。
- **不用 `requestRender(true)`**：强制渲染会重置渲染状态，每轮都重绘整屏并丢掉 Kitty 图片。实测强制渲染会输出 `\x1b[2J`（约 1469 字节），普通渲染约 22 字节。因此只用普通的 `requestRender()`，然后等新帧。
- **滚动只走公开 API**：`scrollViewportTo` 把绝对目标换算成相对偏移，调用 `scrollBy(delta)` 后再 `requestRender()`；偏移为 0 时不操作。
- **取消判断只在结束时看 `isFollowingOutput`**：滚走后又回到底部的用户，*不会*被记成“滚走过”。这是有意为之，停在底部就表示“给我看新回答”。

## 注意事项

- **版本兼容**：全屏在 Pi 0.84.0 及以后可用，这时本扩展会在 alternate-screen transcript 上生效。0.83.0 等旧版本里 transcript 是 inline 的，没有可滚动的界面，本扩展完全是 no-op，从不碰 TUI（测试断言两个回合钩子都不会调用 `render` / `requestRender`，也不发通知）。它读取的每个内部属性都在调用时探测并检查类型，所以不支持全屏的构建，或者这些内部结构改了形状的构建，也同样退化为 no-op，不会抛错。
- **依赖 Pi 内部结构**：`currentLayout`、`primaryScrollView`，以及助手组件的 `lastMessage` / `contentContainer` 都不是公开 API；上游改动后，扩展可能静默失效（退化为 no-op）。
- **开发依赖**：`@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui` 固定为 `0.83.0`，`typescript` 为 `5.9.3`，测试用 Bun。
- **测试**：

  ```bash
  bun test        # 55 tests
  bunx tsc --noEmit
  ```

  覆盖范围：
  - `policy.test.ts`：纯决策的每个分支。
  - `adapter.test.ts`：几何探测、过时帧处理、形状异常时的退化。
  - `assistant-range.test.ts`：正文范围定位（跳过 thinking、取最后一条、报错消息不回退、随宽度重算）。
  - `runtime-noop.test.ts`：通过 Pi **真实**的 0.83 扩展加载器加载，断言钩子从不碰 TUI。
  - `fullscreen-behavior.test.ts` / `upstream-fullscreen.test.ts`：扩展驱动**真实**的 `TuiAltScreen` + `ScrollView` + 布局引擎，transcript 里放的是真实的 Pi `AssistantMessageComponent`。

  最后两个文件需要上游 Pi 源码：把 `PI_MONO_MAIN` 指向 Pi monorepo 的 checkout（默认 `/tmp/pi-mono-main`），没有时两个文件都会直接跳过。那份 checkout 没有 `node_modules`，所以会把它的 `packages/tui/src` 镜像到本扩展的 `node_modules/.upstream-pi-tui*` 下，好让其依赖能解析。

## 历史

- 2026-08-06：由 fixed-input 扩展的部分文件演进而来，其中 `assistant-range.ts` 移植自 `fixed-editor/assistant-range.ts`，目的是让本扩展自成一体。
- 原先安装在 `~/.pi/agent/extensions/fullscreen-auto-jump/`，后来收进本合集的 `active/fullscreen-auto-jump`。
