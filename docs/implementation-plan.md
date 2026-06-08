# fca 实施计划

## 当前决策

- 主集成接口：`codex app-server`。
- MVP 传输方式：`stdio://`。
- 飞书入口：企业自建应用长连接。
- 首批消息类型：私聊文本，以及明确 @ Bot 的群聊文本。
- 首批权限模型：白名单用户 + 白名单工作目录。
- 飞书侧体验基线：对齐 OpenClaw 官方飞书插件源码和功能，但不 fork、不引入其运行时。
- 飞书侧新增能力规则：先补 OpenClaw 源码行为对齐记录，再实现 fca 的 Codex app-server 映射和测试。

## M0 文档和配置骨架

交付物：

- `README.md` 文档索引。
- `docs/project-charter.md` 项目章程。
- `docs/mvp-plan.md` MVP 方案。
- `docs/architecture.md` 架构说明。
- `docs/feishu-interaction-model.md` 飞书交互模型。
- `docs/codex-app-server-adapter.md` Codex app-server 适配层。
- `docs/security.md` 安全边界。
- `config/.env.example` 配置模板。

Done 标准：

- 仓库不包含真实凭据。
- 文档明确 app-server 主路线。
- 文档明确第一阶段不开放 WebSocket。
- 文档明确飞书卡片持续更新和 footer 复用边界。

## M1 Bridge 工程骨架

交付物：

- 选择运行时和包管理器。
- 建立 `src` 下模块边界。
- 提供本地启动命令。
- 提供基础日志输出。
- 提供 app factory，统一装配 config、policy、thread store、Codex app-server 和飞书 event handler。

建议模块：

- `feishu`：飞书长连接和消息发送。
- `codex`：app-server JSON-RPC client。
- `policy`：用户、目录和动作策略。
- `store`：thread 映射和任务状态。
- `runtime`：任务状态机和超时控制。

Done 标准：

- 本地进程可启动。
- 缺失配置时能给出明确错误。
- 不需要真实飞书事件也能跑基础自检。
- 事件 handler 具备 OpenClaw 对齐的基础入站护栏：app_id 校验、自回声过滤、message_id 去重和过期事件丢弃。

## M2 Codex app-server 最小链路

交付物：

- 启动 `codex app-server` 子进程。
- 发送 `initialize` 和 `initialized`。
- 创建 thread。
- 发起 turn。
- 聚合最终文本输出。
- 将 app-server notification 翻译为 runtime task 状态。

Done 标准：

- 可通过本地测试脚本向 Codex 发起一次请求。
- 能记录 `thread_id`、`turn_id` 和最终状态。
- app-server 异常退出时 Bridge 不崩溃。

## M3 飞书私聊闭环

交付物：

- 接入飞书长连接。
- 查询 bot open_id 并注入事件处理器，启用自回声过滤。
- 解析私聊文本消息。
- 白名单用户校验。
- 按 chat / thread 串行处理同一会话内任务。
- 调用 Codex turn。
- 创建任务卡片。
- 将 running / completed / failed 状态更新到同一张卡片。
- 回传最终文本到卡片正文。
- 对 Codex delta 做节流 flush，避免逐 token 更新飞书卡片。

Done 标准：

- 白名单用户可从飞书收到 Codex 回复。
- 非白名单用户收到无权限提示。
- 非文本消息收到暂不支持提示。
- 同一任务优先更新同一张飞书卡片，而不是刷屏式发送多条消息。
- 同一 `chat_id` 的消息串行进入 Codex turn。
- Thread 映射按会话维度隔离：私聊使用 `open_id + cwd`，群聊使用 `chat_id + cwd`。
- Codex delta 运行中更新经过节流，不逐 token patch 飞书卡片。
- 私聊文件、图片、文档或语音消息会收到固定暂不支持提示；Bridge 不下载附件、不读取文件名或 file_key，并按 `message_id` 去重。
- 文件输入能力已有显式配置门禁 `FCA_FEISHU_FILE_INPUTS_ENABLED`，默认关闭；当前即使开启也不下载附件，后续实现下载时必须先接入该门禁、审批和审计。

## M4 稳定性和可观测性

交付物：

- 任务状态机。
- 超时控制。
- 错误摘要。
- 结构化日志。
- 基础本地验证脚本。

Done 标准：

- app-server 启动失败、turn 失败、飞书发送失败都有明确日志。
- 长输出不会导致 Bridge 无响应。
- 可按 `message_id` 或 `turn_id` 定位一次任务。

