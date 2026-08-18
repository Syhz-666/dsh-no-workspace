# dsh-no-workspace

为 DeepSeek Harness 提供**只读会话**的插件。

- 工作区选择器菜单里有「**不使用工作区（只读会话）**」入口：直接创建无工作区会话（隔离目录）；预设「只读会话」同时可见于模式选择器；
- 会话工具面**只读且永久锁定**：只有 `read`/`glob`/`grep`（隔离目录内相对路径免审批；**其余读取每次调用需用户审批**）、`web_search`、会话历史、任务与目标工具；没有 Shell、没有写入工具、没有子代理；
- 默认模型 `deepseek-v4-flash` + `reasoningEffort: 'low'`，会话内可随时手动修改；
- `/readonly-session` 命令创建「无工作区」会话：工作目录是 `$DSH_HOME/.dsh-no-workspace/<sessionId>/` 下的空隔离目录。

## 安装

前置：官方 dsh 已构建（`pnpm install && pnpm run build`）。

```sh
# 1. 构建插件
cd D:\My-DSH-Plugins\dsh-no-workspace
pnpm install && pnpm run build

# 2. 安装进 profile（追加 dsh-no-workspace bundle 行）
dsh plugin --profile web add D:\My-DSH-Plugins\dsh-no-workspace
```

首次启动时插件会把 `presets/no-workspace` 复制到 `$DSH_HOME/.agent-presets/no-workspace/`（幂等，用户编辑过的副本不会被覆盖）。

## 使用

- 打开工作区选择器 → 「不使用工作区（只读会话）」；或输入 `/readonly-session` 命令；或创建会话后在模式选择器中选择「只读会话」。
- 会话一经选择即被锁定：写入零长度 `turn/start`+`turn/end` 使其永久非 blank，官方预设切换守卫（`agent-preset-locked`）从此拒绝任何预设变更。

## 安全模型

| 承诺 | 机制 |
|---|---|
| 工具面不可升级 | 会话成为 no-workspace 的瞬间（创建时或 blank 期切换时）写入零长度 `turn/start`+`turn/end` → 永久非 blank → 官方预设切换守卫永久拒绝任何切换 |
| 无写入/无命令 | `no-workspace` 预设只挂只读工具；官方 `tool-fs`（read/write/edit）与 Shell 工具从不挂载 |
| 文件访问受控 | 绝对路径 → 每次调用用户审批（fail-closed）；相对路径 → 仅当会话目录位于隔离根（`settings.dsh-no-workspace.isolatedRoot`）之内时免审批，否则同样审批；无会话目录的读取直接拒绝 |
| 权限旋钮无效果 | 沙箱模式可切换，但没有写工具消费更宽的模式；只读由工具面结构性保证 |
| 与官方构建零耦合 | 不修改官方源码、不修改官方构建产物、不装饰任何官方服务；菜单项由精确路由在 serve 时于内存中注入官方 bundle，重新构建/升级官方包后无需任何重放操作 |

## 兼容性

- 工具/命令/预设各守各的作用域与数据；不覆盖任何官方组件；
- 唯一的共享面是用户预设名录（`$DSH_HOME/.agent-presets/no-workspace`），由插件安装、幂等复制；
- 菜单项由 host 端的精确路由在 serve 时注入官方 bundle 内容（内存装饰，可逆，卸载即还原）；官方包重建、升级、`pnpm install` 均不影响本插件。

## 开发

```sh
pnpm install
pnpm run build     # tsc（host）+ tsdown（host + browser bundle）
pnpm test          # vitest
```

目录：`src/`（命令/隔离/锁定/设置/菜单注入）、`src/tools/`（只读工具）、`src/client/`（菜单项）、`presets/`（预设组合）。
