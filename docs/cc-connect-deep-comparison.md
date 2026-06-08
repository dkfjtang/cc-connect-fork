# CC-Connect 源码深度对比

## 审计对象

| 项目 | 内容 |
| --- | --- |
| 仓库 | `https://github.com/chenhg5/cc-connect` |
| 只读审计版本 | `5e2f3b9ebab125bc09c99b8b2dc2cd8526c709ba` |
| 本地临时路径 | `C:\Users\Administrator\AppData\Local\Temp\cc-connect-audit\cc-connect` |
| 审计日期 | 2026-06-09 |

本文只记录源码行为和项目裁决，不复制 cc-connect 源码。

## 结论

cc-connect 与 fca 的重叠度很高，已经不是“只覆盖微信/飞书入口、Codex 仍需 fca 自研”的关系。源码显示 cc-connect 已经具备：

- 飞书 WebSocket 长连接、共享连接、事件分发和交互卡片回调。
- Codex agent，并且同时支持 `codex exec --json` 和 `codex app-server` 后端。
- `codex app-server` stdio JSON-RPC、thread start / resume、turn start、notification 分发。
- Codex app-server approval server request 映射，包括命令执行、文件变更、权限请求、用户输入请求和动态工具调用。
- 飞书持续卡片更新、Card 2.0 rich card、footer、token/context usage、工具/思考折叠面板和 payload 尺寸收敛。
- 多平台、多项目、多 workspace、命令体系、provider 切换、daemon 和会话管理。

因此，fca 后续不应继续按“自研完整飞书 Codex Bridge”推进。下一步应先做 cc-connect 实机验证和差异清单，判断是否：

1. 直接采用 cc-connect 作为主方案；
2. 给 cc-connect 上游贡献缺口；
3. 仅保留 fca 作为极小的 Codex app-server 安全策略/飞书 UX 实验分支。

在完成这个验证前，fca 暂停新增通用飞书通道能力。

## 源码证据摘要

### Codex 后端

cc-connect 的 `agent/codex/codex.go` 注册 `codex` agent，配置项包含 `backend`、`app_server_url`、`codex_home`、`cli_path`、provider、model 和 reasoning effort。`normalizeBackend()` 将 `app-server`、`app_server`、`appserver`、`ws` 归一到 `app_server`，默认仍是 `exec`。

`Agent.StartSession()` 中如果 `backend == "app_server"`，会调用 `newAppServerSession(...)`；否则调用 `newCodexSession(...)` 走 `codex exec --json`。

这说明 cc-connect 已经覆盖 fca 选择 `codex app-server` 的核心方向，不是只有 `codex exec` 降级路径。

### Codex app-server 会话

cc-connect 的 `agent/codex/appserver_session.go` 通过 `codex app-server` 子进程和 stdio 建立 JSON-RPC 会话。关键行为包括：

- `initialize` / `initialized`。
- `thread/start` 和 `thread/resume`。
- `turn/start`，输入支持文本和本地图片。
- `approvalPolicy` 和 sandbox 按模式映射：suggest 为 `on-request + read-only`，auto/full-auto 为 `never + workspace-write`，yolo 为 `never + danger-full-access`。
- `account/rateLimits/read`、`account/rateLimits/updated` 和 `thread/tokenUsage/updated` 映射为 usage/context footer 数据。
- `turn/started`、`item/started`、`item/completed`、`turn/completed`、`thread/status/changed` 转为统一事件。
- app-server 发起的 server request 可回写 JSON-RPC response。

它还覆盖了 fca 当前仍较薄的能力：`item/tool/requestUserInput`、`item/tool/call`、动态工具调用、rate limit 多 bucket 展示。

### 审批请求

