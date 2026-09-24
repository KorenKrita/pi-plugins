# magic-acm-context

> Magic Context 与 ACM 合体的上下文管理扩展（pi / omp）

**状态**：已停用 · **仓库**：https://github.com/KorenKrita/magic-acm-context（源码与 issue 以该仓库为准）

## 安装

```bash
pi install git:github.com/KorenKrita/magic-acm-context
```

已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

把两套上下文管理系统装进同一个扩展，分工如下：

- **ACM（Active Context Management，主）**：负责结构层面的管理。用 checkpoint 标记会话树节点，再用 travel 把已完成的阶段折叠成一段可恢复的 handoff 摘要（原始路径以分支形式保留在会话树里）。
- **Magic Context（MC，辅）**：负责内容层面的清理。给消息打 `§N§` 标签并按需丢弃；后台 historian 子代理把旧对话压缩成 compartments/facts，以 `<session-history>` 注入；另有跨会话的项目记忆（支持 embedding 语义检索）、定时整理记忆的 dreamer、按需检索记忆的 sidekick（`/ctx-aug`）、自动搜索提示和 note 提醒。
- **统一系统提示**：每轮在 `before_agent_start` 注入一个 `# Magic-Acm-Context` 段，依次是 Foreword（说明两套系统如何并行）、`## Context Management (ACM)`、Magic Context 指引块和 Closing。

## 使用

### 工具

| 工具 | 来源 | 说明 |
|---|---|---|
| `acm_checkpoint` | ACM | 给节点打语义锚点（`name`，可选 `target`），不改变当前上下文；结果中附带上下文用量和可折叠的候选位置 |
| `acm_timeline` | ACM | 查看会话树：默认显示活动路径，可用 `full_tree`、`list_checkpoints` 或 `search` 切换模式（`limit` 取 1–50） |
| `acm_travel` | ACM | 带 `summary`（handoff 摘要）travel 到 checkpoint、节点 ID 或 `root`，可选 `backupCurrentHeadAs` 为被折叠的路径留书签 |
| `ctx_search` | MC | 搜索项目记忆和会话历史 |
| `ctx_memory` | MC | 管理项目记忆（当前项目关闭 memory 时拒绝执行） |
| `ctx_note` | MC | 记下延后处理的事项，在合适的节点提醒 |
| `ctx_expand` | MC | 展开已压缩的历史 |
| `ctx_reduce` | MC | 按标签丢弃指定的消息内容（默认保护最近 `protected_tags` 个标签） |
| `todowrite` | MC | 任务列表（`todowrite.enabled=false` 时不注册） |

### 斜杠命令

| 命令 | 说明 |
|---|---|
| `/context` | 显示上下文用量可视化（来自 pi-context） |
| `/ctx-status` | 显示当前会话的 Magic Context 状态 |
| `/ctx-flush` | 让待执行的 drop 在下一次 provider 调用时生效 |
| `/ctx-recomp` | 从原始会话历史重建 compartments |
| `/ctx-wrapup` | 压缩较早的历史，保留最新若干条消息原样 |
| `/ctx-session-upgrade` | 把会话升级到当前历史格式，并重组项目记忆 |
| `/ctx-dream` | 立即对当前项目运行 dreamer 任务 |
| `/ctx-embed` | 查看 embedding 状态，或用 `start` / `pause` 开始、暂停历史 compartment 的 embedding |
| `/ctx-aug` | 用 sidekick 检索相关项目上下文，补充到下一条提示 |
| `/todos` | 显示当前的 todo 列表（todowrite 启用时才有） |

无快捷键。

## 配置

配置文件使用 JSONC 格式，按以下路径读取（也兼容同名 `.json`），项目级覆盖用户级：

- 项目级：`<cwd>/.cortexkit/magic-context.jsonc`
- 用户级：`~/.config/cortexkit/magic-context.jsonc`（如设置了 `XDG_CONFIG_HOME`，则为 `$XDG_CONFIG_HOME/cortexkit/…`）

如果共享路径不存在，会先尝试迁移旧的 Pi 配置位置，在迁移完成前回退读取旧文件；两处都没有配置时使用 schema 默认值。非法字段会回退到默认值，不会导致插件失效。

