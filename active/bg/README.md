# bg

> 接管 bash：强制写明超时，支持后台任务与超时转后台

**状态**：在用 · **来源**：KorenKrita 自写的独立实现；此前曾使用 pi-patty-bg-tasks 的 fork，后改为本扩展。

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/bg
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

内置 `bash` 的超时参数是可选的。模型不填就可能一直卡住；超时被杀又会让一次长构建白跑。本扩展用同名工具覆盖内置 `bash`，要求每次调用都明确给出四个参数：

- `command`：要执行的 shell 命令。
- `timeout`：超时秒数，整数，`>= 0`；`0` 表示不设截止时间，只适合常驻服务或 watcher。
- `background`：`false` 表示前台执行，本轮等结果；`true` 表示立刻返回任务 id，任务结束时再通知。
- `onTimeout`：`"kill"` 或 `"detach"`，决定超时后是终止命令还是让它继续运行。

缺任何一个参数，`prepareArguments` 都会直接报错，并列出缺失项：`bash requires all of: command, timeout, background, onTimeout. Missing: ...`。

四种组合的行为如下：

| background | onTimeout | 到达 timeout 时 |
|---|---|---|
| `false` | `kill` | 向进程组发 SIGTERM，5 秒后仍未退出则发 SIGKILL；报错文案与内置一致（`Command timed out after N seconds`） |
| `false` | `detach` | 进程**不被杀**，原地转为后台任务 `bgN`。本次调用提前返回已有输出，末尾附一行提示 `[still running after Ns — moved to background as bgN; ...]` |
| `true` | `kill` | 终止任务，状态记为 `timeout`，并发送完成通知 |
| `true` | `detach` | 任务继续运行，只发一次 `bg-notice` 提醒已超过截止时间 |

后台任务（包括前台转后台的任务）的行为：

- **结束通知**：任务自然退出或因超时被杀时，以 `bg-done` 消息通知模型。消息按 steer 方式投递并触发新一轮（`deliverAs: "steer"`、`triggerTurn: true`），内容包括状态、退出码或信号、耗时、日志路径和末尾输出。1 秒内结束的多个任务会合并成一条消息。
- **不通知的情况**：用 `bg_kill` 或会话关闭杀掉的任务不通知。如果任务结束时正有 `bg_wait` 在等它，也不通知，由 `bg_wait` 自己返回结果。
- **每小时提醒**：任务运行满 1 小时后，每小时发一条 `bg-reminder`，说明仍在运行及日志位置。
- **状态栏**：显示 `bg: N running`。N 包括仍在运行的后台任务和正在执行的前台命令。
- **会话结束清理**：任何原因触发 `session_shutdown`，都会终止全部任务和前台命令，并删除本会话的日志目录。`/reload` 会丢弃全部内存状态，所以任务不会跨 reload 存活，避免留下无人跟踪的进程。

## 使用

### 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `bash` | `command`、`timeout`、`background`、`onTimeout`（全部必填） | 覆盖内置 bash，行为见上文 |
| `bg_status` | `id?`、`lines?`（1–200，默认 30） | 不传 id：列出全部任务，每行包含 id、状态、耗时和命令。传 id：显示状态、超时设置、退出码、耗时、日志路径和末尾 N 行输出 |
| `bg_wait` | `id?`、`maxWait?`（秒，默认 120） | 阻塞到指定任务退出；不传 id 时等所有运行中任务退出。超过 `maxWait` 或被中断时返回当前状态并注明仍在运行 |
| `bg_kill` | `id` | SIGTERM，5 秒后仍未退出则 SIGKILL。不发送完成通知。`timeout 0` 的任务只能用它停止（或结束会话） |

`bash` 同时注入以下 prompt 指引：

- 查询、检查和测试用 `kill`；不能被杀的构建或长任务用 `detach`。
- `timeout 0` 只用于常驻服务和 watcher。
- 只有在任务运行期间确实还有别的事可做时，才用 `background true`。

参数说明里给出的典型超时值：查询 30–60 秒，测试套件 300–900 秒，构建 900–1800 秒。

