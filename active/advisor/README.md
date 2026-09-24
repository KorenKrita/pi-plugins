# advisor

> 让执行模型随时向更强模型征询意见的 advisor 工具

**状态**：在用 · **来源**：KorenKrita 自写，在客户端模拟 Claude Code 的 advisor 工具；executor 侧提示指引改编自 `@juicesharp/rpiv-advisor`（MIT），该指引本身浓缩自 Claude Code 系统提示中的 “# Advisor Tool” 段落

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/advisor
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

Claude Code 的原生服务端 advisor 工具（`advisor_20260301`）在作者使用的 Azure/Foundry 上游不可用，本插件在本地复现它的约定：

- 执行模型（executor）调用无参数的 `advisor()` 工具。
- 插件把 **executor 当前的完整系统提示** 加上 **executor 最近一次实际发给模型的上下文**，转发给一个更强、且没有任何工具的 advisor 模型（默认 `local-claude/claude-fable-5.1`，reasoning effort `high`）。
- advisor 的文字回复作为工具结果返回给 executor。

转发的上下文取自 `context_with_system` 事件，即经过所有 `context` 投影（例如 SoL-Pi 的 observation 打包、note-context 窗口）之后的消息，所以 advisor 看到的正是 executor 看到的内容，而不是原始会话。发出本次 advisor 调用的那条 assistant 消息是在该请求之后生成的，插件会从会话中补上它（去掉其中的工具调用）。

advisor 的系统提示要求它：
- 在 executor 确定方案之前：验证或纠正方案，指出错误假设、误读的需求、遗漏的约束，以及违反 executor 系统提示中用户规则的地方；
- executor 卡住时：依据对话记录中的证据诊断问题，并给出具体下一步；
- executor 认为完成时：对照原始需求和用户规则检查，点出具体缺口（未验证的结论、缺失的测试、跳过的步骤），不凭空制造阻碍；
- executor 的证据与之前的建议冲突时：权衡证据，说明由哪条约束来裁决；
- 必要时明确建议 executor 停下来询问用户；
- 直接、具体，引用对话记录中的文件、函数、命令和工具输出；不写开场白；用用户使用的语言回复。

**触发时机**（写入 executor 的 `promptGuidelines`）：
- 在实质性工作（写入、编辑、确定解读、给出答案）**之前**调用；定位文件、读取资料等探索不算实质性工作；
- 认为任务完成时调用，且调用前先把成果持久化（写文件、保存结果），以防会话中断；
- 卡住时（错误反复、方案不收敛、结果对不上）或考虑换方案时调用；
- 多步长任务至少在确定方案前、宣布完成前各调用一次；由刚读到的工具输出直接决定下一步的短小任务可以不调用；
- 认真对待建议；若某一步实测失败或有一手证据反驳某条具体说法，则调整（自测通过不能证明建议错误）；
- 自己的证据与 advisor 意见冲突时，不要悄悄改变方向，而是再调用一次 `advisor` 说明冲突（“我发现 X，你建议 Y，哪条约束来裁决？”）；
- 每次拿到 advisor 结果后，在下一条对用户可见的回复中复述要点（折叠的工具结果用户常常看不到）。

## 使用

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 工具 | `advisor`（label `Advisor`） | 无参数（`Type.Object({})`）。咨询 advisor 模型并返回其文字建议；`details` 中包含 `model`（`provider/id`）、`usage`、`stopReason`。执行期间通过 `onUpdate` 显示 `Consulting advisor (<model>, <effort>)…` |
| 事件钩子 | `session_start` | 清空缓存的上下文 |
| 事件钩子 | `context_with_system` | 缓存 executor 最近一次发给模型的消息 |

工具会向系统提示注入 `promptSnippet`（“before substantive work, when stuck, and before declaring done”时咨询 advisor）以及上文的 `promptGuidelines`。

## 配置

无配置文件、无环境变量。advisor 模型由 `index.ts` 顶部的常量硬编码，需修改源码调整：

| 常量 | 默认值 | 含义 |
| --- | --- | --- |
| `ADVISOR_PROVIDER` | `"local-claude"` | advisor 模型的 provider |
| `ADVISOR_MODEL` | `"claude-fable-5.1"` | advisor 模型 id |
| `ADVISOR_EFFORT` | `"high"` | 传给 `streamSimple` 的 `reasoning` 等级 |

该模型必须能在 Pi 的模型注册表（`ctx.modelRegistry.find(provider, model)`）中找到。

## 实现要点

- **上下文与 executor 一致**：在 `context_with_system` 中保存消息副本；执行时以其中最大的 `timestamp` 作为截止点，若会话中最后一条 assistant 消息更新，则追加到后面。若尚未捕获到上下文，则回退为 `buildSessionContext` 构建的完整会话。
- **系统提示单独传递**：executor 的系统提示（`ctx.getSystemPrompt()`）包在 `<executor_system_prompt>…</executor_system_prompt>` 中，作为第一条 user 消息发送；advisor 自己的系统提示为 `ADVISOR_SYSTEM_PROMPT`。
- **清理会被 provider 拒绝的结构**（`prepareConversation`）：
  - 去掉会话中途的 `system` 消息——Pi 用它们记录系统提示或工具变更，而 Anthropic 只接受紧挨在 assistant 轮之前的此类消息，重排尾部后会出错；advisor 已另外拿到当前完整系统提示；
  - 去掉最后一条 user 消息之前的 assistant `thinking` 块，与 Anthropic 对 executor 自身的保留策略一致（否则换一个模型会把它们当作普通文本收到），并丢弃因此变空的 assistant 消息；
  - 去掉末尾 assistant 消息中尚无结果的 `toolCall`（包括本次 advisor 调用本身），因为 provider 会拒绝孤立的工具调用；若因此变空则整条删除；
  - 末尾追加一条 user 消息 “The executor has called you at this point. Give your advice now.”，因为 provider 也不接受以 assistant 结尾的请求。
- **advisor 无工具**：请求中 `tools: []`，只能基于对话记录给建议。
- **防自我咨询**：若当前 executor 模型就是 advisor 模型，直接报错并提示不借助 advisor 继续。
- **错误处理**：注册表中找不到模型、调用被取消（`stopReason === "aborted"`）、调用失败（`"error"`，附带 `errorMessage`）、返回内容中没有文本时，均抛出错误；支持通过 `signal` 取消调用。

## 注意事项

- 依赖名为 `local-claude`、模型为 `claude-fable-5.1` 的 provider 已在 Pi 中配置；其他环境需改源码常量。
- 依赖 Pi 的 `context_with_system` 事件以及 `@earendil-works/pi-coding-agent` 中的 `buildSessionContext`、`convertToLlm`；源码还导入 `typebox`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`。`package.json` 只把 `@earendil-works/pi-coding-agent` 声明为 peerDependency（`*`）。
- 与 SoL-Pi 等修改 `context` 的插件配合使用：advisor 收到的是投影后的上下文，与 executor 实际看到的一致。
- 每次调用都会把完整系统提示和上下文发给 advisor 模型，会产生相应的 token 消耗和延迟（指引中因此要求调用前先持久化成果）。

## 历史

- 2026-09：新写，最初放在 `~/.pi/agent/extensions/advisor.ts`，后移入本合集的 `active/advisor`。
