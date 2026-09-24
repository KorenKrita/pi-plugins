# pi-best-of-n

> 多模型并行生成候选，用 logprob 验证器选出最优结果

**状态**：已停用 · **仓库**：https://github.com/KorenKrita/pi-best-of-n（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/pi-best-of-n
```

已停用插件未在当前 Pi 版本上验证，可能需要适配（原 `peerDependencies` 要求 `@earendil-works/pi-coding-agent >=0.84.2 <0.85`）。

## 功能

对同一个任务或同一轮回复，用多个模型或多次尝试并行生成候选，再用 LLM-as-a-Verifier（Kwok et al.）方法排名：验证器不采用单次采样出来的评分，而是读取评判模型在 A–T 共 20 个评分字母上的 **token logprob 分布**并取期望值，得到连续分数。

两种模式：

- **任务模式（A）**：每个候选都是一次无头 Pi 运行，各自在独立的 `git worktree` 中执行。验证器根据完整轨迹和 patch 排名，只有胜出候选的 patch 可能应用到你的工作区。
- **回复模式（B）**：注册一个包装模型 `best-of-n/ensemble`，把一轮 assistant 回复采样 N 次，只有验证器选中的回复会流回会话，它的工具调用才会执行。

每次运行都会在结果消息中分别报告生成端和验证端的 token 用量，并写入审计产物。

## 使用

| 调用 | 作用 |
|---|---|
| `/best-of-n <task>` | 执行一次任务模式 |
| `/best-of-n on` / `off` | 开启/关闭任务连续模式：之后空闲时发出的普通文本消息都按任务模式运行 |
| `/best-of-n setting` | 打开交互式设置界面 |
| `/best-of-n-reply <prompt>` | 一次性回复模式：只在这一轮切换到包装模型，结束后恢复原模型 |
| `/best-of-n-reply on` / `off` | 开启/关闭持续回复模式（会话一直使用包装模型） |
| `/best-of-n-reply setting` | 打开同一个设置界面 |
| `Esc`（任务模式运行中） | 取消当前任务运行 |

- 两个命令都支持补全保留参数 `on` / `off` / `setting`；参数先去除首尾空白，再不区分大小写匹配，其余内容一律当作任务或提示文本。
- 任务连续模式和回复连续模式互斥，开启其中一个会关闭另一个。
- 任务连续模式只拦截空闲状态下的普通文本；斜杠命令、`!` shell 行、带图片的消息和流式过程中的 steering 都会原样放行。
- 注册的 provider/model：`best-of-n` / `ensemble`（显示名 "Best-of-N Ensemble"）。

## 配置

配置层按以下顺序叠加，后面的层覆盖前面的层：

1. 内置默认值
2. 全局：`<agentDir>/best-of-n.json`（通常为 `~/.pi/agent/best-of-n.json`）
3. 项目：`.pi/best-of-n.json`，**仅在项目受信任时读取**；项目不受信任时只检查文件是否存在并给出警告

合并规则：`candidates` 整体替换；`verifier` 逐字段合并；`verifier.criteria` 只要在某层出现就整体替换；其余顶层字段直接覆盖。未知键、重复的 candidate model、重复的 criterion name 都会报错。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `candidates` | `[]` | `{ model, runs, enabled }` 数组。`model` 为 `provider/id`，可加思考等级后缀，如 `provider/id:high`；只有跨 provider 不歧义时才接受裸 id。`runs` 默认 `1`，`enabled` 默认 `true` |
| `verifier.model` | `"deepseek-v4-flash"` | 必须是返回 `top_logprobs` 的 OpenAI chat-completions 模型 |
| `verifier.nEvaluations` | `1` | 每对候选在每条准则上的重复评估次数，范围 1–4 |
| `verifier.criteria` | `"default"` | `"default"` 使用内置的 Requirements / Correctness / Verification 三条准则；也可以写 `{ name, description }` 数组整体替换 |
| `verifier.maxConcurrency` | `8` | 验证器 HTTP 并发数 |
| `apply` | `"never"` | 可选 `never` / `confirm` / `auto`，决定任务模式如何处理胜者 patch |
| `maxConcurrency` | `2` | 任务模式候选子进程并发数 |
| `perCandidateTimeout` | `600000` | 单个候选的墙钟超时（毫秒），上限 `900000` |

- `verifier.thinking` 会在加载时被拒绝，因为推理 token 会挤占评分 token 的预算。
- 硬上限：启用的 runs 总数为 2–8（最小值 2 在调用时检查）；每次调用最多 512 次验证器 HTTP 请求；单个评判请求不超过 2 MiB。
- 评分准则没有 UI 编辑入口，只能手写在配置文件中。原仓库提供示例配置 `config.example.json`。

## 实现要点

- 任务模式的候选子进程命令为 `pi -p --mode json --no-session --no-extensions --model <provider/id>`，在基于记录下来的 HEAD 创建的 `git worktree` 中运行；被 git 忽略的文件（如 `.env`、`node_modules`）不会出现在 worktree 中。
- 运行前要求父工作区干净，并按仓库加锁（`<agentDir>/best-of-n/locks`）。取消时先发 SIGTERM，再发 SIGKILL，然后清理 worktree。
- 生成候选之前，先向评判端点发一次探测请求；如果 `top_logprobs` 中出现的合法评分字母少于 2 个，就直接中止运行。
- 评分方式为两两轮询比较：每条准则单独评估，并交替 A/B 位置以抵消位置偏差。分数折算到 0–100；胜者领先不足 5 分记为 uncertain，某一对完全拿不到有效证据则记为 degraded，这两种情况都会阻止 `auto` 应用。
- `confirm` 应用流程：先展示 diff 预览（截断到 3000 字符）；用户确认后再次核对 HEAD 和工作区状态是否与预检时一致；然后先执行 `git apply --check`，再执行 `git apply`。没有 UI 时，`confirm` 会降级为 `never`。插件从不 commit 或 push。
- 回复模式通过 `registerProvider` 的 `streamSimple` 完全接管请求（endpoint 只是占位）。包装模型的 `contextWindow` 会在 `session_start` 时改写为各候选模型中最小的窗口，默认 `128000`。模型为 DeepSeek 的评判请求会自动附带 `thinking: {"type": "disabled"}`。
- 回复模式预算按每次 agent run 重置：最多 8 轮、64 次 completion、30 分钟。一次性模式在 `agent_settled` 时恢复原模型，另有 15 秒 watchdog 兜底；如果用户手动切换模型，回复模式会自动关闭。
- 审计产物写入 `<agentDir>/best-of-n/runs/<runId>/`（目录权限 0700，文件 0600），包括各候选的 `events.jsonl`、`trajectory.md`、`changes.patch`，以及 `result.json`、`winner.patch`、`reply.json` 等，不会写入 API key。

## 注意事项

- 验证器只支持 OpenAI `/chat/completions` 的 logprobs 协议。按原 README 的实测结果，可用的评判模型基本只有 `deepseek-v4-flash` / `deepseek-v4-pro`、`gemini-2.5-flash`；Claude、Gemini 3.x、GPT-5.x（Responses API）等都不返回 logprobs。
- worktree 只隔离仓库状态，**不是沙箱**：候选进程仍然可以访问宿主机的文件系统和网络。
- 修改了 submodule（gitlink）的候选会被判为 `invalid`，不参与排名。
- 回复模式会让每一轮被拦截的对话（包括 agent 循环里的每次工具往返）都产生 N 次生成调用加上验证调用，成本很高。
- 审计产物不会自动清理，其中可能包含源码和工具输出，请当作敏感数据处理。

## 历史

- 曾通过 `pi install git:github.com/KorenKrita/pi-best-of-n` 安装使用。
- 卸载日期不明，当前未加载。
