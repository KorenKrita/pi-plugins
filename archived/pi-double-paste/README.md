# pi-double-paste

> 连续两次粘贴同一大段文本，把 Pi 的粘贴标记展开为可编辑文本

**状态**：已停用 · **仓库**：https://github.com/KorenKrita/pi-double-paste（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/pi-double-paste
```

已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

Pi 会把大段粘贴折叠成 `[paste #1 +123 lines]` 这样的紧凑标记，方便阅读但无法直接编辑。本插件保留 Pi 首次粘贴的默认行为，并把**短时间内再次粘贴完全相同的内容**视为"展开"请求：

1. 粘贴一段超过 10 行或 1,000 字符的文本，Pi 照常显示折叠标记；
2. 3 秒内再次粘贴同一段文本；
3. 第二次粘贴不会重复插入，而是把编辑器中**所有**当前标记展开为普通文本；
4. 展开后弹出 `Paste expanded.` 提示。

短粘贴、内容不同的长粘贴均保持 Pi 原有行为。

## 使用

无工具、斜杠命令或快捷键；在 TUI 模式下直接通过"双击粘贴"触发。

| 操作 | 效果 |
| --- | --- |
| 首次粘贴长文本（>10 行或 >1,000 字符） | Pi 默认折叠为 paste 标记 |
| 3 秒内再次粘贴相同文本 | 吞掉本次输入，展开编辑器内全部标记，并提示 `Paste expanded.` |

## 配置

无配置。相关阈值为源码常量：

| 常量 | 值 | 位置 |
| --- | --- | --- |
| `DEFAULT_DOUBLE_PASTE_WINDOW_MS` | `3_000`（毫秒） | `src/double-paste.ts` |
| `LONG_PASTE_MAX_LINES` | `10` | `src/paste.ts` |
| `LONG_PASTE_MAX_CHARS` | `1_000` | `src/paste.ts` |

## 实现要点

- 入口 `src/index.ts`（`package.json` 的 `pi.extensions`）；在 `session_start` 时仅于 `ctx.mode === "tui"` 注册 `ctx.ui.onTerminalInput`，`session_shutdown` 时取消订阅。
- 仅识别 bracketed paste（`\x1b[200~` … `\x1b[201~`）；内容先归一化（解码 `ESC[<n>;5u` 形式的 Ctrl 字符、统一换行、Tab 转 4 空格、剔除控制字符）再判断长度。
- 用 SHA-256 对粘贴内容和编辑器文本分别做指纹。首次长粘贴后通过 `setTimeout(cb, 50)` 延迟读取编辑器文本，若发生变化则"布防"一个候选（粘贴指纹 + 编辑器指纹 + 时间戳）。
- 再次粘贴时，若粘贴指纹相同、未超出 3 秒窗口且编辑器指纹未变，则调用 `setEditorText(getEditorText())` 把标记写回为纯文本，并返回 `{ consume: true }` 阻止重复插入。
- 通过代次计数（`armGeneration`）丢弃过期的延迟回调；任何读写失败都放弃展开、保留 Pi 原行为，并只发一次 warning 通知。
- 只使用 Pi 公开扩展 API，不替换或包装输入编辑器。

## 注意事项

- 本仓库是 Kaushik Gopal 的 `@pi-kaush/pi-double-paste`（MIT）的 fork；`package.json` 中的 name / homepage / repository 仍指向上游 `kaushikgopal/pi-kaush`。
- 相对上游的改动：把延迟读取编辑器状态的 `queueMicrotask` 改为 `setTimeout(cb, 50)`，修复 Pi 粘贴处理尚未完成就读取编辑器的竞态问题。
- 需要 Pi ≥ 0.80.6（`@earendil-works/pi-coding-agent` peer 依赖，可选）、Node ≥ 20。
- `Paste expanded.` 通知是临时手段：源码 TODO 注明它用于绕过 Pi 在消费终端输入后不重绘 `setEditorText()` 的问题（earendil-works/pi#5620），待上游修复后可移除。
- 第二次粘贴会展开编辑器中**全部**标记，而非仅对应的那一个。
- 原 README 的安装命令写作 `pi install github:KorenKrita/pi-double-paste`。

## 历史

- 2026-07-22：配置快照中仍包含该仓库。
- 2026-07-30（Work）、2026-08-01（Home）：从配置中移除。
