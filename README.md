# dsh-no-workspace

无需选择工作区即可开始一个**只读会话**的 DeepSeek Harness 插件。

- 会话工作目录是 `$DSH_HOME/.dsh-no-workspace/<sessionId>/` 下的**空隔离目录**；
- 工具面**只读且永久锁定**：只有 `read`/`glob`/`grep`（相对路径落在隔离目录内；**绝对路径每次读取需用户审批**）、`web_search`、会话历史、任务与目标工具；没有 Shell、没有写入工具、没有子代理；
- 默认模型 `deepseek-v4-flash` + `reasoningEffort: 'low'`，会话内可随时手动修改；
- 预设从模式选择器中隐藏，只能通过「不使用工作区（只读会话）」菜单项或 `/readonly-session` 命令进入。

## 安装

前置：官方 dsh 已构建（`pnpm install && pnpm run build`）。

```sh
# 1. 构建插件
cd D:\My-DSH-Plugins\dsh-no-workspace
pnpm install && pnpm run build

# 2. 应用发行层补丁（给官方选择器加"菜单项贡献"机制；升级官方包后需重跑）
node patches/apply.mjs apply

# 3. 安装进 profile
dsh plugin --profile web add D:\My-DSH-Plugins\dsh-no-workspace
```

首次启动时插件会把 `presets/no-workspace` 复制到 `$DSH_HOME/.agent-presets/no-workspace/`（幂等，用户编辑过的副本不会被覆盖）。

## 使用

- 打开工作区选择器 → 「不使用工作区（只读会话）」；或输入 `/readonly-session` 命令。
- 会话显示为「只读会话」，出现在未分组/隔离目录下，无法切换到其他预设，无法修改文件。

## 安全模型

| 承诺 | 机制 |
|---|---|
| 工具面不可升级 | 创建时写入零长度 `turn/start`+`turn/end` → 会话永久非 blank → 官方预设切换守卫（`agent-preset-locked`）永久拒绝任何切换 |
| 无写入/无命令 | `no-workspace` 预设只挂只读工具；官方 `tool-fs`（read/write/edit）与 Shell 工具从不挂载 |
| 文件访问受控 | 相对路径 → 隔离空目录；绝对路径 → 每次调用用户审批（fail-closed） |
| 权限旋钮无效果 | 沙箱模式可切换，但没有写工具消费更宽的模式；只读由工具面结构性保证 |
| 模式选择器不混淆 | `agentPresets.list` 装饰过滤隐藏预设（默认 `['no-workspace']`），`resolve`/`mount` 不受影响；卸载插件自动恢复 |

## 兼容性

- 工具/命令/预设/装饰各守各的作用域与数据；不覆盖任何官方组件；
- 唯一触碰共享面的装饰（隐藏预设清单）只删除本插件声明的 id，对其它插件透明，卸载即还原；
- 发行层补丁只改官方构建产物（可 `revert` 精确还原），官方源码零改动。

## 开发

```sh
pnpm install
pnpm run build     # tsc（host）+ tsdown（browser bundle）
pnpm test          # vitest
```

目录：`src/host`（命令/隔离/锁定/隐藏/设置）、`src/client`（菜单项）、`src/tools`（只读工具）、`presets/`、`patches/`（发行层补丁）。
