# Source

此目录用于放置 `fca` Bridge 服务源码。

建议模块边界：

- `feishu`：飞书长连接、事件解析和消息发送。
- `codex`：`codex app-server` 子进程和 JSON-RPC client。
- `policy`：用户白名单、工作目录白名单和动作策略。
- `store`：飞书用户到 Codex thread 的映射。
- `runtime`：任务状态机、超时和错误处理。
- `logging`：JSONL 结构化日志输出。

当前已落地：

- `app/create-bridge-app.js`：组装 config、policy、thread store、Codex app-server、飞书消息客户端和事件 handler。
- `cli/dev.js`：本地 dev 启动入口，当前只做凭据检查和 app 装配。
- `codex/json-rpc-client.js`：JSON-RPC 请求、响应和 notification 分发。
- `codex/json-line-channel.js`：app-server stdio JSONL 读写和分片重组。
- `codex/app-server-session.js`：Codex app-server initialize、thread/start、turn/start、turn/interrupt 和 notification 订阅封装。
- `codex/app-server-process.js`：本地 `codex app-server` 子进程启动和 stdio session 绑定。
- `codex/turn-output-buffer.js`：Codex delta 输出聚合和卡片摘要截断。
- `cli/check-codex-app-server.js`：启动本机 Codex app-server 并验证 initialize 完成。
- `cli/check-config.js`：检查飞书凭据、白名单、默认工作目录和基础 runtime 配置。
- `cli/smoke-codex-turn.js`：不依赖飞书的 Codex app-server smoke turn 入口。
- `config/app-config.js`：从环境变量解析 fca 本地配置，不读取真实凭据文件。
- `logging/json-logger.js`：按 `FCA_LOG_LEVEL` 输出 JSONL 结构化日志。
- `feishu/event-handler.js`：处理飞书消息事件并调用 BridgeRuntime。
- `feishu/event-handler.js` 已具备基础 OpenClaw 对齐护栏：app_id 校验、自回声过滤、message_id 去重、过期事件丢弃、按 chat 串行队列和取消快路径。
- `feishu/message-client.js`：将 SDK 无关的飞书消息 action 转换为 transport 调用。
- `feishu/message-event-parser.js`：解析 `im.message.receive_v1` 私聊文本事件。
- `feishu/sdk-transport.js`：使用飞书 Node SDK 发送/更新卡片、探测 bot open_id，并启动长连接消息监听。
- `feishu/task-card-renderer.js`：将 fca task snapshot 渲染为飞书任务卡片 payload。
- `feishu/task-card-actions.js`：构造发送新卡片或更新已有卡片的 SDK 无关动作。
- `feishu/task-card-controller.js`：根据 task 状态同步发送或更新飞书任务卡片。
- `policy/access-policy.js`：飞书 `open_id` 和本地工作目录白名单校验。
- `runtime/runtime-task.js`：Codex notification 到 fca task 状态的最小转换。
- `runtime/bridge-runtime.js`：私聊文本消息到 policy、thread store、Codex session、streamed events 和任务卡片的最小编排，并对运行中卡片更新做节流，支持 active task 取消和结构化任务日志。
- `store/thread-store.js`：飞书用户和工作目录到 Codex thread 的内存/JSON 文件映射。
