# dsh-no-workspace 设计记录

> 本文件是功能的完整设计基线：从最初的融合版设计到最终独立插件的让步设计，供后续演进与对比参考。
> 状态：✅ 已实现（本插件内）｜🕓 待验证（集成）｜❌ 放弃（融合版）

## 1. 目标与产品形态

无需选择工作区即可开始一个会话；该会话出于安全被限制为只读：对话、网页搜索、会话历史、任务/目标跟踪；文件读取需逐次用户审批且仅限绝对路径；不能写文件、跑命令、派生子代理。安全边界**不可升级**（工具面结构性锁定）。

## 2. 演进历史

### 2.1 融合版（❌ 已放弃并回滚）

最初实现把功能融进上游核心：`session.create` 的 `cwd: null`、fs 工具的 `readOnly`/`requireReadApproval`、权限服务锁定、GUI 选择器菜单项。全部已回滚。放弃原因：需要改上游核心（用户无上游权限），且"融合"与插件生态共存原则冲突。

### 2.2 发行层 patch 方案（❌ 已放弃）

零上游源码改动，但需要向官方构建产物注入"菜单项注册表"。该方案在用户侧暴露了持久性缺陷：官方包任意重建（`pnpm run build`）都会覆盖注入，菜单项随之消失，且需要重新 apply。放弃。

### 2.3 可见预设方案（✅ 当前）

妥协设计：**不做隐藏、不碰官方构建产物**。`no-workspace` 预设（「只读会话」）直接出现在模式选择器里，用户创建会话后切换即可；`/readonly-session` 命令保留「无工作区」创建路径。

| 能力 | 机制 | 扩展点 |
|---|---|---|
| 会话创建 | `/readonly-session` 命令（隔离目录 cwd）+ 模式选择器切换预设 | commands registry、官方 `agentPreset.select` |
| 隔离目录 | `$DSH_HOME/.dsh-no-workspace/<sessionId>/`（空）作为 cwd | host 逻辑 |
| 只读工具面 | `no-workspace` 预设只挂插件自实现 `read`/`glob`/`grep` + 官方只读工具 | preset roster、tools registry |
| 工具面锁定 | 成为 no-workspace 的瞬间（创建 `session/created` **或** blank 期切换 `agent-preset/selected`）写入零长度 `turn/start`+`turn/end` → 永久非 blank → 上游 `agent-preset-locked` 永久禁切预设 | session 日志 append（公开 API）+ 上游既有守卫 |
| 权限种子 | 锁定同时 `setSandboxMode('read-only')` + `setApprovalPolicy('ask')` | 官方公开函数 |
| 文件访问受控 | 绝对路径 → 每次调用审批；相对路径 → 仅当会话目录位于隔离根内免审批，否则同样审批；无会话目录的相对读取直接拒绝 | settings 命名空间 + 工具执行门 |
| 低配默认 | 命令创建时 `agentOptions` 指定 `deepseek-v4-flash` + `reasoningEffort: 'low'`；会话内可手动改 | 官方模型选择器 |
| 预设分发 | 首次启动把 `presets/no-workspace` 复制到 `$DSH_HOME/.agent-presets/`（幂等） | 用户 preset root（`includeUserRoot`） |

**为何放弃隐藏**：隐藏依赖装饰 `agentPresets.list`，与 patch 方案同理引入共享面；且用户实际使用中「先创建会话、再选只读预设」与「选择器里直接可见」体验差异不大。可见预设让插件退化为纯扩展点使用：无官方文件接触、无服务装饰、无构建产物依赖，官方包重建/升级零影响。

**切换路径的锁定**：上游在 select 提交时发出 `agent-preset/selected`（sessionId, preset）事件；插件监听它，对切到 no-workspace 的会话立即执行与创建路径相同的锁定（幂等）。`lockReadonlySession` 的预设判定改用 `resolveSessionPreset`（读日志、优先最新选择事件），因此 header 非本预设的切换会话同样被锁。

**可见化带来的加固**：预设可见后，用户可能以任意工作区 cwd 创建会话再切换 → 相对路径解析落在用户目录。为此 `read`/`glob`/`grep` 的相对免审批条件收紧为「会话目录位于 `settings.dsh-no-workspace.isolatedRoot` 之内」；其余相对读取（工作区、无目录会话）一律逐次审批，settings 不可读时失败关闭（全部审批）。

## 3. 安全模型

| 承诺 | 机制 | 强度 |
|---|---|---|
| 工具面不可升级 | 零长度 turn 对 → 非 blank → 上游预设切换守卫永久拒绝 | **结构性**（上游强制） |
| 无写入/无命令 | 预设只挂只读工具；官方 tool-fs 与 Shell 从不挂载 | 结构性（组成固定） |
| 文件访问受控 | 绝对路径 → 每次调用审批；相对路径 → 仅隔离根内免审批，其余审批；无目录拒绝 | 结构性 + 交互审批 |
| 权限旋钮无效果 | 沙箱模式可切换但无写工具消费；只读由工具面保证 | 显示不一致可接受 |
| 选择器可见 | 预设正常列出（「只读会话」）；可见性不再依赖任何装饰 | 零共享面 |

**放弃的承诺（对比融合版）**：
1. "真·无 cwd" → 空隔离目录（安全等价：目录无用户文件）。
2. 权限锁定 → 不锁定（无写工具，切换无效果；UI 语义差异靠 prompt 节与文档澄清）。
3. 选择器菜单项 / 预设隐藏 → 放弃；预设直接可见，官方产物零修改。

## 4. 关键决策与权衡

- **工具面是真正强制**：预设组成 + 上游切换守卫；权限旋钮只是纵深，锁不锁都不影响安全结论。
- **锁定用零长度 turn 对**：上游文档明确支持"无 step 的 turn"；成对写入避免 crash-tail 修复歧义；模型不可见。
- **锁定判定读日志而非 header**：`resolveSessionPreset` 优先最新 `agent-preset/selected` 事件——切换会话的 header 仍写创建时预设，读 header 会漏锁。
- **切换锁定监听上游事件**：`agent-preset/selected` 是官方发布的事件（npm 类型缺失时插件本地补声明，签名与上游一致）。
- **审批门逐次调用**：每次受控读取都走 `ctx.approval.request`，`allowed-once` 才执行；无应答者/拒绝/取消一律失败关闭。
- **相对免审批边界用路径前缀 + 分隔符**：`cwd === root` 或 `cwd.startsWith(root + sep)` 才免审批，`root` 的同前缀孪生目录（如 `…-evil`）仍审批。
- **旧会话迁移用官方日志事件**：融合版遗留的 `chat-only` 会话（预设已不存在、无法打开）通过追加 `agent-preset/selected: no-workspace` 事件迁移——`resolveSessionPreset` 优先该事件，header 与历史保持原样；由 `scripts/migrate-legacy-session.mjs` 一次性执行（幂等）。
- **预设 trust=user**：随用户安装的插件分发到用户 root，与随发行版的 system 预设区分。

## 5. 验证

- 单测：审批门（无服务/无 agent/拒绝/无应答/允许）、相对门（隔离内/隔离根/前缀孪生/工作区/无目录/未知根）、锁定 fold 语义与幂等、创建（cwd/预设/turn 对/权限种子）、切换锁定（日志选择优先）、非目标会话不受影响。
- 集成：安装插件 → 模式选择器可见「只读会话」→ 创建会话并切换 → 工具目录只读 → 绝对路径与工作区相对路径审批 → 预设切换被拒 → 旧 `chat-only` 会话迁移后可打开。
