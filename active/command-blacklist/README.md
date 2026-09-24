# command-blacklist

> 从 / 命令补全候选中隐藏不想看到的斜杠命令

**状态**：在用 · **来源**：KorenKrita 自写的 Pi 扩展，原位于 `~/.pi/agent/extensions/command-blacklist/`，现收入 pi-plugins 合集

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/command-blacklist
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

Pi 的内置命令、扩展命令、提示词模板和技能多起来以后，输入 `/` 弹出的候选列表会很长。本插件维护一份**斜杠命令黑名单**，把名单里的命令从 `/` 补全候选中去掉。

> 注意：这是 Pi **斜杠命令**的补全过滤，不是 shell 命令黑名单，也不会阻止命令执行。

行为细节：

- **只影响补全候选**：被拉黑的命令只是不出现在补全列表里，手动输完整命令名仍然能执行。
- **只在输入命令名时过滤**：只有光标前的文本以 `/` 开头、且其中没有空格时（即正在补全命令名本身）才会过滤。例如 `/mod` 会过滤；`/model gpt`（在补全参数）和 `hello /mod`（`/` 不在行首）不过滤，原样返回候选。
- **精确匹配**：按候选项的 `value` 精确比较。拉黑 `model` 不会影响 `models`。
- **全部被过滤时**：如果过滤后一个候选都不剩，返回 `null`，即不显示补全列表。
- **管理界面**：执行 `/commandBlacklist` 打开 TUI 界面，列出当前所有可用的 `/` 命令，按来源分组显示，逐条勾选后按 Ctrl+S 保存，立即生效。
  - 分组顺序：`扩展命令 (extension)` → `提示词模板 (prompt)` → `技能命令 (skill)` → `内置命令 (builtin)` → `当前不可用 (unavailable)`。
  - 扩展命令再按所属扩展分小组；取不到扩展名时显示“未知扩展”。
  - 已在黑名单中、但当前已找不到的命令（例如对应扩展被卸载）归入 `当前不可用 (unavailable)`，仍然可以取消勾选并清理掉。
  - `/commandBlacklist` 本身不出现在列表里，免得把管理入口也藏起来。
  - 组内按所属扩展名、再按命令名排序（`localeCompare`）。

触发时机：

- `session_start` 时读取配置并挂上补全过滤器。
- 每次打开 `/commandBlacklist` 时重新读取一次配置。

## 使用

### 斜杠命令

| 命令 | 说明 |
| --- | --- |
| `/commandBlacklist` | 管理 / 命令候选黑名单（仅 TUI 模式；非 TUI 模式会报错“/commandBlacklist 仅支持 TUI 模式”） |

### 管理界面按键

| 按键 | 作用 |
| --- | --- |
| `↑` / `↓` | 上下移动一条 |
| `PgUp` / `PgDn` | 上下移动 10 条 |
| `Enter` | 勾选/取消勾选当前命令（`[x]` 表示已拉黑） |
| `Ctrl+S` | 保存并关闭；保存失败时界面不关，在状态行显示错误 |
| `Esc` / `Ctrl+C` | 放弃修改并关闭 |

勾选只修改草稿，按 Ctrl+S 后才写入配置并生效。保存成功时会提示“已保存 N 条命令黑名单”。

### 事件钩子

| 事件 | 作用 |
| --- | --- |
| `session_start` | 加载配置；通过 `ctx.ui.addAutocompleteProvider` 包装现有的补全提供器，加上过滤逻辑 |

## 配置

配置文件：`<agentDir>/command-blacklist.json`，其中 `<agentDir>` 由 `getAgentDir()` 给出，通常为 `~/.pi/agent`。一般通过 `/commandBlacklist` 编辑，也可以手改。

```json
{
  "version": 1,
  "commands": ["model", "settings"]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 必须是 `1`（`CONFIG_VERSION`） |
| `commands` | string[] | 要隐藏的命令名。每项必须是非空字符串，**不能带开头的 `/`** |

- 文件不存在时相当于黑名单为空（默认值）。
- 加载时会去重并排序；保存时也按同样规则写出（2 空格缩进，末尾带换行）。
- 以下情况会校验失败：根节点不是 JSON 对象、`version` 不对、`commands` 不是数组、某项为空或以 `/` 开头。`session_start` 时校验失败会通知错误并按空黑名单处理；打开 `/commandBlacklist` 时失败则通知错误、不打开界面。
- 手改文件后，要等下一次 `session_start` 或打开 `/commandBlacklist` 才会重新读取。
- 没有环境变量。

## 实现要点

1. **包装而非替换补全提供器**：`addAutocompleteProvider` 拿到当前提供器 `current`，返回的新提供器把 `getSuggestions` 的结果交给 `filterCommandSuggestions` 过滤，`triggerCharacters`、`applyCompletion`、`shouldTriggerFileCompletion` 都原样转发（后者缺失时默认 `true`），不影响文件补全等其他补全行为。
2. **用未过滤的提供器枚举命令**：插件保存被包装前的提供器 `unfilteredProvider`，管理界面用它查询 `["/"]` 拿到完整命令列表，已拉黑的命令也能看到。如果还没初始化，会提示“命令候选提供器尚未初始化，请执行 /reload 后重试”。
3. **来源判定**：命令来源来自 `pi.getCommands()` 的元数据（`extension` / `prompt` / `skill`）；补全里有、元数据里没有的命令归为 `builtin`；配置里有、当前找不到的归为 `unavailable`。
4. **扩展显示名**（`getExtensionDisplayName`，依据 `sourceInfo`）：
   - `npm:` 来源取包名，去掉版本号，保留 scope（如 `@ff-labs/pi-fff`）；
   - `git:` 来源去掉 `github.com/` 前缀和 `@ref`（如 `KorenKrita/pi-context`）；
   - 路径中有 `/extensions/` 的，取其后的相对路径，入口是 `index.*` 时取目录名（如 `fixed-input`），否则保留文件名（如 `dev-inspect.ts`）；
   - 以上都不符合时，入口是 `index.*` 就取父目录名，否则取文件名，都没有再退回 `source`。
5. **原子写入**：先写临时文件 `command-blacklist.json.tmp-<pid>-<时间戳>`（权限 `0600`），再 `rename` 覆盖正式文件；失败时删除临时文件并报错。写入前会自动创建目录。
6. **逻辑与 UI 分离**：纯逻辑放在 `core.ts`（解析配置、过滤、分组排序、扩展名推导），并有 `core.test.ts` 单测（`bun:test`）；`index.ts` 只负责注册命令、钩子和 TUI 视图。
7. **视口滚动**：列表可见行数为 `max(4, 终端行数 - 7)`，并尽量让选中项保持在视口中间；过长的行用 `truncateToWidth` 截断。

## 注意事项

- 依赖 `@earendil-works/pi-coding-agent`（peerDependency）和 `@earendil-works/pi-tui`。
- 管理界面只支持 TUI 模式。
- 只隐藏补全候选，不拦截执行：不能当作权限控制或安全机制使用。
- 管理界面里的命令列表来自本插件包装的那个提供器，看不到在它之后注册的补全提供器额外加入的候选；这些候选也不在本插件的过滤范围内。
- `/commandBlacklist` 不在管理列表里；如果手动把它写进配置，它会从补全中消失，但仍可手动输入执行，之后在界面里保存也会保留这一项。

## 历史

- 最初作为本地扩展放在 `~/.pi/agent/extensions/command-blacklist/`。
- 后来收入 [pi-plugins](https://github.com/KorenKrita/pi-plugins) 合集的 `active/command-blacklist`，改为用 `pi install` 以本地路径安装。
