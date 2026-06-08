# 飞书 Codex 助手

英文简称: `fca`

仓库名称: `feishu-codex-bridge`

内部代码: `f-codex`

本地工作区: `F:\development\f-codex`

## 项目定位

飞书 Codex 助手是一个本地 Codex 与飞书之间的 Agent Bridge。项目目标是把飞书消息、文件和交互卡片接入本地 Codex，实现远程任务派发、执行过程回传、权限审批和结果交付。

## 核心链路

```text
飞书用户/群聊
  -> 飞书 Bot / 长连接事件
  -> fca Bridge
  -> 本地 codex app-server
  -> 飞书消息/卡片/文件回传
```

## 第一阶段目标

- 支持飞书私聊文本消息触发本地 Codex thread / turn。
- 支持 Codex 最终文本结果回传飞书。
- 建立 `chat_id/open_id` 到本地任务上下文的基础映射。
- 默认只使用受控工作目录。
- 为后续文件、审批和长会话能力预留接口。

## 安全边界

- 默认不开放全盘访问。
- 默认不自动执行高风险命令。
- 群聊默认只响应明确 @ 机器人或白名单命令。
- App ID、App Secret、Codex 凭据等敏感信息不得提交到仓库。
- 写文件、执行命令、联网和外发文件应进入审批链路。

## 技术路线

第一阶段主路线采用 `codex app-server`，Bridge 通过本地 `stdio://` 子进程与 Codex 通信。

`codex exec --json` 仅保留为诊断和降级路径，不作为主架构。实验性 WebSocket 传输后续再评估，MVP 不开放非本机监听。

## 文档索引

- [项目章程](docs/project-charter.md)
- [MVP 推进方案](docs/mvp-plan.md)
- [系统架构](docs/architecture.md)
- [飞书交互模型](docs/feishu-interaction-model.md)
- [Codex app-server 适配层](docs/codex-app-server-adapter.md)
- [实施计划](docs/implementation-plan.md)
- [安全边界](docs/security.md)
- [配置说明](config/README.md)
