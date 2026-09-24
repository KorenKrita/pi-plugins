# pi-context

> 让 agent 自主存档、折叠并回溯对话上下文

**状态**：已停用 · **仓库**：https://github.com/KorenKrita/pi-context（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/pi-context
```

已停用插件未在当前 Pi 版本上验证，可能需要适配。最后版本（3.0.0）针对 `@earendil-works/pi-coding-agent` `0.87.1` 开发（依赖精确固定该版本），要求 Node.js `>=22.19.0`。

> 这是 [ttttmr/pi-context](https://github.com/ttttmr/pi-context) 的 fork，只发布在 GitHub；npm 上未带 scope 的 `pi-context` 是上游项目。

## 功能

Agentic Context Management（ACM）：把"何时整理上下文"交给 agent 自己判断，而不只依赖 host 驱动的 compaction。

- **存档（checkpoint）**：给对话树中的位置起语义名，作为之后折叠或回溯的目标。
- **时间线（timeline）**：查看当前上下文、存档点及其折叠收益、搜索整棵会话树（含已折叠历史）、读取单个节点全文、查看分支结构。
- **折叠 / 回溯（travel）**：回到较早节点，把之后的过程替换为一份七行交接单（handoff）；也可 travel 到归档分支取回原文。原始历史始终保留在会话树中。
- **自动回程票**：每次 travel 都给 travel 前的位置记一个存档名，并写入交接单的 `Recover` 行。
- **上下文压力仪表**：在普通工具结果末尾追加一行只报数字的后缀，例如 `[ctx 43% window · 86K/200K · boundary · 3pts · fold@turn→24% -38msg]`。
- **`/tree` 摘要对齐**：手动 `/tree` 选择 "Summarize" 且未提供自定义指令时，注入同样的七行交接单格式。

## 使用

插件不注册斜杠命令或快捷键，只提供三个供 agent 调用的工具（也可直接对 agent 说"存个档""看看时间线""回到刚才那个点"）：

| 工具 | 参数 | 说明 |
|---|---|---|
| `acm_checkpoint` | `name`（必填，`^[A-Za-z0-9._-]+$`，会话内唯一，`root` 保留）、`target`（可选，节点 ID 或已有存档名；省略即标记当前位置） | 创建存档点，不改变上下文 |
| `acm_timeline` | `view`：`active`（默认）/ `checkpoints` / `search` / `node` / `tree`；另有 `verbose`、`filter`、`query`、`scope`（`active`/`archive`）、`type`（`user`/`summary`/`tool`）、`target`、`limit`（默认 50） | 每次调用一个视图；`search` 每次最多遍历 5,000 个节点 |
| `acm_travel` | `target`（存档名、节点 ID 或 `root`）、`handoff`（`goal`/`state`/`next` 必填；`evidence`/`external`/`exclusions`/`recover` 可选）、`backupCurrentHeadAs`（可选，自定义回程票名） | 折叠或回溯；需单独占一个工具批次 |

交接单持久化为固定七行：`Goal:` / `State:` / `Evidence:` / `External:` / `Exclusions:` / `Recover:` / `NEXT:`，缺省的可选字段记为 `none`。

## 配置

无配置文件，仅以下环境变量（按调用时读取）：

| 变量 | 作用 |
|---|---|
| `ACM_GAUGE_DISABLED=1` | 关闭工具结果末尾的上下文压力仪表 |
| `ACM_LEDGER_DISABLED=1` | 关闭本地运行计数 ledger |
| `PI_CODING_AGENT_DIR` | ledger 所在的 agent 目录，默认 `~/.pi/agent` |

Ledger 路径：`<agent 目录>/state/acm-boundary-ledger.jsonl`，上限 8 MiB。

## 实现要点

- `src/index.ts` 为组合根：注册 CORE 提示注入（`before_agent_start`）、三个工具与生命周期钩子（`context`、`tool_result`、`session_before_compact`、`session_before_tree`、`session_tree`、`session_start`、`session_shutdown` 等）。
- travel 以单次事务执行：先写回程票 label，再 `branchWithSummary`，随后校验，失败时补偿回滚；结果分为 `applied` / `not_applied` / `indeterminate` 三态。
- `context` 钩子只做无状态归一化（continuation 投影、孤儿 tool call 修复等）；另注册一个空的 `turn_end` 处理器，以便 travel 后宿主刷新消息数组。
- 存档与回程票的自动锚定优先选择协议完整（protocol-complete）的节点，必要时回退到可重建的已修复节点；找不到合法锚点时 travel 整体中止。
- 压力计算：窗口大于 400K 时以 `min(window, 400K)` 作为 budget 显示 `N% budget(400K)`，否则显示 `N% window`；数据来自宿主 `ctx.getContextUsage()`。
- 模型可见文案统一出自 `guidance/CORE.md` 与 `guidance/TOOL-CONTRACTS.md`，经 `bun run generate:guidance` 生成 `src/generated-guidance.ts`。
- Boundary ledger 通过异步有界队列加 `proper-lockfile` 跨进程锁追加写入，写失败一律静默。

## 注意事项

- 折叠与回溯**只改对话上下文**，不会回滚文件、进程、Git 或任何外部系统；存档点不是文件备份。
- 不取消、不替换 Pi 原生 compaction。
- ledger 默认开启，只记录时间、压力百分比、消息与存档点数量等计数，不含对话正文，不上传。
- 通过 `acm_timeline` 的 `node` 视图读回的归档文本会进入当前上下文；travel 到归档分支会让上下文变大。
- `acm_*` 工具结果与错误结果不附加仪表后缀。

## 历史

- 通过 `pi install git:github.com/KorenKrita/pi-context` 安装使用。
- 后来被 pi-note-context 取代，本插件停用。
