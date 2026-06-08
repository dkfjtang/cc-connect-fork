# 飞书 Codex 助手项目章程

## 基本信息

| 项目项 | 内容 |
| --- | --- |
| 项目名称 | 飞书 Codex 助手 |
| 英文简称 | fca |
| 仓库名称 | feishu-codex-bridge |
| 内部代码 | f-codex |
| 本地工作区 | F:\development\f-codex |

## 背景

OpenClaw / ClawBot 案例证明了“聊天入口 + 本地 Agent 执行端”的可行性。飞书相较个人微信更适合企业化接入，具备官方 Bot、长连接事件、交互卡片、文件消息和权限体系。

本项目希望用本地 Codex 替代 OpenClaw 执行端，让飞书成为 Codex 的远程任务入口和审批入口。

## 项目目标

构建一个飞书到本地 Codex 的桥接服务，支持用户通过飞书向本地 Codex 派发任务，并通过飞书接收执行结果、审批请求和交付文件。

## 非目标

- 不复制 OpenClaw 的完整平台能力。
- 不做个人微信 Hook、网页版微信协议或非官方微信协议接入。
- 不在第一阶段实现多租户商业化能力。
- 不默认开放 `danger-full-access` 类型的无边界本地执行。

## MVP 范围

1. 飞书企业自建应用配置。
2. 长连接接收 `im.message.receive_v1` 消息事件。
3. Bridge 服务解析私聊文本消息。
4. 通过本地 `codex app-server` 创建或复用 thread，并启动 turn。
5. 将最终结果回复到飞书。
6. 输出基础日志和错误提示。

## 后续能力

- 长会话 thread 管理。
- `/cwd`、`/status`、`/clear`、`/permission` 等控制命令。
- 飞书交互卡片审批。
- 文件、图片、文档下载与回传。
- 群聊 @ 机器人触发。
- 工作目录白名单。
- 任务队列、超时、重试和分片回复。

## 初始技术路线

MVP 主路线采用 `codex app-server`，优先使用默认 `stdio://` 传输，由 fca Bridge 在本机管理 app-server 子进程。

选择 app-server 的原因是本项目需要长期会话、线程管理、流式事件和后续审批能力。`codex exec --json` 仅作为诊断和降级路径保留，不作为主架构。

第一阶段不开放非本机 WebSocket 监听。后续如启用 WebSocket，必须限制在受控网络并配置鉴权。
