# crew-lite

> 将 acm_travel 交接写成 Memini 索引，并做 fold 提醒与压缩事故记录

**状态**：已停用 · **来源**：KorenKrita 于 2026-08-03 为员工 abei 编写的单雇员记忆实验扩展（线 A，对应 pi-crew `TRACK-A.md` §2），2026-08-10 随该员工退役归档

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/archived/crew-lite
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。已停用插件未在当前 Pi 版本上验证，可能需要适配。

## 功能

crew-lite 是「线 A 单雇员记忆架构」的配套扩展，只在雇员 workspace 中生效（环境变量 `MEMINI_AGENT` 为空时整个扩展不做任何事）。它只做四件事：

1. **最简 UI**：每次 `session_start` 时调用 `ctx.ui.setToolsExpanded(false)`，让工具输出默认折叠，仍可用 `Ctrl+O` 临时展开。
2. **ACM 索引管道**：每当 `acm_travel` 工具成功返回（`isError` 为假），读取其输入中的 `target` 与 `handoff`，生成一行索引写入 Memini：
   - `handoff` 可以是对象，也可以是 JSON 字符串；字符串解析失败时取前 200 字符作为 `goal`。字段为 `goal` / `state` / `next` / `exclusions` / `recover`。`goal` 与 `state` 都为空则跳过。
   - 索引内容先由 LLM 写手生成：使用 `local-openai` provider 的 `gemini-3.5-flash-lite` 模型，提示词要求把交接记录压成一行不超过 80 字的中文索引，写结论与关键标识符（文件名/命令/数字），不写过程。取输出首行，截断到 300 字符。
   - LLM 不可用（注册表中找不到模型、无鉴权、调用出错或输出为空）时回退为机械拼接：`<goal> ⇒ <state 第一句>。next: <next>`，截断到 400 字符。
   - 从 `acm_travel` 结果文本中用正则 `/backup[^'"]*['"]([A-Za-z0-9._-]+)['"]/i` 提取备份标识，写入元数据 `backup`。
3. **fold 提醒**：每次 `turn_end` 计算 budget 压力 `tokens / min(contextWindow, 400000) × 100`。当压力 ≥ 75%，且距上次提醒与距上次成功 `acm_travel` 都已超过 30 分钟时，以 `nextTurn` 方式注入一条提醒（`customType: "crew-lite-nudge"`），建议对刚收尾的段落做一次 fold test：能不看原文写出具体 handoff 就 fold，写不出说明未消化、继续工作。不打断当前工作。
4. **原生 compaction 监控**：Pi 原生 compaction 被视为最后熔断，一旦触发（`session_compact`）就记录为上下文维护事故，并以 `nextTurn` 注入消息（`customType: "crew-lite-compaction-incident"`，含 `reason` 与 `tokensBefore`），提示检查摘要，并从 ACM timeline、session JSONL 与 Memini 恢复可能丢失的关键状态，再记录根因。

## 使用

不注册工具、斜杠命令或快捷键，全部通过事件钩子工作：

| 事件 | 条件 | 行为 |
|---|---|---|
| `session_start` | 始终 | `setToolsExpanded(false)`，工具输出默认折叠 |
| `tool_result` | `toolName === "acm_travel"` 且非错误，且 handoff 含 `goal` 或 `state` | 生成索引行并 POST 到 Memini；失败时写本地回退日志 |
| `turn_end` | budget 压力 ≥ 75%，且提醒冷却与 travel 冷却均已过 30 分钟 | 注入 `crew-lite-nudge` 提醒（`deliverAs: "nextTurn"`） |
| `session_compact` | 始终 | 记事故日志并注入 `crew-lite-compaction-incident` 消息（`deliverAs: "nextTurn"`） |

注入的消息均为 `display: true`。

## 配置

无配置文件，常量写死在 `index.ts` 中；只有以下环境变量：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `MEMINI_AGENT` | `""` | 雇员身份。为空时扩展整体 no-op；同时用作 keychain 账户名 |
| `MEMINI_BASE_URL` | `http://127.0.0.1:8080`（公开版占位值，原为私有部署地址） | Memini 服务地址 |

源码内置常量：

