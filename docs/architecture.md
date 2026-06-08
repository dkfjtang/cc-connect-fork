# fca 系统架构

## 架构目标

fca 是飞书到本地 Codex 的桥接服务。它不替代 Codex，也不把本机能力直接暴露给飞书，而是在飞书身份、受控工作目录、Codex thread 和审批边界之间建立一层可审计的中介。

## 组件视图

```text
飞书用户
  -> 飞书自建应用
  -> 长连接事件
  -> fca Bridge
       -> Feishu Adapter
       -> Policy Guard
       -> Thread Store
       -> Codex AppServer Client
       -> Message Renderer
  -> codex app-server
  -> 本地工作区
```

## 组件职责

### Feishu Adapter

- 连接飞书长连接。
- 接收 `im.message.receive_v1`。
- 解析 `open_id`、`chat_id`、`message_id` 和文本内容。
- 发送飞书文本回复或任务卡片。
- 更新已发送的任务卡片。

### Policy Guard

- 校验飞书用户白名单。
- 校验工作目录白名单。
- 拦截不支持的消息类型。
- 为后续审批卡片预留策略判断入口。

### Thread Store

- 维护飞书用户和 Codex thread 的映射。
- 第一阶段可使用本地 JSON 或 SQLite。
- 长期建议 SQLite，便于状态查询、恢复和迁移。

### Codex AppServer Client

- 启动并托管 `codex app-server` 子进程。
- 通过 stdio 发送 JSON-RPC 请求。
- 完成 `initialize`、`thread/start`、`thread/resume`、`turn/start`。
- 读取并分发 app-server notification。
- 处理超时、断线和 turn 失败。

### Message Renderer

- 将 Codex 运行状态转成飞书用户能理解的消息。
- 第一阶段优先使用同一张任务卡片承载 queued、running、completed 和 failed 状态。
- 后续支持审批卡片、分段回复和更丰富的卡片组件。

## 数据流

1. 用户在飞书私聊 Bot 发送文本。
2. Feishu Adapter 收到事件并提取消息上下文。
3. Policy Guard 校验用户和工作目录。
4. Thread Store 查找或创建 Codex thread 映射。
5. Codex AppServer Client 向 app-server 发起 turn。
6. Bridge 聚合 Codex 事件。
7. Message Renderer 将最终结果发回飞书。
8. Bridge 写入结构化日志。

## 错误流

- 飞书事件解析失败：记录日志，不回显内部错误。
- 非白名单用户：返回无权限提示。
- app-server 启动失败：返回本地 Codex 不可用提示。
- turn 执行失败：返回可读错误摘要。
- 输出过长：按飞书限制分段或提示查看本地产物。

## 部署形态

MVP 是本机单进程 Bridge + 本机 app-server 子进程。

```text
fca Bridge
  ├─ 飞书长连接
  ├─ 本地状态存储
  └─ codex app-server 子进程
```

不建议第一阶段暴露 app-server WebSocket。若后续启用，只允许 `127.0.0.1` 或受控网络，并启用鉴权。
