# 飞书交互模型

## 结论

fca 可以高度复用 OpenClaw 类飞书插件的交互体验，但不应完全复用其 Agent 执行内核。

推荐边界：

```text
高度复用：飞书长连接、消息发送、卡片渲染、卡片更新、footer 展示约定
需要适配：任务状态机、进度聚合、审批卡片、错误展示
必须重写：Codex app-server client、thread/turn 映射、Codex 事件翻译、安全策略
```

原因是飞书侧能力和用户体验可以保持一致，但 Codex 的执行模型是 thread、turn、item、streamed event 和 approval，不等同于 OpenClaw 的任务模型。

## 官方能力基线

第一阶段交互模型依赖以下飞书能力：

- 长连接事件接入：Bridge 通过飞书 SDK 建立 WebSocket 长连接接收事件。
- 发送文本或卡片消息：Bridge 可主动向用户回复任务状态。
- 更新已发送卡片：Bridge 可先发任务卡片，再持续更新同一张卡片。
- 卡片交互回调：审批允许/拒绝/停止通过卡片按钮触发。
- 卡片 JSON 2.0：后续可承载更丰富的布局、状态和流式更新体验。

参考文档：

- 飞书长连接事件订阅：`https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case`
- 飞书消息 API：`https://open.feishu.cn/document/server-docs/im-v1/introduction`
- 更新应用发送的消息卡片：`https://open.feishu.cn/document/server-docs/im-v1/message-card/patch`
- 飞书卡片 JSON 2.0：`https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-structure`

## 用户体验目标

用户在飞书里看到的是一个持续更新的任务卡片，而不是大量零散消息。

最小体验：

1. 用户在私聊发送任务文本，或在群聊中明确 @ Bot 后发送任务文本。
2. fca 立即回复一张任务卡片，状态为“已接收”。
3. Codex turn 启动后，卡片更新为“执行中”。
4. Codex 输出阶段性消息时，卡片摘要区域更新。
5. Codex 完成后，卡片更新为“已完成”，展示最终回复。
6. 失败或超时时，卡片更新为“失败”或“超时”，展示可读原因。

## 卡片状态

### queued

含义：飞书消息已收到，尚未进入 Codex turn。

展示：

- 标题：任务已接收
- 正文：用户输入摘要
- footer：`open_id`、`message_id`、默认工作目录

### running

含义：Codex turn 已启动，正在执行。

展示：

- 标题：Codex 执行中
- 正文：最近一条可展示的 agent 摘要或进度
- footer：`thread_id`、`turn_id`、工作目录、运行时长

### waiting_approval

含义：Codex 需要用户审批。

展示：

- 标题：需要确认
- 正文：Codex approval server request 的脱敏动作摘要、风险等级、风险因素、范围摘要和 approval 短 id
- 操作：查看详情、允许一次、本会话允许、拒绝、停止
- footer：`thread_id`、`turn_id`、approval id

当前阶段已经能把 approval server request 显示为等待审批卡片；“查看详情”会在同一卡片展开更多脱敏摘要，审批按钮会通过 `card.action.trigger` 将选择回写 app-server；无人交互超过 `FCA_APPROVAL_TIMEOUT_SECONDS` 后 app-server 默认收到 `decline`，卡片会 best-effort 更新为已拒绝摘要。

### completed

含义：Codex turn 正常完成。

展示：

- 标题：已完成
- 正文：最终文本回复
- footer：`thread_id`、`turn_id`、耗时、状态

### failed

含义：Bridge、app-server、Codex turn 或飞书回传失败。

展示：

- 标题：执行失败
- 正文：可读错误摘要
- footer：错误类型、`message_id`、可追踪 id

### cancelled

含义：用户取消或系统中断。

展示：

- 标题：已取消
- 正文：取消原因
- footer：`thread_id`、`turn_id`、取消时间

触发：

