# 00-env

> 加载扩展时把 `~/.pi/agent/env.json` 注入 `process.env`

**状态**：在用 · **来源**：KorenKrita 自用的本地自动发现扩展，原位于 `~/.pi/agent/extensions/00-env.ts`，现收录于 pi-plugins 合集

## 安装

```bash
d=~/.pi/agent/pi-plugins; git -C $d pull -q 2>/dev/null || git clone -q https://github.com/KorenKrita/pi-plugins $d; pi install $d/active/00-env
```

该命令把合集仓库克隆到 `~/.pi/agent/pi-plugins`，再以本地路径安装此插件；更新用 `git -C ~/.pi/agent/pi-plugins pull`。

## 功能

一个通用的环境变量注入器，供其他 Pi 扩展 / 包使用。它解决的问题是：有些扩展（源码注释举例 `pi-fff`、`pi-memini`）需要从环境变量读取配置，但不想把这些变量都写进 shell rc。

行为细节：

- **触发时机**：在扩展模块被加载（import）时立即执行，而不是在某个事件或会话钩子里。因此只要它先于其他扩展加载，其他扩展在自己的 import 阶段就能读到这些变量。
- 读取 `~/.pi/agent/env.json`（路径由 `os.homedir()` 拼接），用 `JSON.parse` 解析。
- 遍历顶层键值对，**仅当值为字符串**时才写入 `process.env[键]`；数字、布尔、对象等非字符串值会被忽略。
- **已有的进程环境变量优先**：若 `process.env[键]` 已有值（例如在 shell 中设置过），则不覆盖。判断条件是 `!process.env[k]`，所以值为空字符串的已有变量会被视为未设置而被覆盖。
- 文件不存在或 JSON 无效时静默跳过，不报错、不注入任何内容。

## 使用

无工具、斜杠命令、快捷键或事件钩子。默认导出的扩展函数为空实现（`export default function () {}`），全部逻辑都是模块顶层的副作用。

使用方式就是编辑 `~/.pi/agent/env.json`，然后重启 Pi。

## 配置

配置文件：`~/.pi/agent/env.json`

格式为一个扁平的 JSON 对象，键为环境变量名，值为字符串：

```json
{
  "SOME_API_KEY": "xxx",
  "ANOTHER_VAR": "value"
}
```

- 非字符串值会被忽略。
- 无默认值；文件不存在时什么也不做。
- 本插件自身不读取任何环境变量。

## 实现要点

1. **模块顶层执行**：注入发生在 import 阶段，而非默认导出函数中，确保依赖方在其 import 时就能看到变量。
2. **靠命名控制加载顺序**：命名为 `00-env`，使目录发现时排在同级扩展之前。
3. **依赖加载器顺序**（据源码注释，对应 loader.js）：本地目录 → 全局目录 → 已配置的包，顺序串行加载；因此放在全局扩展目录时，它会早于所有包扩展加载。
4. **shell 优先**：只填补未设置的变量，shell 里显式设置的值总能覆盖文件中的值。
5. **容错**：整个读取/解析过程包在 `try/catch` 中，文件缺失或格式错误都静默忽略。
6. **只接受字符串**：`typeof v === "string"` 过滤，避免把非字符串值写进 `process.env`。

## 注意事项

- **无法注入 Pi 核心在扩展加载前就读取的变量**，例如 `PI_CACHE_RETENTION`、`PI_TELEMETRY`、`PI_CODING_AGENT_DIR` 等；这些仍需写在 shell rc 中。
- 配置文件路径固定为 `homedir()/.pi/agent/env.json`，不跟随 `PI_CODING_AGENT_DIR` 变化。
- **加载顺序**：源码注释中"早于所有包扩展加载"的保证，是以文件位于全局扩展目录（`~/.pi/agent/extensions/`）为前提的。通过 `pi install` 作为包安装后，它与其他包之间的先后取决于包的配置顺序；如果依赖方在 import 阶段就读取变量，需要确认本插件先于它们加载。
- 值为空字符串的已有环境变量会被 `env.json` 中的值覆盖。
- 只依赖 Node 内置模块（`node:fs`、`node:path`、`node:os`）；`peerDependencies` 声明了 `@earendil-works/pi-coding-agent`。

## 历史

- 最初是本地自动发现扩展，单文件位于 `~/.pi/agent/extensions/00-env.ts`。
- 后收录进 pi-plugins 合集（`active/00-env`），改为带 `package.json` 的包形式，可用 `pi install` 安装。