| 常量 | 值 | 说明 |
|---|---|---|
| `KEYCHAIN_SERVICE` | `memini-${MEMINI_AGENT}` | macOS keychain 服务名，Memini 密钥从这里取 |
| `WRITER_PROVIDER` | `local-openai` | 索引写手模型的 provider |
| `WRITER_MODEL_ID` | `gemini-3.5-flash-lite` | 索引写手模型 ID |
| `NUDGE_BUDGET_PCT` | `75` | fold 提醒阈值（%），分母为 `min(contextWindow, 400K)` |
| `NUDGE_COOLDOWN_MS` | `30 * 60 * 1000` | 提醒冷却，同时用作「刚 fold 过不催」的窗口 |
| `STATE_DIR` | `~/.crew-lite` | 本地 JSONL 日志目录 |

`STATE_DIR` 下写入的日志文件（每行带 `ts` 时间戳）：

| 文件 | 内容 |
|---|---|
| `index-log.jsonl` | 每次索引尝试：`ok`、`writer`（`llm`/`mechanical`）、内容前 120 字符 |
| `index-fallback.jsonl` | Memini 写入失败时的完整 payload（静默降级，不回填） |
| `writer-error.jsonl` | LLM 写手错误（找不到模型、无鉴权、调用异常） |
| `nudge-log.jsonl` | 每次 fold 提醒时的压力百分比 |
| `native-compaction-incident.jsonl` | 原生 compaction 的 `reason`、`willRetry`、`fromExtension`、`tokensBefore` |

## 实现要点

- **作用域保险**：扩展入口第一行检查 `MEMINI_AGENT`，为空直接返回，保证只在雇员 workspace 中生效。
- **密钥不落盘**：Memini 密钥不放进环境变量或文件，而是通过 `security find-generic-password -a <agent> -s memini-<agent> -w` 从 macOS keychain 读取。
- **权威 namespace**：写入前调用 `POST /v1/handshake`（上报 cwd basename、cwd 路径、agent 与 `client: crew-lite 0.1`）获取服务端返回的 namespace，并在进程内缓存；拿不到则本次写入视为失败，下次再试。
- **写入格式**：`POST /v1/memories`，带 `X-Memini-Namespace` 头；payload 为 `tier: "semantic"`、`level: "explicit"`、`tags: ["acm-index"]`、`ttl_seconds: -1`，`metadata` 含 `kind`、`writer`、`session`（session 文件路径或 `ephemeral`）、`target`、`backup`、`exclusions`、`folded_at`。响应中 `stored !== false` 视为成功。
- **为何用 semantic**：源码注释记录，`episodic` 会被服务端 `low_signal` 闸拦下（2026-08-03 实测），而索引行本身就是持久检索条目。
- **LLM + 机械双路**：写手通过 `ctx.modelRegistry.find` 与 `getApiKeyAndHeaders` 自动鉴权并调用 `complete`，任何环节失败都回退到机械拼接，保证总能产出索引行。
- **提醒不打断**：fold 提醒与事故消息都用 `deliverAs: "nextTurn"` 投递；刚成功 `acm_travel` 的 30 分钟内不提醒。
- **日志失败无害**：所有 JSONL 写入都吞掉异常，不影响主流程。

## 注意事项

- **强依赖外部环境**：依赖 pi-context 提供的 `acm_*` 工具（具体监听 `acm_travel`）与 Memini 服务，脱离该环境基本不可用。
- **仅 macOS**：密钥读取依赖 macOS `security` 命令；拿不到密钥时所有索引只会进入 `index-fallback.jsonl`。
- **写手模型需预先配置**：需要模型注册表中存在 `local-openai` / `gemini-3.5-flash-lite` 并有可用鉴权，否则始终走机械回退。
- 提醒文案中的「75%」是写死的字符串，修改 `NUDGE_BUDGET_PCT` 不会同步更新文案。
- handshake 中的 `toplevel_basename` / `toplevel_path` 直接取自 `process.cwd()`，并非 git 顶层目录。
- 失败的索引写入只记录到本地，不会自动重试或回填。
- 依赖 `@earendil-works/pi-coding-agent`（peer）与 `@earendil-works/pi-ai/compat` 的 `complete`。

## 历史

- **2026-08-03**：为员工 abei 编写，作为单雇员记忆实验扩展（关联 pi-crew `TRACK-A.md`），原路径 `~/Employees/abei/.pi/extensions/crew-lite.ts`。
- **2026-08-10**：随员工退役归档至本仓库 `archived/crew-lite`，停止维护。