常用字段：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 设为 `false` 时插件不注册任何内容 |
| `historian.model` | 无 | 不设置则 historian 触发器不启用 |
| `historian.two_pass` | `false` | historian 完成后再跑一轮编辑 |
| `historian_timeout_ms` | `300000` | |
| `execute_threshold_percentage` | `65` | 可以是数字，也可以是按模型分别设置的对象（上限 80） |
| `protected_tags` | `20` | 1–100 |
| `clear_reasoning_age` | `50` | |
| `history_budget_percentage` | `0.15` | |
| `memory.enabled` | `true` | |
| `memory.injection_budget_tokens` | `4000` | |
| `memory.auto_promote` | `true` | |
| `memory.auto_search` | `{ enabled: true, score_threshold: 0.6, min_prompt_chars: 20 }` | |
| `memory.git_commit_indexing.enabled` | `false` | |
| `embedding` | `{ provider: "off" }` | |
| `dreamer.inject_docs` | `true` | |
| `sidekick` | 未设置 | `/ctx-aug` 需要设置 `sidekick.model`，且 `disable` 不能为 `true` |
| `todowrite` | `{ enabled: true, overlay: true }` | 仅 Pi 使用 |
| `temporal_awareness` | `true` | |
| `smart_drops` | `false` | |
| `caveman_text_compression` | `{ enabled: false, min_chars: 500 }` | |
| `system_prompt_injection.enabled` | `true` | 设为 `false` 时不注入统一提示 |

完整字段见 `packages/plugin/src/config/schema/magic-context.ts`。

## 实现要点

- Pi 入口为 `packages/pi-plugin/src/index.ts`（根 `package.json` 的 `pi.extensions`）。omp 入口为 `packages/omp-plugin/dist/index.js`。MC 核心代码放在 `packages/plugin`，由两个平台共享。
- ACM 部分（`src/acm/tools.ts`）用 `appendLabelChange` 设置 checkpoint 标签，用 `branchWithSummary` 实现 travel。travel 之后在 `context` 事件里按新的叶子节点重建消息，最多重试若干次；同时修复孤立的 tool result。另外在 `before_provider_request` 中把 `acm_*` 工具的 `strict` 设为 `false`。
- `session_before_compact` 触发时，ACM 会先打一个 `pre-compact-<时间戳>` checkpoint，随后 MC 返回 `{ cancel: true }` 取消 Pi 原生压缩，由 MC 的 historian 负责压缩。
- 所有数据存放在共享 SQLite 库 `~/.local/share/cortexkit/magic-context/context.db`，与 OpenCode 版 Magic Context 共用，通过 `harness` 列区分数据来源。
- historian、dreamer、sidekick 都以独立的 `pi --print` 子进程运行，子进程带 `MAGIC_CONTEXT_PI_SUBAGENT=1`，此时完整扩展不会注册。
- 系统提示会做哈希检测并冻结日期，以尽量保持 prompt cache 稳定。
- 根 README 中写明：ACM 以 `omp-context` 为唯一权威实现，本仓库通过 `sync:acm` 脚本同步；MC 上游同步后，用 `scripts/omp-integration.patch` 恢复集成层。

## 注意事项

- travel 只改会话历史，**不会回滚**文件、进程、提交或其他外部副作用。
- 会取消 Pi 原生的自动压缩和溢出恢复压缩，与其他依赖原生 compaction 的扩展可能冲突。
- `packages/pi-plugin/README.md` 沿用上游文案，其中的配置路径（`.pi/...`）以及「Pi 不暴露 `ctx_expand`/`ctx_reduce`」的说法与本仓库源码不一致，以源码为准。
- Pi 侧依赖 `@earendil-works/pi-coding-agent` / `pi-tui` `^0.80.2`；omp 侧锁定 OMP `16.4.5`。
- 依赖 workspace 包 `@magic-context/core`，直接从 git 安装时可能需要自行处理 workspace 依赖。
- 工具、命令和 overlay 只在扩展启动时注册一次。`/cd` 到其他项目后，`todowrite` 相关配置要 `/reload` 才会生效。

## 历史

这是一次组合派生实验：以 Magic Context（cortexkit/magic-context）为上游，加入从 pi-context/omp-context 同步来的 ACM，再自写集成层，同时支持 pi 和 omp。2026-07-12 在合集中登记，07-13 改回使用 pi-context，本插件随即停用。