- 私聊内发送 `取消`、`停止`、`stop`、`abort` 或 `cancel`。
- 群聊内明确 @ Bot 并发送上述取消文本。
- fca 会绕过同 chat 队列，优先将当前 active task 标记为 cancelled。
- 如当前 task 已有 `thread_id` 和 `turn_id`，fca 会调用 Codex app-server `turn/interrupt`。

### 状态刷新

含义：用户希望查看当前任务进度，但不应创建新的 Codex turn。

触发：

- 私聊内发送 `状态`、`查询状态`、`任务状态`、`/status`、`status` 或 `task status`。
- 群聊内明确 @ Bot 并发送上述状态文本。
- fca 会绕过同 chat 队列，优先刷新当前 active task 的同一张任务卡片。
- 如果当前会话没有 active task，Bridge 只返回 skipped，不额外发送包含内部状态的文本消息。

### 工作目录切换

含义：用户希望切换 Codex turn 的工作目录。当前版本只做安全占位，不执行切换。

触发：

- 私聊内发送 `/cwd ...` 或 `cwd ...`。
- 群聊内明确 @ Bot 并发送上述文本。
- fca 会绕过 Codex turn，返回固定暂不支持提示。
- fca 不会回显用户输入路径，也不会读取、切换或创建目录。
- 后续开放真实 `/cwd` 时，必须先经过 `FCA_ALLOWED_WORKDIRS` 白名单校验。

### 会话清理

含义：用户希望清理或重置当前 Codex thread。当前版本只做安全占位，不执行清理。

触发：

- 私聊内发送 `/clear ...`、`clear ...`、`清理会话` 或 `重置会话`。
- 群聊内明确 @ Bot 并发送上述文本。
- fca 会绕过 Codex turn，返回固定暂不支持提示。
- fca 不会删除 thread store、不会中断当前任务，也不会回显用户输入参数。
- 后续开放真实 `/clear` 时，必须加入确认、审计和会话范围校验。

### 权限策略

含义：用户希望修改 Codex 权限策略。当前版本只做安全占位，不修改本地权限边界。

触发：

- 私聊内发送 `/permission ...`、`permission ...` 或 `权限 ...`。
- 群聊内明确 @ Bot 并发送上述文本。
- fca 会绕过 Codex turn，返回固定暂不支持提示。
- fca 不会修改 sandbox、approval policy 或工作目录白名单，也不会回显用户输入参数。
- 后续开放真实 `/permission` 时，必须加入确认、审计和最小权限校验。

## footer 信息规范

footer 只展示排障有用、但不泄露敏感信息的字段。

推荐字段：

- 状态：queued / running / waiting_approval / completed / failed / cancelled
- 工作目录：只显示白名单内路径或项目别名
- Codex thread：短 id
- Codex turn：短 id
- 运行时长
- token/cache/context：收到 `thread/tokenUsage/updated` 后展示总 token、缓存输入 token 和上下文窗口占用比例
- 模型：如已配置可展示
- fca 版本：后续实现后展示

不展示：

- App Secret
- Verification Token
- Encrypt Key
- Codex 凭据
- 完整环境变量
- 未脱敏本机敏感路径
- 大段内部堆栈

## Codex 事件映射

| Codex app-server 事件 | 飞书卡片动作 |
| --- | --- |
| `thread/start` result | 写入 thread 映射，更新 footer |
| `turn/started` | 卡片状态改为 running |
| `item/started` | 更新当前阶段安全标签 |
| `item/agentMessage/delta` | 聚合文本 delta，不逐字更新 |
| `item/completed` | 更新最近完成阶段安全标签 |
| `thread/tokenUsage/updated` | 更新 footer token / cache / context 指标 |
| approval server request | 卡片状态改为 waiting_approval，展示脱敏审批摘要和审批按钮 |
| `turn/completed` success | 卡片状态改为 completed |
| `turn/completed` failure | 卡片状态改为 failed |
| app-server 断开 | 卡片状态改为 failed |

## 更新节流

飞书卡片不应对每个 token 或每个 delta 做更新。

MVP 策略：

