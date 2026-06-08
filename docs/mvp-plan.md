# fca MVP 推进方案

## 方案结论

第一阶段采用 `codex app-server` 作为主集成接口。

原因是飞书 Codex 助手不是简单的批处理工具，而是一个长期运行的远程 Agent Bridge。后续核心能力包括飞书用户到 Codex thread 的映射、运行进度回传、权限审批、长任务不中断和历史会话恢复，这些能力与 `codex app-server` 的线程、turn、流式事件和审批模型更匹配。

`codex exec --json` 只保留为诊断和降级路径，不作为主架构。

## 第一阶段目标

跑通一个最小但方向正确的 app-server 闭环：

```text
飞书私聊文本消息
  -> fca Bridge
  -> Codex app-server stdio 连接
  -> thread/start 或 thread/resume
  -> turn/start
  -> streamed agent events
  -> 飞书任务卡片持续更新和最终回复
```

## MVP 范围

- 飞书企业自建应用配置。
- 使用长连接接收 `im.message.receive_v1`。
- 仅支持白名单飞书用户的私聊文本消息。
- 本地启动并管理一个 `codex app-server` 子进程。
- 第一阶段使用 `stdio://` 传输，不开放远程 WebSocket 监听。
- 为每个飞书用户维护基础 thread 映射。
- 将用户消息转成 `turn/start` 输入。
- 读取 app-server 事件流，聚合运行状态和最终回答，并更新飞书任务卡片。
- 记录基础任务日志：飞书 `message_id`、`open_id`、Codex `thread_id`、`turn_id`、工作目录、状态和错误摘要。

## 明确不做

- 不在第一阶段开放群聊通用触发。
- 不开放非本机 WebSocket app-server 监听。
- 不做文件、图片、文档下载和回传。
- 不做交互卡片审批的完整闭环。
- 不做多租户商业化隔离。
- 不默认使用无边界本地执行权限。

## 安全边界

- app-server 默认通过本地 stdio 子进程连接，由 fca Bridge 管理生命周期。
- 工作目录必须来自本地白名单配置。
- 飞书用户必须经过白名单校验。
- App ID、App Secret、Verification Token、Encrypt Key 和 Codex 凭据不得提交到仓库。
- 未来如启用 WebSocket，只允许 `127.0.0.1` 或受控内网，并必须配置鉴权。
- 高风险动作、外发文件、联网访问和跨目录写入进入后续审批卡片链路。

## app-server 集成边界

Bridge 侧需要封装一个 Codex client，负责：

- 启动 `codex app-server`。
- 发送 `initialize` 和 `initialized`。
- 创建或恢复 thread。
- 为每条飞书消息创建 turn。
- 读取 `item/agentMessage/delta`、`item/completed`、`turn/completed` 等事件。
- 将运行状态转成飞书可读消息。
- 在 turn 失败、超时或 app-server 断开时生成可读错误。

第一阶段不直接依赖实验性 WebSocket。WebSocket 可作为后续长驻服务部署形态评估项。

## 验收标准

- 本地能启动 fca Bridge 并拉起 `codex app-server`。
- 白名单用户在飞书私聊发送文本后，能收到 Codex 最终文本回复。
- 同一飞书用户的连续消息能复用同一个 Codex thread。
- app-server 断开、Codex 执行失败或超时时，飞书能收到明确错误提示。
- 本地日志能定位一次请求的飞书消息、Codex thread、Codex turn 和最终状态。
- 仓库包含 `.env.example`，不包含真实凭据。

## 里程碑

### M0 配置和骨架

- 选择 Node.js 或 Python 作为 Bridge 实现语言。
- 补充 `.env.example`。
- 定义工作目录白名单配置。
- 定义本地启动命令。

### M1 飞书事件接入

- 接入飞书长连接。
- 解析私聊文本消息。
- 增加用户白名单校验。
- 对非支持消息返回友好提示。

### M2 Codex app-server client

- 管理 app-server 子进程。
- 实现 JSON-RPC 请求、响应和通知分发。
- 完成 `initialize`、`thread/start`、`turn/start` 最小链路。

### M3 飞书任务卡片回传

- 聚合 Codex 流式事件。
- 创建任务卡片。
- 将 running / completed / failed 状态更新到同一张卡片。
- 将最终文本结果写入卡片正文。
- 对长输出做分段策略预留。

### M4 状态和错误治理

- 增加任务状态机。
- 增加超时、重试和 app-server 断线处理。
- 输出结构化日志。

### M5 后续能力评估

- 评估飞书交互卡片审批。
- 评估文件下载与回传。
- 评估群聊 @ 机器人。
- 评估 WebSocket 或长驻 app-server 部署模式。

## 待确认事项

- Bridge 实现语言：Node.js 更贴近 app-server quickstart 和飞书 SDK 生态；Python 更利于后续脚本化和本机运维。
- thread 映射存储：第一阶段可用本地 JSON 或 SQLite，长期建议 SQLite。
- 运行目录策略：是否只允许 `F:\development` 下白名单项目。
- 飞书消息更新策略：第一阶段采用任务卡片，并至少支持 running / completed / failed 三态更新。