当前进展：

- `BridgeRuntime` 已输出 `task.received`、`task.thread_created` / `task.thread_reused`、`task.turn_started`、`task.completed` / `task.failed` / `task.cancelled` 等结构化事件。
- `runDev` 已按 `FCA_LOG_LEVEL` 创建 JSONL logger，并写入 stderr，便于容器或本机进程采集；同一个 logger 已贯穿飞书 SDK transport 和 runtime。
- `FeishuSdkTransport` 已记录 WebSocket 启动阶段、事件收到和 handler 失败日志，字段不包含 app secret、消息正文或完整事件 payload。
- `FCA_FEISHU_WS_AUTO_RECONNECT` 已支持控制飞书 SDK `WSClient` 自动重连，默认 `true`；SDK reconnecting / reconnected / error callback 会进入脱敏 JSONL 日志。
- `FeishuSdkTransport.getMessageListenerStatus()` 和 `createBridgeApp().getDiagnostics()` 已提供长连接与运行态脱敏状态快照；`runDev` 启动监听后会写入 `bridge.diagnostics` 脱敏 JSONL 日志，便于后续 `/status` 或运维探针复用。
- `FeishuEventHandler` 已记录 `feishu.message_handled` / `feishu.message_skipped` gate 结果和处理耗时，字段只包含 message/chat 维度、result status、duration、task status 或跳过原因，不记录消息正文、附件 key、文件名或完整 payload。
- `FeishuMessageClient` 已将飞书 API `code/msg` 和 transport 异常归一为 `FeishuApiError`，结构化日志会记录 `errorName`、`errorCode` 和 `errorActionType`。
- `TaskCardController` 已串行化同一卡片的 send / update，避免运行中 patch 与最终态 patch 并发乱序。
- `TaskCardController` 已对卡片 send / update 做有限重试和错误分类退避：限频错误指数退避，非重试业务错误快速失败；超过重试次数后仍向上抛出，交给 runtime 结构化日志记录。
- `TaskCardRenderer` 已对卡片正文和 footer 字段做尺寸收敛，避免超长输出、模型名、版本号或路径撑爆飞书卡片 payload。
- `FeishuEventHandler` 已通过 JSON 文件 message dedup store 持久化 `message_id` 去重窗口，降低重连或进程重启回放导致的重复执行风险。
- `RuntimeTask` 和任务卡片 footer 已补充 `elapsedMs`、运行时长展示和 `errorType`，便于按卡片直接判断耗时和失败类别。
- `FCA_CODEX_MODEL` 已贯穿到 Codex `thread/start`、任务 snapshot 和卡片 footer；`FCA_VERSION` 已进入配置检查和 footer。
- `thread/tokenUsage/updated` 已进入 RuntimeTask snapshot，并在任务卡片 footer 展示 token / cache / context 指标。
- `FCA_CARD_FOOTER_FIELDS` 已支持可选 footer 字段配置，默认保留 status/thread/turn/elapsed/tokens/model/version/error/cwd，配置检查会输出当前字段列表。
- `FCA_CARD_CHANNEL` 已支持 `im` / `cardkit` 配置；默认 `im`，显式 `cardkit` 时 SDK transport 会创建 CardKit 卡片实例并发送 `card_id` 消息，running 正文更新优先走 `fca_body` element content 局部更新和打字机效果，非 running 状态保留 full update 以同步 header / footer / 按钮；失败或不可用时记录 `feishu.cardkit_fallback` 并回退普通 IM 卡片，保留 card channel / card id / sequence 元数据流转且不记录卡片 payload。
- `item/started` / `item/completed` 已进入 RuntimeTask snapshot，并在运行中卡片正文展示安全阶段标签。
- app-server JSON-RPC server request 已进入分发层；approval request 会把任务切到 `waiting_approval`、更新脱敏卡片，并通过飞书按钮回写 app-server decision；无人处理超时后默认回写 `decline`。
- 审批卡片已支持“查看详情”按钮，在同一卡片展开更多脱敏摘要，不展示命令正文、diff、完整路径或原始 payload。
- app-server 子进程退出已转换为 `appServer/disconnected` 本地事件；runtime 会把 active task 标记为 failed，失败卡片先同步一次，再进入最终同步和 `task.failed` 日志。
- `runDev` 已注册 `SIGINT` / `SIGTERM` 停机钩子，收到退出信号后记录 `bridge.shutdown_requested`，依次停止 Codex app-server 和飞书 transport；成功时记录 `bridge.stopped`，失败时记录 `bridge.shutdown_failed` 和 `failedResources`，且任一资源停止失败都不会阻止继续尝试停止其它资源。
- `FCA_APPROVAL_TIMEOUT_SECONDS` 已提供审批请求等待时间配置；超时后会记录 `task.approval_timeout` 并 best-effort 同步卡片。
- 审批卡片已展示风险等级、固定枚举风险因素和脱敏范围摘要，包括目录别名、命令动作类型数量、文件变更数量和扩展名、权限读写数量、网络目标域名。
- Thread Store 默认继续使用 JSON 文件，并已支持 `FCA_THREAD_STORE_DRIVER=sqlite` 的可选 SQLite 后端。
- `npm run migrate:thread-store` 已提供 JSON thread store 到 SQLite 的 dry-run 和迁移能力。
- 飞书 `状态` / `/status` 控制命令已走 active task 快路径，绕过同会话队列刷新当前任务卡片，不新建 Codex turn。
- 飞书 `/cwd` / `cwd` 控制命令已先接入安全占位：不启动 Codex turn、不切换目录、不回显用户输入路径，只返回固定暂不支持提示；后续真实切换必须接 `FCA_ALLOWED_WORKDIRS` 白名单。
- 飞书 `/clear` / `clear` / `清理会话` / `重置会话` 控制命令已先接入安全占位：不启动 Codex turn、不删除 thread store、不回显用户输入参数，只返回固定暂不支持提示；后续真实清理必须加入确认、审计和会话范围校验。
- 飞书 `/permission` / `permission` / `权限` 控制命令已先接入安全占位：不启动 Codex turn、不修改 sandbox / approval policy / 工作目录白名单、不回显用户输入参数，只返回固定暂不支持提示；后续真实修改必须加入确认、审计和最小权限校验。

