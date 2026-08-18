# dsh-no-workspace 设计记录

> 本文件是功能的完整设计基线：从最初的融合版设计到最终独立插件的让步设计，供后续演进与对比参考。
> 状态：✅ 已实现（本插件内）｜🕓 待验证（集成）｜❌ 放弃（融合版）

## 1. 目标与产品形态

无需选择工作区即可开始一个会话；该会话出于安全被限制为只读：对话、网页搜索、会话历史、任务/目标跟踪；文件读取需逐次用户审批且仅限绝对路径；不能写文件、跑命令、派生子代理。安全边界**不可升级**（工具面结构性锁定）。

## 2. 演进历史

### 2.1 融合版（❌ 已放弃并回滚）

最初实现把功能融进上游核心：`session.create` 的 `cwd: null`、fs 工具的 `readOnly`/`requireReadApproval`、权限服务锁定、GUI 选择器菜单项。全部已回滚。放弃原因：需要改上游核心（用户无上游权限），且"融合"与插件生态共存原则冲突。

### 2.2 发行层 patch 方案（✅ 当前）

零上游源码改动。能力全部落在现有扩展点 + 一个发行层 patch：

| 能力 | 机制 | 扩展点 |
|---|---|---|
| 会话创建 | `/readonly-session` 命令 + 选择器菜单项（client 调官方 RPC） | commands registry、官方 `session.create` RPC |
| 隔离目录 | `$DSH_HOME/.dsh-no-workspace/<sessionId>/`（空）作为 cwd | host 逻辑 |
| 只读工具面 | `no-workspace` 预设只挂插件自实现 `read`/`glob`/`grep` + 官方只读工具 | preset roster、tools registry |
| 工具面锁定 | 创建时写入零长度 `turn/start`+`turn/end` → 永久非 blank → 上游 `agent-preset-locked` 永久禁切预设 | session 日志 append（公开 API）+ 上游既有守卫 |
| 权限种子 | 创建后 `setSandboxMode('read-only')` + `setApprovalPolicy('ask')` | 官方公开函数 |
| 模式隐藏 | 装饰 `agentPresets.list` 过滤隐藏 id（默认 `['no-workspace']`） | service 方法装饰（可逆） |
| 选择器菜单项 | **发行层 patch**：向官方 `dsh-client-ui-workspace` 构建产物注入通用"菜单项注册表" | 构建产物注入（`patches/apply.mjs`，可 revert） |
| 低配默认 | 创建时 `agentOptions` 指定 `deepseek-v4-flash` + `reasoningEffort: 'low'`；会话内可手动改 | 官方模型选择器 |
| 预设分发 | 首次启动把 `presets/no-workspace` 复制到 `$DSH_HOME/.agent-presets/`（幂等） | 用户 preset root（`includeUserRoot`） |

## 3. 安全模型

| 承诺 | 机制 | 强度 |
|---|---|---|
| 工具面不可升级 | 零长度 turn 对 → 非 blank → 上游预设切换守卫永久拒绝 | **结构性**（上游强制） |
| 无写入/无命令 | 预设只挂只读工具；官方 tool-fs 与 Shell 从不挂载 | 结构性（组成固定） |
| 文件访问受控 | 相对路径 → 隔离空目录；绝对路径 → 每次调用审批（fail-closed） | 结构性 + 交互审批 |
| 权限旋钮无效果 | 沙箱模式可切换但无写工具消费；只读由工具面保证 | 显示不一致可接受 |
| 模式选择器不混淆 | 装饰过滤隐藏预设；resolve/mount 不受影响 | 运行时装饰（可逆） |

**放弃的承诺（对比融合版）**：
1. "真·无 cwd" → 空隔离目录（安全等价：目录无用户文件）。
2. 权限锁定 → 不锁定（无写工具，切换无效果；UI 语义差异靠 prompt 节与文档澄清）。
3. 选择器菜单项 → 由发行层 patch 提供（官方产物注入，升级后需重跑）。

## 4. 关键决策与权衡

- **工具面是真正强制**：预设组成 + 上游切换守卫；权限旋钮只是纵深，锁不锁都不影响安全结论。
- **锁定用零长度 turn 对**：上游文档明确支持"无 step 的 turn"；成对写入避免 crash-tail 修复歧义；模型不可见。
- **隐藏用运行时装饰而非配置**：上游 roster 没有"可挂载不可列出"的机制；装饰在服务方法层，卸载精确还原，优于 patch 或覆盖组件。
- **选择器菜单用发行层 patch 而非覆盖组件**：覆盖官方 occupant 破坏共存（加载顺序不定）；patch 注入的是**通用注册表**，官方默认行为不变，任何插件可贡献菜单项。
- **审批门逐次调用**：每次绝对路径读取都走 `ctx.approval.request`，`allowed-once` 才执行；无应答者/拒绝/取消一律失败关闭。
- **预设 trust=user**：随用户安装的插件分发到用户 root，与随发行版的 system 预设区分。

## 5. 验证

- 单测：审批门（无服务/无 agent/拒绝/无应答/允许）、锁定 fold 语义、隐藏装饰（过滤+还原）、创建（cwd/预设/turn 对/权限种子）。
- 集成（待执行）：安装插件 → patch apply → 选择器出现菜单项 → 创建会话 → 工具目录只读 → 绝对路径审批 → 预设切换被拒 → 模式选择器无"只读会话"。