### 事件钩子与消息

| 钩子 / 消息类型 | 作用 |
|---|---|
| `session_start` | 记录上下文，确定日志目录 `~/.pi/agent/bg/<sessionId>/` |
| `session_shutdown` | 杀掉全部前台命令和后台任务，最多等 250ms 回收，仍存活则 SIGKILL，然后删除日志目录 |
| `bg-done` | 任务完成通知（1 秒防抖合并） |
| `bg-notice` | `onTimeout: "detach"` 的后台任务超过截止时间时的一次性提醒 |
| `bg-reminder` | 每小时的“仍在运行”提醒 |

## 配置

无配置文件。

- Shell 路径和命令前缀读取 Pi 设置，与内置一致（`SettingsManager` 的 `getShellPath()` 和 `getShellCommandPrefix()`）。对 `background: true` 任务，本扩展自行把前缀加在命令之前，中间用换行分隔。
- 环境变量 `PI_BG_REMINDER_MS`：测试用，大于 0 时替换默认的 1 小时提醒间隔（单位毫秒）。

## 实现要点

- **复用内置 bash**：前台执行调用 `createBashToolDefinition`，并传入自定义 `BashOperations`。流式输出、50KB / 2000 行截断（完整输出存入临时文件）、渲染器和内置错误文案都来自内置实现；本扩展只接管进程的创建和超时处理。`timeout 0` 传给内置定义时变成 `undefined`。
- **转后台时不重启进程**：`detach` 模式下，前台输出同时写入 `run-<时间戳base36>-<n>.log`。到达超时后，同一个子进程被登记进任务表，日志重命名为 `bgN.log`，让日志路径与 id 对应。转后台提示只写进工具结果，不写进日志，日志里只保留命令本身的输出。`kill` 模式不落盘，前台结束后临时日志即删除。
- **按进程组终止**：子进程以 `detached: true` 启动，终止时用 `process.kill(-pid, sig)` 向整个进程组发信号。代码拒绝向 pid 0 和 1 发信号。
- **只读日志尾部**：`bg_status` 等接口只读取日志最后 4000 字节，丢掉开头可能不完整的一行后，取最后 N 行，避免加载多 GB 的构建日志。
- **耗时冻结**：请求终止时记下时间，进程死亡前的耗时按这个时间冻结；进程被回收后以实际退出时间为准。
- **任务表有上限**：已结束的任务最多保留 20 个，超出后从最旧的开始淘汰。运行中的任务从不淘汰。查询未知 id 时会列出现有 id。
- **会话环境变量**：后台任务的子进程环境与内置 bash 相同，注入 `PI_SESSION_ID`、`PI_SESSION_FILE`、`PI_PROVIDER`、`PI_MODEL`、`PI_REASONING_LEVEL`（先清除继承来的同名变量）。前台命令使用内置定义传入的 env。
- **关闭时同步清理**：`session_shutdown` 等 SIGKILL 前的回收最多 250ms，删除目录用同步的 `rmSync`，因为 `-p` 模式下进程会在任何定时器触发前退出。

## 注意事项

- 本扩展以同名工具覆盖内置 `bash`，与其他同样覆盖 `bash` 的扩展冲突。
- 所有参数必填，调用 `bash` 时只传 `command` 会直接失败。
- 后台任务的生命周期绑定会话，`/reload`、切换或关闭会话都会杀掉它们并删除 `~/.pi/agent/bg/<sessionId>/` 下的日志。需要跨会话存活的进程不适合用本扩展运行。
- 终止依赖进程组信号（负 pid）。
- 依赖 `@earendil-works/pi-coding-agent`（peer）导出的 `createBashToolDefinition`、`getShellConfig`、`SettingsManager` 等 API，以及 `@earendil-works/pi-ai` 的 `StringEnum` 和 `typebox`。

## 历史

- 此前使用过 pi-patty-bg-tasks 的 fork（Claude Code 风格的后台任务），后改为本扩展。
- 2026-09-10 前后开发，原位于 `~/.pi/agent/extensions/bg/`，后收入本合集 `active/bg`。