## M5 下一阶段评估

当前进展：

- 群聊 @ 机器人已完成最小安全入口：只处理 `chat_type=group`、文本消息、`mentions` 命中当前 bot `open_id` 的事件。
- `FCA_ALLOWED_GROUP_CHAT_IDS` 已提供可选群 `chat_id` allowlist；留空时保持已 @ Bot 群聊入口兼容。
- `FCA_GROUP_SENDER_OPEN_IDS` 已提供可选群内 sender 收紧策略；它只在全局 `open_id` 白名单之上进一步限制指定群，并已覆盖文本触发和审批按钮操作者。
- `FCA_GROUP_DEVELOPER_INSTRUCTIONS` 已提供可选群级 developer instructions，并通过 Codex app-server `developer_instructions` 传入 turn。
- `FCA_GROUP_CONFIG_PATH` 已提供可选群级 JSON 配置文件，可集中维护群 `chat_id` allowlist、群内 sender 收紧策略和群级 developer instructions。
- 普通群聊文本仍跳过；进入 `BridgeRuntime` 后仍使用飞书发送者 `open_id` 白名单作为权限依据。
- 群聊任务继续按 `chat_id` 串行，避免同一群内多个 Codex turn 并发打乱卡片状态。
- 私聊非文本消息已具备安全提示前置闭环，为后续文件下载和回传能力保留清晰边界。
- `FCA_FEISHU_FILE_INPUTS_ENABLED` 已进入配置检查和 diagnostics，只暴露布尔开关状态，不暴露附件 key、文件名、路径或内容。
- 非文本消息已先进入脱敏 envelope：只保留 `message_id`、`chat_id`、`chat_type`、`message_type` 和 `attachmentKind` 枚举，不解析附件 `content`。
- 附件输入策略已独立为决策函数，当前只产出 `skip` / `notify_disabled` / `notify_unsupported` / `eligible`，`eligible` 仍被事件层固定提示拦截，不触发下载。
- 长驻进程已具备基础退出治理：本机开发入口收到 `SIGINT` / `SIGTERM` 后会 best-effort 停止 app-server 子进程和飞书 transport，降低长任务或 WS listener 残留风险；飞书长连接默认依赖 SDK 自动重连，重连阶段会输出结构化日志。

候选能力：

- CardKit 2.0 流式卡片，失败后回退 IM patch。
- 文件下载和回传。
- WebSocket 长驻部署模式。

进入条件：

- M3 私聊文本闭环稳定。
- M4 错误治理和日志满足本地排障。
- 安全边界经过复核。