- 首次收到消息立即发卡片。
- turn 启动时更新一次。
- agent 文本 delta 聚合到本地缓冲。
- 每 3 到 5 秒最多更新一次运行中摘要。
- 完成或失败时必须更新一次最终状态。
- 卡片发送或更新失败时做有限重试；重试后仍失败则进入 runtime 错误日志和失败链路。

阶段标签只展示 item 类型和安全工具名，不展示命令正文、工具参数、完整路径或原始输出。

这样既能体现持续执行，又避免消息 API 频率和用户体验问题。

## 审批卡片

审批卡片承载：

- 动作类型：命令、写文件、联网、外发文件、切换目录。
- 影响范围：展示脱敏范围摘要，例如目录别名、命令动作类型数量、文件变更数量和扩展名、权限读写数量、网络目标域名。
- 风险等级：按审批类型和网络/权限信号给出中/高。
- 风险因素：展示固定枚举标签，例如命令审批、网络访问、文件变更、删除文件、权限变更、文件写入、网络开启和包含说明。
- 选择项：查看详情、允许一次、本会话允许、拒绝、停止任务。
- 回调上下文：`thread_id`、`turn_id`、approval id。

当前已完成最小闭环：Bridge 可识别 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`applyPatchApproval` 和 `execCommandApproval`，支持审批卡片内展开详情，并把飞书按钮选择回写为 app-server approval response。超时或无人处理时仍默认安全拒绝。

审批结果必须回写 Codex app-server，而不是只更新飞书卡片。
审批按钮操作者必须命中全局 `open_id` 白名单；如果该群配置了 `FCA_GROUP_SENDER_OPEN_IDS`，还必须命中该群 sender allowlist。
审批处理会写结构化日志，包括 requested、resolved 和 timeout 事件，日志只包含脱敏 approval id / item id / decision / risk / risk reasons。
审批正文和日志不得展示命令正文、diff、完整路径、搜索词、reason 原文或 raw payload。

## 与 OpenClaw 能力的复用边界

可以复用：

- 飞书 SDK 接入方式。
- WebSocket 长连接生命周期管理经验。
- 卡片模板结构。
- 持续更新同一张卡片的交互习惯。
- footer 字段风格。
- 错误和完成态视觉语言。

需要改造：

- 任务状态机要从 OpenClaw task 改为 Codex thread / turn。
- 进度来源要从 OpenClaw 事件改为 Codex app-server notification。
- 审批按钮对接 Codex approval server request。
- 任务取消要对接 Codex turn interrupt。

不能复用：

- OpenClaw Agent 执行内核。
- OpenClaw 权限模型。
- OpenClaw 工作目录策略。
- OpenClaw 私有任务 id 作为 fca 权威 id。

## MVP 取舍

MVP 可以先实现：

- 私聊文本触发。
- 群聊内明确 @ Bot 的文本触发。
- 可选配置群 `chat_id` allowlist，限制哪些群可触发 fca。
- 可选配置群内 sender allowlist，限制指定群内哪些成员可触发 fca。
- 可选配置群级 developer instructions，为指定群注入稳定上下文。
- 可选配置群级 JSON 文件，集中维护群 allowlist、sender allowlist 和 developer instructions。
- 首条任务卡片。
- running / completed / failed 三态更新。
- footer 展示 thread、turn、cwd、耗时。
- delta 聚合后低频更新。

当前工程已落地的 SDK 无关部分：

- 私聊文本事件解析。
- 群聊 @ Bot 文本事件解析，并移除 mention key 后交给 Codex。
- 普通群聊和空文本消息跳过。
- 私聊非文本消息返回固定暂不支持提示，不下载附件或读取附件内容。
- 任务卡片 payload 渲染。
- 发送新卡片和更新已有卡片的动作构造。
- 飞书消息 action 到 transport 调用的适配边界。

MVP 暂不实现：

- 文件下载、文件卡片和结果文件回传。
- 复杂 Markdown 渲染。
- 卡片 JSON 2.0 高级组件。
