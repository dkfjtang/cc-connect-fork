# Source

此目录用于放置 `fca` Bridge 服务源码。

建议模块边界：

- `feishu`：飞书长连接、事件解析和消息发送。
- `codex`：`codex app-server` 子进程和 JSON-RPC client。
- `policy`：用户白名单、工作目录白名单和动作策略。
- `store`：飞书用户到 Codex thread 的映射。
- `runtime`：任务状态机、超时和错误处理。
