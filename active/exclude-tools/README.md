# exclude-tools

> 让 settings.json 里的 `excludeTools` 真正生效，禁用指定工具

**状态**：在用 · **来源**：KorenKrita 自写，2026-09-11 编写，原为单文件扩展 `~/.pi/agent/extensions/exclude-tools.ts`

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/exclude-tools
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

Pi 核心只从 CLI 参数 `--exclude-tools` 读取要排除的工具列表，`settings.json` 中的 `excludeTools` 键会被忽略。本扩展补上这个缺口：

- 每次会话启动 / reload（`session_start` 事件）时，读取 `~/.pi/agent/settings.json` 的 `excludeTools` 数组；
- 从当前激活的工具列表（`pi.getActiveTools()`）中剔除名单内的工具；
- 仅当确实有工具被剔除时，才调用 `pi.setActiveTools()` 写回新列表。

## 使用

安装后无需操作，只需在 settings.json 中写好 `excludeTools`。

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 事件钩子 | `session_start` | 读取 `excludeTools` 并停用列出的工具 |

不注册工具、斜杠命令或快捷键。

## 配置

配置文件：`~/.pi/agent/settings.json`（路径由 `homedir()` 拼接，写死）

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `excludeTools` | `string[]` | 无（视为空列表） | 要停用的工具名；非字符串元素会被忽略 |

示例：

```json
{
  "excludeTools": ["bash", "write"]
}
```

无环境变量。

## 实现要点

- 每次 `session_start` 都重新读取 settings.json，因此修改后 reload 即可生效，无需重启。
- 读取或 JSON 解析失败、`excludeTools` 不存在或不是数组时，一律静默当作空列表，不报错、不改动工具集。
- 名单为空时直接返回，不触碰工具状态。
- 基于"当前激活工具"做过滤，而不是覆盖为固定列表，因此不会误激活原本未启用的工具。
- 只有过滤前后长度不同才调用 `setActiveTools`，避免无意义的写回。

## 注意事项

- 只读取全局 `~/.pi/agent/settings.json`，不读取项目级设置文件。
- 仅在 `session_start` 时执行一次过滤；会话中途若有其他扩展或操作重新激活了被排除的工具，本扩展不会再次拦截。
- 工具名须与 Pi 中的工具名完全一致（大小写敏感，精确匹配）。
- peer 依赖 `@earendil-works/pi-coding-agent`。

## 历史

- 2026-09-11：编写，最初放在 `~/.pi/agent/extensions/exclude-tools.ts` 作为单文件扩展。
- 之后迁入 pi-plugins 合集的 `active/exclude-tools`，以 `index.ts` + `package.json` 的包形式分发。
