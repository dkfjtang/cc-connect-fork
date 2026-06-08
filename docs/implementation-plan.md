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
- `runDev` 已按 `FCA_LOG_LEVEL` 创建 JSONL logger，并写入 stderr，便于容器或本机进程采集。
- `FeishuMessageClient` 已将飞书 API `code/msg` 和 transport 异常归一为 `FeishuApiError`，结构化日志会记录 `errorName`、`errorCode` 和 `errorActionType`。
- `TaskCardController` 已串行化同一卡片的 send / update，避免运行中 patch 与最终态 patch 并发乱序。
- `TaskCardController` 已对卡片 send / update 做有限重试；超过重试次数后仍向上抛出，交给 runtime 结构化日志记录。
- `FeishuEventHandler` 已通过 JSON 文件 message dedup store 持久化 `message_id` 去重窗口，降低重连或进程重启回放导致的重复执行风险。
- `RuntimeTask` 和任务卡片 footer 已补充 `elapsedMs`、运行时长展示和 `errorType`，便于按卡片直接判断耗时和失败类别。
- `FCA_CODEX_MODEL` 已贯穿到 Codex `thread/start`、任务 snapshot 和卡片 footer；`FCA_VERSION` 已进入配置检查和 footer。
- Thread Store 默认继续使用 JSON 文件，并已支持 `FCA_THREAD_STORE_DRIVER=sqlite` 的可选 SQLite 后端。

## M5 下一阶段评估

当前进展：

- 群聊 @ 机器人已完成最小安全入口：只处理 `chat_type=group`、文本消息、`mentions` 命中当前 bot `open_id` 的事件。
- `FCA_ALLOWED_GROUP_CHAT_IDS` 已提供可选群 `chat_id` allowlist；留空时保持已 @ Bot 群聊入口兼容。
- `FCA_GROUP_SENDER_OPEN_IDS` 已提供可选群内 sender 收紧策略；它只在全局 `open_id` 白名单之上进一步限制指定群。
- `FCA_GROUP_DEVELOPER_INSTRUCTIONS` 已提供可选群级 developer instructions，并通过 Codex app-server `developer_instructions` 传入 turn。
- 普通群聊文本仍跳过；进入 `BridgeRuntime` 后仍使用飞书发送者 `open_id` 白名单作为权限依据。
- 群聊任务继续按 `chat_id` 串行，避免同一群内多个 Codex turn 并发打乱卡片状态。

候选能力：

- 飞书交互卡片审批。
- CardKit 2.0 流式卡片，失败后回退 IM patch。
- 取消/停止任务快路径。
- 运行中进度消息。
- 文件下载和回传。
- 群级配置文件。
- WebSocket 长驻部署模式。

进入条件：

- M3 私聊文本闭环稳定。
- M4 错误治理和日志满足本地排障。
- 安全边界经过复核。
