# pistatusline

> ccstatusline 的 Pi 移植，可自定义的多行底部状态栏

**状态**：在用 · **仓库**：https://github.com/KorenKrita/pistatusline（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/pistatusline
```

扩展入口由 `package.json` 的 `pi.extensions` 声明为 `./src/index.ts`。

## 功能

- 在 Pi TUI 中用自定义 footer 替换内置 footer，渲染最多 3 行状态栏。
- 从 [ccstatusline](https://github.com/sirmalloc/ccstatusline) 移植的 widget 集：模型、上下文（长度 / 百分比 / 进度条 / 窗口）、Git 与 Jujutsu 仓库状态、会话费用 / 时长 / 名称、token 计数、内存与速度，以及自定义文本 / 命令 / 符号 / 链接等。
- Pi 原生 widget（ccstatusline 无对应项）：
  - **Skills**：统计显式 `/skill:` 调用和隐式技能读取（模型用 read 工具读取已知 SKILL.md）。
  - **Compaction**：上下文压缩次数、auto/manual 拆分及回收的 token 数。
- 交互式配置界面：逐行 widget 编辑、widget 选择器、逐项颜色、Powerline 设置、终端宽度 / 颜色级别选项、全局覆盖，均带实时预览。
- 支持 Powerline 分隔符与渐变，输出 16 / 256 / truecolor。
- 数据来自 Pi 的 session / model API，而非 Claude Code transcript；依赖 Anthropic/Claude 专有数据、Pi 中无对应物的 widget 已移除。

## 使用

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 斜杠命令 | `/pistatusline` | 打开配置界面（仅 TUI 模式；非 TUI 下报错提示） |
| 快捷键（配置界面内） | `Ctrl+S` | 在任意页面保存并退出，保存后运行中的 footer 立即刷新 |
| 快捷键（配置界面内） | `Esc` | 在主菜单按下时不保存直接退出（cancelled） |

## 配置

路径：`<agentDir>/pistatusline.json`（`getAgentDir()`，通常为 `~/.pi/agent/pistatusline.json`）。首次运行文件不存在时写入默认值；建议通过 `/pistatusline` 编辑。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `version` | `3` | schema 版本，保存时自动写入 |
| `lines` | 第 1 行：`model`、`context-length`、`git-branch`、`git-changes`（以 `separator` 分隔）；第 2、3 行为空 | 每行的 widget 列表 |
| `flexMode` | `"full"` | 宽度模式：`full` / `full-minus-40` / `full-until-compact` |
| `compactThreshold` | `60` | 1–99，配合 `full-until-compact` |
| `colorLevel` | `2` | `0` 无色 / `1` 16 色 / `2` 256 色 / `3` truecolor |
| `defaultSeparator` | 未设置 | 默认分隔符 |
| `defaultPadding` | 未设置 | 默认填充 |
| `inheritSeparatorColors` | `false` | 分隔符是否继承颜色 |
| `overrideBackgroundColor` | 未设置 | 全局背景色覆盖 |
| `overrideForegroundColor` | 未设置 | 全局前景色覆盖 |
| `globalBold` | `false` | 全局加粗 |
| `gitCacheTtlSeconds` | `5` | Git 信息缓存 TTL，0–60 秒 |
| `minimalistMode` | `false` | 极简模式 |
| `powerline` | `enabled: false`，`separators: ["\uE0B0"]`，`separatorInvertBackground: [false]`，`startCaps: []`，`endCaps: []`，`autoAlign: false`，`continueThemeAcrossLines: false` | Powerline 设置 |

## 实现要点

- 在 `session_start` 中**同步**调用 `loadSettingsSync()` 和 `ctx.ui.setFooter`：必须在 Pi 同步 emit 窗口内替换内置 footer，否则 footer 会被追加到编辑器上方的滚动区（据源码注释，已在 Pi 0.80.10 上验证）。
- footer 与配置命令共享一个可变 runtime（`applySettings`），配置保存后无需重启会话即可刷新 footer。
- 监听 `session_compact`，按 Pi 相同方式（`estimateTokens` 累加压缩后上下文消息）估算压缩后 token，记录 auto/manual 与回收量，供 Compaction widget 使用。
- token / 费用 / 速度等指标由 Pi assistant 消息的 usage（input/output/cacheRead/cacheWrite/cost）聚合得到。
- Skills 统计：用 `parseSkillBlock` 解析 `/skill:` 展开块，并把 read 工具读取已知 SKILL.md 计为隐式调用。
- 配置读取失败或校验失败时只回退到内存默认值、不覆盖原文件，错误显示在配置界面顶部；保存采用临时文件 + rename 的原子写入，并保留符号链接。
- 监听 `footerData.onBranchChange` 在分支变化时重绘。

## 注意事项

- 非 TUI 模式（如 `-p`）不注册 footer，`/pistatusline` 也不可用。
- 启用后会替换 Pi 内置 footer。
- Custom Command widget 会用 `execSync` 执行配置的 shell 命令（默认超时 1000ms），每次渲染都可能触发，注意命令开销与安全。
- Powerline 分隔符需要 Powerline / Nerd Font 字体才能正常显示。
- 渲染引擎、颜色/渐变/powerline 工具、widget 逻辑源自 ccstatusline（MIT © 2025 Matthew Breedlove），见上游仓库 `NOTICE`。

## 历史

- ccstatusline 的 Pi 移植；当前通过 `git:github.com/KorenKrita/pistatusline` 安装，settings 中加载其 `src` 入口。
