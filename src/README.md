# Source

此目录用于放置 `fca` Bridge 服务源码。

建议模块边界：

- `feishu`：飞书长连接、事件解析和消息发送。
- `codex`：`codex app-server` 子进程和 JSON-RPC client。
- `policy`：用户白名单、工作目录白名单和动作策略。
- `store`：飞书用户到 Codex thread 的映射。
- `runtime`：任务状态机、超时和错误处理。

当前已落地：

- `codex/json-rpc-client.js`：JSON-RPC 请求、响应和 notification 分发。
- `codex/json-line-channel.js`：app-server stdio JSONL 读写和分片重组。
- `codex/app-server-session.js`：Codex app-server initialize、thread/start 和 turn/start 封装。
- `codex/turn-output-buffer.js`：Codex delta 输出聚合和卡片摘要截断。
- `config/app-config.js`：从环境变量解析 fca 本地配置，不读取真实凭据文件。
- `policy/access-policy.js`：飞书 `open_id` 和本地工作目录白名单校验。
- `runtime/runtime-task.js`：Codex notification 到 fca task 状态的最小转换。