cc-connect 的 app-server session 处理以下 server request：

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`
- `item/tool/call`

命令和文件变更审批会转成 `core.EventPermissionRequest`，等待平台侧按钮结果；超时或上下文取消默认拒绝。权限请求允许时返回 `permissions + scope=turn`，拒绝时返回空 permissions。用户输入请求会转成问题和选项，再按用户选择回写 Codex app-server。

fca 当前已实现命令、文件变更、权限请求的最小审批闭环，但还没有等价覆盖用户输入请求和动态工具请求。

### 飞书平台

cc-connect 的 `platform/feishu/feishu.go` 使用飞书 Go SDK，覆盖：

- WebSocket 模式和 webhook 模式。
- app_id 相同的多个项目共享同一条 WebSocket，并 fan-out 给各平台实例，避免飞书服务端负载均衡导致消息随机进入不同连接。
- `im.message.receive_v1`、消息撤回、已读、bot 菜单、card action 等事件。
- allow_from、allow_chat、group_only、group_reply_all、thread_isolation、resolve_mentions、peer bots 等策略。
- 私聊/群聊、thread isolation、附件上下文和卡片 action sessionKey。
- 对 SDK 日志里的敏感 URL 参数做脱敏。

这比 fca 当前 `FeishuSdkTransport` 的单应用、单连接、最小事件注册更成熟。

### 飞书卡片

cc-connect 的 `platform/feishu/card.go` 和 rich card 相关代码覆盖：

- 普通 interactive card 的 reply / send / refresh。
- card action 后按 sessionKey 追踪 message_id，并用 Patch API 原地刷新。
- Card 2.0 rich card：状态色 header、streaming_mode、update_multi、主 markdown element_id、Reasoning / Tools 折叠面板、footer 多行 notation。
- markdown 表格、图片、URL、代码块和 payload 尺寸保护。
- 卡片过大时压缩工具步骤，再退回 compact markdown。

fca 当前有普通 IM patch、可选 CardKit create/update、正文 element content 局部更新、footer 字段配置和审批按钮，但 rich card 的信息密度、工具面板和 Markdown 兼容治理明显弱于 cc-connect。

### Core Engine

cc-connect 的 `core/engine.go` 是完整桥接内核，覆盖：

- 平台消息到 agent session 的路由。
- session manager、interactive state、pending permission、消息队列和过期消息水位。
- `/new`、`/list`、`/switch`、`/history`、`/mode`、`/provider`、`/status`、`/restart`、`/web` 等命令族。
- provider、model、reasoning effort、skills、commands、hooks、cron、heartbeat、workspace binding。
- reply footer usage 缓存、context 指示、长任务观察和自动压缩。

fca 当前只覆盖飞书到单个 Codex app-server 的最小运行时，不具备 cc-connect 的通用控制平面。

## 对比表

| 维度 | cc-connect 源码状态 | fca 当前状态 | 裁决 |
| --- | --- | --- | --- |
| Codex app-server | 已支持 stdio app-server，覆盖 thread/turn/approval/usage/context | 已支持 stdio app-server 最小链路和 approval | 高度重叠，cc-connect 更完整 |
| `codex exec --json` | 已支持 exec 和 resume | 仅作为诊断/降级规划 | cc-connect 覆盖更广 |
| 飞书 WebSocket | SDK WebSocket、共享连接、webhook fallback、脱敏日志 | SDK WebSocket、自动重连、最小状态诊断 | cc-connect 更成熟 |
| 交互卡片 | 普通卡片 + rich card + Patch refresh + Card 2.0 streaming | 普通 IM patch + 可选 CardKit + footer + approval card | cc-connect 更接近完整产品体验 |
| footer | model、effort、usage、context、cwd 等组合 | status/thread/turn/elapsed/tokens/model/version/error/cwd | 重叠，cc-connect 更偏通用运行态 |
| 审批 | app-server approval、permissions、request_user_input、dynamic tool | approval request 最小闭环，附件审批骨架 | cc-connect 更完整 |
| 文件/图片输入 | 图片写入本地并传给 Codex；平台侧有附件下载/发送能力 | 附件输入默认关闭，只有审批和 adapter 骨架 | cc-connect 更完整 |
| 多会话/命令 | 完整命令族和 session 控制 | `/status`、取消、若干安全占位 | cc-connect 更完整 |
| 多平台 | 飞书、微信、Telegram、Slack 等多平台框架 | 只聚焦飞书 | 如果目标变成多端，fca 不应继续自研 |
| 安全边界 | 模式、allowlist、permission、workspace、多项目配置 | 白名单用户、目录、审批脱敏、默认关闭附件 | fca 更偏“最小可审计”，但覆盖面窄 |
| 技术栈 | Go 单二进制 | Node.js | 若采用 cc-connect，fca 技术栈优势不明显 |

## fca 仍可能有价值的差异

这些差异不足以支撑继续自研完整通道，但可以作为“是否贡献上游/保留薄层”的判断依据：

- 更窄的企业安全边界：默认只做飞书 + Codex，不开放多平台和大量命令。
- 更明确的审批脱敏摘要：不展示命令正文、完整路径、diff 或原始 payload。
- 当前文档已围绕飞书企业自建应用、工作目录白名单和审计字段形成较清晰的规范。
- Node 技术栈可能更贴近现有前端/脚本生态，但这不是核心产品优势。

## 必须补的验证

采用或替代前必须实机验证以下项：

1. cc-connect 使用 `backend = "app_server"` 时，是否能在本机 Codex 版本上稳定启动、恢复 thread 并完成长任务。
2. 飞书 WebSocket 长连接在用户自建应用权限下是否能直接工作，尤其是 `card.action.trigger` 和消息 Patch。
3. cc-connect 的 app-server approval request 在真实 Codex 版本上是否覆盖 fca 已支持的 `acceptForSession` 语义，或只能单次 accept / decline。
4. cc-connect 是否支持按企业需要收紧命令族，例如禁用 `/shell`、限制 `/mode`、限制 yolo。
5. cc-connect 的日志、卡片 footer 和错误回显是否会暴露命令正文、路径、附件名或其它敏感信息；如果会，能否通过配置关闭或上游补丁修复。
6. cc-connect 文件/图片下载是否有“审批前不下载”的门禁；若没有，企业场景必须补。
7. cc-connect 的飞书多项目共享 WebSocket 是否适配单项目部署，并且不会引入难排查的跨项目 fan-out。

## 路线建议

短期暂停 fca 的新功能开发，转为三步：

1. 用临时飞书应用和本机 Codex 对 cc-connect 做 app-server 后端 smoke。
2. 形成 cc-connect 缺口清单：安全策略、审批脱敏、附件前置审批、命令禁用、日志脱敏。
3. 若缺口可控，优先采用 cc-connect 或向 cc-connect 上游贡献补丁；fca 只保留文档、配置模板和极小适配层。

只有当 cc-connect 在 app-server 稳定性、企业安全边界或飞书交互上出现不可接受缺口时，fca 才继续作为独立实现推进。
