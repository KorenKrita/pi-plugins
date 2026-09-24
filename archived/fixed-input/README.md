# fixed-input

> 把输入框和页脚固定在终端底部，对话记录独立滚动

**状态**：已停用 · **来源**：KorenKrita 自写的 Pi 扩展，源码取自私有仓库 agent-configs（提交 `ac81621`），部分文件已迁入 `fullscreen-auto-jump`

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/fixed-input
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

让 Pi 的输入编辑器、它周围的状态栏/widget 和原生的模型/token 页脚一起固定在终端可见区域的底部，对话记录则在上方独立滚动。页脚仍然在编辑器下方，和 Pi 原来的位置一样。滚动对话记录时，输入编辑器一直保持焦点、一直可见。

**固定区域（cluster）**

- 编辑器上下的五个槽位（状态容器、编辑器上方 widget、编辑器容器、编辑器下方 widget、页脚）从 Pi 原本的渲染流里隐藏，改由本扩展画在屏幕底部，从上到下依次是：上方 widget + 状态行（空行会被去掉）、编辑器、下方 widget、页脚。
- 固定区域最多占 `终端行数 - 1` 行。空间不够时优先保证页脚和编辑器：编辑器被截断时，窗口会跟着光标所在行走；没有光标时跟着以 `→ ` 开头的选中行（居中显示）。
- 编辑器内的光标标记（`\x1b_pi:c\x07`）会被换成真正的终端光标位置。即使没有显示硬件光标，光标也会停在编辑器的逻辑光标位置，这样 macOS 输入法候选窗能出现在正确的地方。

**滚动**

- 鼠标滚轮：每格滚 3 行。
- `PageUp` / `PageDown`、`Ctrl+Shift+Up` / `Ctrl+Shift+Down`、`Super+Up` / `Super+Down`（要终端支持才行）：每次滚 10 行。

**发送消息与长回答**

- 发送消息时（`before_agent_start`），对话记录先回到底部，再开始跟踪这一轮。这是程序触发的跳转，不算用户滚动。
- agent 完全结束（`agent_settled`）后，扩展会动态找出最后一条 assistant 消息渲染出来的**正文**范围。只有正文本身比可见的对话区域还高时，才会跳到正文开头。thinking 块、工具调用和工具结果都不参与这个判断。范围按当前终端宽度重新计算，所以终端尺寸变化或 Markdown 重排后不会用到过期的行号。如果最后一个 assistant 组件没有正文（比如是错误消息），就不会退回去找更早的正文。
- agent 运行期间只要有任何手动滚动（包括滚轮、快捷键、拖选时贴边自动滚动），这一轮的自动跳转就会取消。即使视图其实没动，或者用户之后又滚回了底部，也照样取消。
- 用户真正滚离底部后，视图会用内容锚点保住当前阅读位置。之后工具输出折叠、内容重排、最终回答变长，位置都不会丢；可滚动范围临时变小也不会悄悄恢复成"跟随底部"。

**鼠标选择与复制**

- 左键拖动可以选中对话区或固定区域里的文字，松开后复制到剪贴板（只写一次）。复制出来的文字会去掉完整的或没有结尾的终端控制串，以及不允许的 C0/C1 控制字符。
- 500 ms 内在同一行再按一次左键，会选中整行。
- 在对话区拖选时，拖到视图顶部或底部会自动逐行滚动。
- 在已选中的文字上按右键，会暂停鼠标上报 1200 ms，让终端弹出原生右键菜单。在选区外按右键会清掉选区，并把事件交给 Pi。
- 本扩展不处理的 SGR 鼠标包会原样交给 Pi。

**其他行为**

- 安装后会进入备用屏幕（alternate screen），开启鼠标上报（`?1002`/`?1006`），关闭 alternate scroll mode。
- 如果有可见的、会捕获输入的 overlay，本扩展会暂停输入处理和分屏渲染；non-capturing overlay 不影响。
- 视图滚动或尺寸变化后，会清掉所有 Kitty 图片，避免残影。
- 如果 Pi 私有的编辑器/状态栏/页脚布局和预期不一样，安装会"失败即关闭"：只弹一条警告，不会去隐藏不相干的组件。

## 使用

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 斜杠命令 | `/fixed-input` | 查看合成器是否已生效（`Fixed input is active` / `Fixed input is not active`） |
| 事件钩子 | `session_start` | 只在 `tui` 模式下生效：包装当前的编辑器工厂（没有就用 `CustomEditor`），编辑器创建后异步安装合成器 |
| 事件钩子 | `before_agent_start` | 跳回对话记录底部，并开始跟踪这一轮回答 |
| 事件钩子 | `agent_settled` | 最终正文超过可见高度，且这一轮没有手动滚动时，跳到正文开头 |
| 事件钩子 | `session_shutdown` | 卸载合成器；如果编辑器工厂还是自己装的那个，就恢复原来的工厂 |
| 快捷键 | `PageUp` / `PageDown` | 对话记录上/下滚 10 行 |
| 快捷键 | `Ctrl+Shift+Up` / `Ctrl+Shift+Down` | 同上 |
| 快捷键 | `Super+Up` / `Super+Down` | 同上（要终端支持） |
| 鼠标 | 滚轮 | 上/下滚 3 行 |
| 鼠标 | 左键拖动 / 同一行连按两次 | 选中文字 / 选中整行，松开后复制 |
| 鼠标 | 在选区上按右键 | 暂停鼠标上报 1200 ms，方便弹出终端右键菜单 |

