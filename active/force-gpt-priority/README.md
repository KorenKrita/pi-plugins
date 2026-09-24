# force-gpt-priority

> 给 GPT 模型的请求强制加上 `service_tier: "priority"`

**状态**：在用 · **来源**：KorenKrita 的个人扩展，原位于 `~/.pi/agent/extensions/force-gpt-priority.ts`，现收入 pi-plugins 合集。

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/force-gpt-priority
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

Pi 向模型 provider 发送请求之前，本扩展会检查当前模型：只要模型 id 含有 `gpt`（不区分大小写），就在请求 payload 中写入 `service_tier: "priority"`，让请求使用优先级服务档位。

行为细节：

- **触发时机**：每次 `before_provider_request` 事件，即每次向 provider 发请求之前。
- **匹配规则**：`ctx.model?.id.toLowerCase().includes("gpt")`。只看模型 id，不看 provider；例如 `gpt-5`、`GPT-4o` 这类 id 都会命中。没有当前模型（`ctx.model` 为空）时不做任何处理。
- **payload 要求**：`event.payload` 必须是普通对象（非 `null`、非数组），否则原样放行。
- **覆盖方式**：返回浅拷贝的新 payload，其余字段保持不变；若原 payload 已有 `service_tier`，会被覆盖为 `"priority"`。
- 不匹配的模型不返回任何值，请求保持原样。

## 使用

安装后自动生效，无需手动操作。未注册任何工具、斜杠命令或快捷键。

| 类型 | 名称 | 作用 |
| --- | --- | --- |
| 事件钩子 | `before_provider_request` | 对 id 含 `gpt` 的模型，在 payload 中设置 `service_tier: "priority"` |

## 配置

无配置。档位值硬编码为常量 `PRIORITY_SERVICE_TIER = "priority"`，匹配关键字 `gpt` 也写死在源码中；如需修改，直接编辑 `index.ts`。

## 实现要点

- 单文件扩展（`index.ts`），通过 `package.json` 的 `pi.extensions`（`["./index.ts"]`）注册，入口为默认导出函数 `forceGptPriority(pi)`。
- 只挂一个 `pi.on("before_provider_request", ...)` 钩子，通过返回值替换请求 payload，而不是原地修改 `event.payload`。
- 用 `isObject` 类型守卫排除 `null`、数组和非对象 payload，避免对未知结构的请求体做展开。
- 模型识别采用 id 子串匹配（`includes("gpt")`），实现简单，能覆盖带前缀或大小写不同的 GPT 模型 id，代价是不区分具体 provider。
- 使用对象展开 `{ ...event.payload, service_tier: PRIORITY_SERVICE_TIER }`，只做浅层覆盖，不改动其他字段。

## 注意事项

- 依赖 `@earendil-works/pi-coding-agent`（peerDependency，版本 `*`），使用其 `ExtensionAPI` 类型和 `before_provider_request` 事件。
- 扩展不检查 provider 类型，也不检查该 provider 是否支持 `service_tier` 字段；只要模型 id 含 `gpt` 就会注入。
- 子串匹配可能命中 id 中恰好包含 `gpt` 的非 OpenAI 模型。
- 会无条件覆盖请求中已有的 `service_tier`；若其他扩展也在 `before_provider_request` 中设置该字段，最终结果取决于钩子的执行顺序。

## 历史

- 最初是单文件扩展 `~/.pi/agent/extensions/force-gpt-priority.ts`。
- 后迁入 pi-plugins 合集的 `active/force-gpt-priority`，改为带 `package.json` 的插件包，可用 `pi install` 安装。
