# pi-patty-bg-tasks

> 仿 Claude Code 的后台任务：长命令自动转后台，附任务管理与事件监听

**状态**：已停用 · **仓库**：https://github.com/KorenKrita/pi-patty-bg-tasks（源码与 issue 以该仓库为准）

来源：fork 自 https://github.com/patty-io/pi-patty-bg-tasks（上游作者 Patrick Rho，MIT），非原创；本 fork 仅有少量改动。

## 安装

```bash
pi install git:github.com/KorenKrita/pi-patty-bg-tasks
```

已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

- 覆盖内置 `bash` 工具：命令超过 120 秒仍未结束时自动转入后台，agent 继续工作；也可用 `run_in_background: true` 直接后台启动。
- `bash_bg`：直接在后台启动命令，结束时发送 `<task-notification>`。
- `jobs`：列出、查看输出、终止、跟随等待、正则搜索、清理、统计后台任务。
- `agent_bg`：以当前会话上下文生成续接提示，后台启动一个 `pi -p` 进程执行任务。
- `monitor`：把命令的每行 stdout（或 WebSocket 文本帧）作为一条事件实时推送给 agent。
- 手动转后台：Ctrl+Shift+B 或 `/bg`；命令运行超过约 2 秒后，输入框下方出现 `(ctrl+shift+b to run in background)` 提示。
- 协作式插话：前台 `bash` 命令运行时用户输入消息，会把该命令转入后台、中止当前轮次，并把消息作为新一轮 follow-up 重新投递。
- 输出卡在交互式提示（如 `(y/n)`、`Press Enter`）时发出 stall 警告；侧边栏 pill 实时显示运行中任务的时长与最新输出行。

## 使用

### 工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `bash`（覆盖内置） | `command`、`timeout`（秒，默认 120）、`run_in_background`、`description` | 前台运行，超时自动转后台；`run_in_background: true` 立即后台 |
| `bash_bg` | `command`、`name`、`timeout`（秒）、`notify`（默认 true） | 立即后台启动；超时只会杀掉不可自动后台的命令（如 `sleep`） |
| `jobs` | `action`、`jobId`、`pattern`、`wait`（attach 默认 true） | `action` 取 `list` / `output` / `kill` / `attach` / `search` / `cleanup` / `stats` |
| `agent_bg` | `prompt`、`cwd`（默认当前目录） | 后台运行 `pi -p --mode text`，沿用当前模型，实时回传进度 |
| `monitor` | `command` 或 `ws: { url, protocols? }`（二选一）、`description`（必填）、`persistent`（默认 false）、`timeout_ms`（默认 300000，上限 3600000） | 逐事件推送；`persistent` 时不超时，用 `jobs action='kill'` 停止 |

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/bg` | 把所有正在运行的前台命令转入后台（同 Ctrl+Shift+B） |
| `/bg-list` | 打开交互式后台任务管理器 |
| `/bg-version` | 显示已加载的扩展版本与路径 |

### 快捷键

| 快捷键 | 说明 |
|--------|------|
| Ctrl+Shift+B | 把所有前台命令转入后台（tmux 未开 extended-keys 时改用 `/bg`） |
| Ctrl+Shift+J / Shift+Down | 打开后台任务管理器 |
| Ctrl+Shift+X | 终止最近启动的运行中任务 |

## 配置

无配置。行为参数为 `src/types.ts` 中的常量：自动后台超时 120 秒、快速完成窗口 2 秒、最多 16 个并发后台任务、单任务日志上限 100 MiB、stall 判定阈值 45 秒；日志目录固定为 `/tmp/pi-bg`。

## 实现要点

- 后台任务是 detached 的 Node.js `child_process.spawn` 子进程，stdout/stderr 直接写入 `/tmp/pi-bg/<id>.log` 的文件描述符；不依赖 tmux，无运行时依赖。
- 任务 ID 按类型加前缀：`b`（shell）、`m`（monitor）、`a`（agent），后接 8 位 base36 随机字符。
- 三类任务共用一个纯内存 registry 和一套通知逻辑；监听子进程 `exit` 而非 `close`，避免守护化的孙进程继承 fd 后拖住任务。
- 完成通知以 `<task-notification>` 按 steer 方式在轮次中途投递，每个任务只发一次；`jobs output` / `attach` 读取过结果后会抑制待发通知。
- 前台 `bash` 被 Esc 取消时终止进程组；因插话、Ctrl+Shift+B 或超时转后台时则保留进程继续运行。
- 拦截用于等待的 `sleep N`（≥2 秒，含 `;`、`&&`、`||`、换行串联的情况），引导改用 `jobs attach`、`monitor` 或 `until` 循环；循环体内的 `sleep` 不拦截。
- `monitor` 以 200ms 为批处理窗口跟随输出，10 秒内超过 500 行即自动停止；只有 stdout 作为事件流，stderr 写入单独的 `.err` 文件。
- 非交互模式（`-p` / `--print` 或 stdin 非 TTY）下不做超时自动后台。

## 注意事项

- 覆盖了内置 `bash` 工具，可能与其他覆盖 `bash` 的扩展冲突。
- 会话以任何原因关闭时，所有运行中的任务都会被终止，不会跨会话恢复；`/tmp/pi-bg` 下的日志交给系统清理。
- `persistent` monitor 的日志不设大小上限，长期 `tail -f` 应先过滤再输出。
- `monitor` 管道中每一级都要逐行刷新（`grep --line-buffered`、`awk fflush()`），不要接 `head`。
- `ws` 来源依赖运行时的全局 `WebSocket`（Node 22+），否则需改用 `websocat` 之类的命令。
- `package.json` 的 peerDependencies 要求 `@earendil-works/pi-coding-agent` 等 >=0.79.0。

## 历史

- fork 自 patty-io/pi-patty-bg-tasks（v2.0.0，Claude Code parity 重构版），KorenKrita 只提交了少量改动。
- 2026-08-06 在 Pi 中注册过该 fork，后被自写的 bg 扩展取代，现已停用。
