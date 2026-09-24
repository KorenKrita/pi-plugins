# KorenKrita 的 Pi 插件合集

[Pi coding agent](https://github.com/earendil-works/pi) 扩展合集：我自己写或维护过的插件都在这里，按「在用 / 已停用」分成 [`active/`](active/) 和 [`archived/`](archived/) 两个目录，每个插件一个子目录，里面有完整的 README。

- 源码放在本仓库的插件：子目录里就是源码，带 `package.json`（`pi.extensions` 清单），可直接用本地路径安装。
- 有独立 GitHub 仓库的插件：子目录里只有 README，源码以对应仓库为准。
- 末尾另列我当前在用的第三方插件。

## 星级口径

★ 为助手（Claude）按「日常价值 × 完成度 × 维护状态」给出的主观评分，满分 5 星；不是用户评分，也不是下载量。已停用插件的分数反映当时的实现质量和可借鉴度。

## 安装

每个插件都给了一行命令，见下方表格的「安装」列：

- **有独立仓库**：`pi install git:github.com/KorenKrita/<repo>`
- **源码在本仓库**：这类插件没有自己的仓库，所以要先把合集克隆到 `~/.pi/agent/pi-plugins`（已存在则 `git pull`），再用本地路径安装对应子目录：

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/<插件名>
```

> 为什么不做成 `pi install git:...@<branch>`：Pi 的 git 包按 `host/path` 确定安装目录和包身份，会忽略 ref，同一仓库的多个分支会互相覆盖，没法同时装多个插件。

更新本仓库里的插件：`git -C ~/.pi/agent/pi-plugins pull`。

## 目录

### 在用（active/）

| 插件 | 一句话介绍 | 评分 | 安装 |
| --- | --- | --- | --- |
| [pi-note-context](active/pi-note-context/) | 用 notebook 管理上下文窗口：`notes` 记检查点，`new_context` 无摘要换窗，`history` 回读旧对话 | ★★★★★ | 本仓库 ① |
| [bg](active/bg/) | 接管 bash：必须写明超时，支持后台任务，超时后可转入后台 | ★★★★★ | 本仓库 ① |
| [pi-then-run](active/pi-then-run/) | 给写文件类工具加 `then_run` 参数，改完文件在同一次调用里跑校验命令 | ★★★★☆ | 本仓库 ① |
| [pi-frame](active/pi-frame/) | 给对话记录加边框，工具输出三档切换，支持回合折叠 | ★★★★☆ | `pi install git:github.com/KorenKrita/pi-frame` |
| [advisor](active/advisor/) | 让执行模型随时向更强的模型征询意见的 advisor 工具 | ★★★★☆ | 本仓库 ① |
| [pi-error-auto](active/pi-error-auto/) | 强制走原生重试，并在后台续跑被中断的回合 | ★★★★☆ | `pi install git:github.com/KorenKrita/pi-error-auto` |
| [pistatusline](active/pistatusline/) | ccstatusline 的 Pi 移植，可自定义的多行底部状态栏 | ★★★★☆ | `pi install git:github.com/KorenKrita/pistatusline` |
| [session-cache-footer](active/session-cache-footer/) | 自定义底栏，并在对话里插入 token、缓存、耗时和成本统计块 | ★★★☆☆ | 本仓库 ① |
| [fullscreen-auto-jump](active/fullscreen-auto-jump/) | 全屏模式下长回答结束后自动跳到回答第一行 | ★★★☆☆ | 本仓库 ① |
| [dev-inspect](active/dev-inspect/) | 调试命令：查看系统提示词、每次调用的 token 用量和上下文构成 | ★★★☆☆ | 本仓库 ① |
| [command-blacklist](active/command-blacklist/) | 从 `/` 命令补全里隐藏不想看到的斜杠命令 | ★★★☆☆ | 本仓库 ① |
| [exclude-tools](active/exclude-tools/) | 让 settings.json 里的 `excludeTools` 真正生效，禁用指定工具 | ★★★☆☆ | 本仓库 ① |
| [00-env](active/00-env/) | 加载扩展时把 `~/.pi/agent/env.json` 注入 `process.env` | ★★★☆☆ | 本仓库 ① |
| [force-gpt-priority](active/force-gpt-priority/) | 给 GPT 模型的请求强制加上 `service_tier: "priority"` | ★★☆☆☆ | 本仓库 ① |

### 已停用（archived/）

已停用插件没有在当前 Pi 版本上重新验证，可能需要适配。

| 插件 | 一句话介绍 | 评分 | 安装 |
| --- | --- | --- | --- |
| [pi-context](archived/pi-context/) | 让 agent 自己存档、折叠并回溯对话上下文（ACM），后被 pi-note-context 取代 | ★★★★☆ | `pi install git:github.com/KorenKrita/pi-context` |
| [pi-best-of-n](archived/pi-best-of-n/) | 多个模型并行生成候选，用 logprob 验证器选出最优结果 | ★★★☆☆ | `pi install git:github.com/KorenKrita/pi-best-of-n` |
| [pi-codex-ws-compaction](archived/pi-codex-ws-compaction/) | 为自定义 Responses provider 提供 Codex 风格的远程压缩 v2 | ★★★☆☆ | `pi install git:github.com/KorenKrita/pi-codex-ws-compaction` |
| [pi-flod](archived/pi-flod/) | 整轮对话折叠、工具调用单行化、思考过程分步摘要，后被 pi-frame 取代 | ★★★☆☆ | 本仓库 ② |
| [pi-distill](archived/pi-distill/) | 用独立模型提炼冗长的工具输出，原文另存到临时文件 | ★★★☆☆ | 本仓库 ② |
| [pi-cheerleader](archived/pi-cheerleader/) | 用廉价模型检测主 agent 是否气馁，并以独立身份注入简短鼓励（源码由会话记录重建） | ★★★☆☆ | 本仓库 ② |
| [pi-patty-bg-tasks](archived/pi-patty-bg-tasks/) | **fork**：仿 Claude Code 的后台任务，后被自写的 bg 取代 | ★★★☆☆ | `pi install git:github.com/KorenKrita/pi-patty-bg-tasks` |
| [magic-acm-context](archived/magic-acm-context/) | Magic Context 与 ACM 合并的上下文管理实验（pi / omp） | ★★☆☆☆ | `pi install git:github.com/KorenKrita/magic-acm-context` |
| [pi-double-paste](archived/pi-double-paste/) | 同一大段文本粘贴两次，把 Pi 的粘贴标记展开成可编辑文本 | ★★☆☆☆ | `pi install git:github.com/KorenKrita/pi-double-paste` |
| [fixed-input](archived/fixed-input/) | 把输入框和页脚固定在终端底部，对话记录独立滚动 | ★★☆☆☆ | 本仓库 ② |
| [powerline-footer](archived/powerline-footer/) | 固定底部输入框，配 powerline 状态栏、聊天滚动和中文 Working Vibes | ★★☆☆☆ | 本仓库 ② |
| [universal-tidy](archived/universal-tidy/) | 把所有工具调用统一渲染成紧凑的两行摘要 | ★★☆☆☆ | 本仓库 ② |
| [retry-all](archived/retry-all/) | 把不可重试的 API 错误改标为可重试，交给 Pi 原生重试，后被 pi-error-auto 取代 | ★★☆☆☆ | 本仓库 ② |
| [token-stats](archived/token-stats/) | 每轮结束后在会话里追加一行 token、TTFT、TPS、缓存和费用统计 | ★★☆☆☆ | 本仓库 ② |
| [force-claude-fast](archived/force-claude-fast/) | 强制所有 Claude 请求使用 AWS Bedrock Priority 服务层级 | ★☆☆☆☆ | 本仓库 ② |
| [crew-lite](archived/crew-lite/) | 员工实验：把 `acm_travel` 交接写成 Memini 索引，并做 fold 提醒和压缩事故记录 | ★☆☆☆☆ | 本仓库 ② |

① `d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/<插件名>`

② `d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/<插件名>`

每个插件 README 的「安装」一节都写好了带具体插件名的完整命令，可以直接复制。

### 未收录

- **项目内嵌扩展**：`pi-staff` 的 employee-memory、receipt-tool、staff-clock、employee-prompt、employee-tools，以及 `crew` 的 crew-tools、lease-guard、vera-guard。它们和所属项目的运行时绑在一起，不能单独使用，所以留在原项目里。
- **skills 包**：[KorenKrita/skills](https://github.com/KorenKrita/skills) 是我维护的 Pi skills 包（`pi install git:github.com/KorenKrita/skills`），不是扩展，这里不展开。
- **pi-frame 的实验变体** v2-rules / v3-rail：只在 [pi-frame README](active/pi-frame/) 里提到，不单独列出。

## 在用的第三方插件

| 插件 | 功能 | 评分 |
| --- | --- | --- |
| [pi-hashline-edit-pro](https://github.com/YuGiMob/pi-hashline-edit-pro) | 基于哈希锚点的 read / replace / insert / grep：每行一个稳定的 4 字符锚点，锚点过期就拒绝，不做模糊匹配；undo 重启后仍保留 | ★★★★★ |
| [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) | MCP 适配器：通过一个网关工具按需搜索、描述和调用 MCP server 的工具 | ★★★★★ |
| [NVlabs/SoL-Pi](https://github.com/NVlabs/SoL-Pi)（`src/sol-pi`） | NVIDIA 的上下文与工具效率扩展：观察结果打包、大输出替换与回读（`obs_recall`）等 | ★★★★☆ |
| [@ff-labs/pi-fff](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff) | 由 FFF 驱动的模糊文件与内容搜索，按 frecency 排序，感知 git 状态 | ★★★★☆ |
| [@ogulcancelik/pi-session-recall](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-session-recall) | 搜索并查询以前的 Pi 会话，按需找回历史对话 | ★★★★☆ |
| [pi-gpt-search](https://www.npmjs.com/package/pi-gpt-search) | 独立于当前模型的联网搜索，底层用 OpenAI Codex 的 standalone search | ★★★★☆ |
| [OpenViking Pi 扩展](https://github.com/volcengine/OpenViking/tree/main/examples/pi-coding-agent-extension)（`extensions/openviking`） | OpenViking 长期记忆：每次提问前自动召回，每轮结束后自动捕获。我在本地打了召回过滤补丁，已提交上游 PR [#5368](https://github.com/volcengine/OpenViking/pull/5368) | ★★★★☆ |
| [herdr](https://github.com/herdrdev/herdr) 集成（`herdr-agent-state.ts`） | 由 herdr 安装和管理的钩子，把 Pi agent 的运行状态上报给 herdr 终端复用器 | ★★★☆☆ |
| [pi-autoname](https://github.com/ssdiwu/pi-autoname) | 用 LLM 给会话自动起有语义的名字 | ★★★☆☆ |
| [pi-multi-skills](https://github.com/QuangThai/pi-multi-skills) | 在提示词任意位置用 `$skill-name` 调用一个或多个 skill，并按原生 skill block 渲染 | ★★★☆☆ |
| [pi-tool-duration](https://github.com/fitchmultz/pi-tool-duration) | 把宿主测得的工具调用耗时告诉模型 | ★★★☆☆ |
| [@giladbarnea/pi-time-sense](https://github.com/giladbarnea/pi-time-sense) | 按可配置的间隔（默认 15 分钟）向 agent 注入当前时间，让长任务有时间感，不破坏缓存 | ★★★☆☆ |

## 目录结构

```text
pi-plugins/
├── README.md          # 本文件
├── active/<插件>/     # 在用插件：源码 + package.json + README，或只有 README（有独立仓库时）
└── archived/<插件>/   # 已停用插件：同上
```

本仓库里的源码是 2026-09-25 从本机 `~/.pi/agent/extensions`、`~/Coding` 下的项目、配置仓库的 Git 历史、`~/.agents/backups` 备份和会话记录中收集的快照。每个插件 README 的「来源」和「历史」写了具体出处。

## 验证记录

2026-09-25，Pi 0.87.1，在隔离的 `PI_CODING_AGENT_DIR` 中：

- 本仓库 21 个带源码的包逐个用 `pi -p -e <目录>` 加载，模型都正常回复，没有加载错误。这只覆盖 print 模式，TUI 交互功能未测。archived 插件只验证了能加载，功能未验证。
- 一行安装命令①②实测可用，重复执行会走 `git pull`；`pi install git:github.com/KorenKrita/{pi-frame,pi-error-auto,pistatusline}` 实测安装成功。
- 自带测试全部通过：command-blacklist 8 个、fullscreen-auto-jump 59 个、pi-note-context 83 个、pi-then-run 23 个。
- 公开前做了密钥和私有地址扫描：crew-lite 里的私有 Memini 地址已换成占位默认值。