旧版文档说明：以前扩展放在 `~/.pi/agent/extensions/fixed-input/`，由 Pi 自动发现。安装或修改后需要执行 `/reload`。

## 配置

无配置。滚动快捷键固定为 `super+up` / `super+down`（`DEFAULT_KEYBOARD_SCROLL_SHORTCUTS`）。合成器的构造选项 `keyboardScrollShortcuts` 本身支持改键，但 `index.ts` 没有把它开放出来。

## 实现要点

- **定位布局**：`resolveFixedInputLayout` 在 `tui.children` 里找到包含编辑器的容器，然后取它前面 2 个、后面 2 个槽位，作为五个固定槽位。只要有一个槽位不存在或不可渲染，就返回 `null`。安装最多重试 `MAX_INSTALL_ATTEMPTS = 20` 次，每次间隔 `INSTALL_RETRY_MS = 20` ms，全部失败后弹警告。每次会话会递增 `generation`，用来丢弃过期的安装任务。
- **分屏合成**：`TerminalSplitCompositor` 修改了几处运行时行为：
  - 把 `terminal.rows` 换成 getter，返回 `终端行数 - 固定区域行数`，让 Pi 以为屏幕只有这么高；
  - 接管 `tui.render`，只输出可滚动窗口；
  - 接管 `terminal.write`，先用 DECSTBM 设置滚动区域，再写入内容，最后补画固定区域；
  - 接管 `tui.doRender`，每一帧结束后重画固定区域，并在同一帧内缓存固定区域的渲染结果；
  - 接管 `compositeLineAt`，把制表符换成空格后再叠加 overlay。
  
  所有输出都包在同步输出（`?2026`）里。
- **跳到回答开头**：`findFinalAssistantTextRange` 按 `AssistantMessageComponent` 的 `lastMessage.content` 和 `contentContainer.children` 的对应关系，跳过前导空行和 thinking 组件，定位正文子组件，再从根节点累加渲染行数，算出它的起止行。`AgentResponseJumpState` 负责记录"本轮有没有滚动意图"，每轮开始时重置。
- **视图锚点**：`captureViewportAnchor` 记录三样东西：视图里第一条非空行的可见文本签名、前后各 2 行的上下文签名、一个独立的逻辑起始行。恢复时先找签名一致的行，再按上下文匹配数和离原位置的距离选出最佳匹配，这样重复行也能区分开；一行都找不到时，退回到逻辑起始行。视图被临时截断时，不会覆盖掉持久保存的锚点。
- **只恢复自己的修改**：`dispose` 只在各个 patch、隐藏渲染器、编辑器工厂仍然是本扩展装上的那个时才恢复，不会破坏其他扩展后来装的 patch。`rows` 会区分"原本就是自有属性"和"从原型继承"两种情况：前者恢复原描述符，后者直接删掉覆盖。读 `rows` 时，数据描述符直接读取，避免递归调用到自己装的 getter。
- **终端键盘模式**：Kitty 键盘协议按 push/pop 处理（`\x1b[>7u` / `\x1b[<u`）。如果 modifyOtherKeys 原本就是开启的，离开备用屏幕后会重新打开它。退出（`quit`）或重载（`reload`）时会强制重置扩展键盘模式。另外注册了 `process.once("exit")` 做兜底清理；如果合成器从没装上，就写 `emergencyTerminalModeReset()`。
- **边界情况**：终端只有 1 行时仍按 1 行处理；终端不超过 2 行或固定区域为空时，写入会直接透传，不做分屏绘制。

## 注意事项

- 依赖 Pi 的私有 TUI 结构：编辑器周围的五个槽位布局、`TUI` 的 `addInputListener` / `getTopmostVisibleOverlay` / `render` / `doRender` / `compositeLineAt`、`hardwareCursorRow` / `previousViewportTop`、`AssistantMessageComponent` 的 `lastMessage` / `contentContainer`，以及终端的 `kittyProtocolActive` / `_modifyOtherKeysActive`。开发时锁定的是 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui` 的 `0.80.6` 版本，另有一个基于真实 Pi 0.80.6 扩展加载器的冒烟测试守着这些接口。
- 只在 `tui` 模式下工作。
- 它会包装当前的编辑器工厂（`getEditorComponent`/`setEditorComponent`）。如果别的扩展之后又替换了编辑器工厂，卸载时就不会覆盖回去。
- 会独占鼠标上报，并进入备用屏幕，所以终端原生的滚动回看和原生选择都被接管了；复制由扩展通过 `copyToClipboard` 完成。
- 本仓库已停用；部分文件已迁入 `fullscreen-auto-jump`。
- 开发验证：

  ```bash
  bun run test
  bun run typecheck
  ```

## 历史

- 2026-07-22：已存在（源码见私有仓库 agent-configs，提交 `ac81621`）。早期放在 `~/.pi/agent/extensions/fixed-input/`，由 Pi 自动发现。
- 2026-08-06：删除，部分文件迁入 `fullscreen-auto-jump`。
