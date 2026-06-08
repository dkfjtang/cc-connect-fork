# Codex app-server 适配层

## 目标

Codex app-server 适配层负责把 fca 的任务模型翻译成 Codex 的 thread、turn 和 streamed event。

它是 fca 的执行内核边界：

```text
Feishu Adapter
  -> Runtime State Machine
  -> Codex AppServer Adapter
  -> codex app-server stdio
```

飞书侧不直接理解 Codex JSON-RPC；Codex 侧也不直接理解飞书消息。两者通过 fca 的 runtime task 关联。

## 传输方式

MVP 使用默认 `stdio://`：

```text
fca Bridge
  -> spawn("codex", ["app-server"])
  -> stdin JSONL requests
  <- stdout JSONL responses / notifications
```

第一阶段不启用 `ws://IP:PORT`。WebSocket 只作为后续部署形态评估项。

## 连接生命周期

### 启动

1. fca 启动时检查 `FCA_CODEX_BIN`。
2. Bridge 拉起 `codex app-server` 子进程。
3. stdout 按行读取 JSON。
4. stderr 进入 Bridge 日志。
5. 进程退出时标记 app-server unavailable。

### 初始化

连接建立后必须先发送：

```json
{
  "method": "initialize",
  "id": 0,
  "params": {
    "clientInfo": {
      "name": "feishu_codex_bridge",
      "title": "Feishu Codex Bridge",
      "version": "0.1.0"
    }
  }
}
```

收到 initialize 响应后发送：

```json
{
  "method": "initialized",
  "params": {}
}
```

初始化完成前不发送 `thread/start` 或 `turn/start`。

## 核心对象

### Runtime Task

fca 内部任务对象。

字段：

- `task_id`：fca 本地任务 id。
- `feishu_message_id`：飞书消息 id。
- `feishu_open_id`：飞书用户 id。
- `feishu_chat_id`：飞书会话 id。
- `card_message_id`：飞书任务卡片消息 id。
- `thread_id`：Codex thread id。
- `turn_id`：Codex turn id。
- `cwd`：本地工作目录。
- `status`：queued / running / waiting_approval / completed / failed / cancelled。
- `created_at`。
- `updated_at`。

### Thread Mapping

飞书会话到 Codex thread 的映射。

第一阶段建议 key：

```text
私聊：open_id + default_workdir
群聊：chat_id + default_workdir
```

value：

```text
thread_id
last_turn_id
last_seen_at
```

这样同一用户在同一工作目录下的私聊默认复用 thread，同一群在同一工作目录下默认复用另一个 thread。群聊记录保留触发用户 `open_id` 作为审计字段，但不把发送者作为群 thread key，避免同一群被不同成员拆成多个 Codex thread。后续 `/cwd` 或多项目能力再扩展 key。

### Turn Request

fca 将飞书文本转换为 Codex turn input。

最小结构：

```json
{
  "method": "turn/start",
  "id": 2,
  "params": {
    "threadId": "thr_xxx",
    "input": [
      {
        "type": "text",
        "text": "用户在飞书输入的文本"
      }
    ],
    "cwd": "F:\\development\\f-codex"
  }
}
```

是否覆盖 model、sandbox、approval policy 由后续配置决定。MVP 只保留配置入口，不默认放开权限。

群聊可通过 `FCA_GROUP_DEVELOPER_INSTRUCTIONS` 为指定 `chat_id` 配置 Codex developer instructions。Bridge 仅在群聊 turn 中传入 app-server `developer_instructions` 字段；私聊不会继承群级配置。

## JSON-RPC 分发

适配层需要维护请求 id 和 pending map：

```text
request_id -> resolver
```

收到 stdout JSON 行后：

1. 如果包含 `id`，按 response 处理。
2. 如果包含 `method` 且没有 `id`，按 notification 处理。
3. JSON parse 失败，记录协议错误并保留原始摘要。
4. 未识别 notification 不应导致 Bridge 崩溃。

## 事件翻译

| app-server notification | Runtime Task 动作 | 飞书动作 |
| --- | --- | --- |
| `turn/started` | status = running | 更新任务卡片为执行中 |
| `item/started` | 记录当前 item | 可低频更新阶段摘要 |
| `item/agentMessage/delta` | 追加到 output buffer | 节流更新卡片正文摘要 |
| `item/completed` | 记录 item 完成 | 更新最近阶段 |
| approval 类事件 | status = waiting_approval | 后续生成审批卡片 |
| `turn/completed` success | status = completed | 更新最终卡片 |
| `turn/completed` failure | status = failed | 更新失败卡片 |

事件翻译必须是幂等的。重复事件不能导致重复发送大量飞书消息。

## 输出聚合

`item/agentMessage/delta` 不直接逐条发往飞书。

MVP 聚合规则：

- 每个 turn 维护一个 output buffer。
- delta 追加到 buffer。
- running 状态最多每 3 到 5 秒更新一次卡片摘要。
- completed 时以 buffer 的最终内容作为主回复。
- 输出过长时截断卡片正文，并在后续文件回传能力中补完整产物。

## 错误处理

### app-server 启动失败

Runtime Task 状态：

```text
failed
```

飞书展示：

```text
本地 Codex 服务不可用，请检查 codex app-server 是否可启动。
```

### initialize 失败

处理：

- 停止当前 app-server 子进程。
- 标记 adapter unavailable。
- 当前任务失败。

### thread/start 失败

处理：

- 不写入 thread mapping。
- 当前任务失败。
- 飞书卡片展示 thread 创建失败。

### turn/start 失败

处理：

- 保留 thread mapping。
- 当前任务失败。
- 飞书卡片展示 turn 启动失败。

### turn/interrupt

当飞书用户在同一私聊发送 `取消`、`停止`、`stop`、`abort` 或 `cancel` 时，Bridge 会：

1. 查找当前 `chat_id` 的 active task。
2. 将 task 标记为 `cancelled` 并更新飞书卡片。
3. 如果已取得 `thread_id` 和 `turn_id`，调用 app-server `turn/interrupt`。
4. 让原 turn 流程收尾，并再次同步最终 cancelled 卡片。

### turn 超时

处理：

- 标记任务 failed 或 cancelled。
- 对用户主动取消的任务，优先调用 `turn/interrupt` 主动中断。
- 飞书卡片展示超时。

### app-server 运行中断开

处理：

- 所有 running task 标记 failed。
- 飞书卡片更新为本地 Codex 连接中断。
- Bridge 可按策略重启 app-server。

## 权限和审批预留

MVP 不实现完整审批回写，但适配层要保留 approval event 分发口。

后续流程：

```text
Codex approval event
  -> Runtime Task status = waiting_approval
  -> Feishu approval card
  -> user approve / reject
  -> app-server approval response
  -> turn continues or stops
```

审批卡片必须携带足够上下文，但不能暴露完整环境变量、令牌或敏感路径。

## 可测试边界

适配层应能在不连接飞书的情况下测试：

- app-server 子进程能启动。
- initialize 握手成功。
- thread 创建成功。
- turn 启动成功。
- agent delta 能被聚合。
- turn completed 能产生最终输出。
- app-server 退出能转换为 failed。

这些测试后续可由 `scripts/smoke-codex-turn` 覆盖。

## 开放问题

- 是否需要提供 JSON 到 SQLite 的一键迁移脚本。
- 是否每个用户共享一个 app-server 连接，还是每个任务独立连接。
- approval event 的确切方法名需要以后续 schema 生成为准。
- 是否需要在 turn 参数里显式传入 sandbox 和 approval policy。
