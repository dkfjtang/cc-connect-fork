# OpenClaw 飞书插件对齐审计

## 结论

fca 不 fork OpenClaw 飞书插件，也不把它作为运行时依赖；但后续功能必须持续对齐其飞书侧源码行为、交互体验和防护能力。

2026-06-09 追加：cc-connect 源码已经提供更接近 fca 目标态的“飞书 + Codex app-server”整合实现。OpenClaw 仍作为飞书官方插件体验基线，但下一阶段的采用/自研裁决以 `docs/cc-connect-deep-comparison.md` 的验证清单为优先依据。

当前对齐基准：

- 仓库：`https://github.com/larksuite/openclaw-lark`
- 只读审计版本：`adaa568`
- 许可证：MIT
- 包名：`@larksuite/openclaw-lark`

## 对齐原则

- 源码层面：只读审计、提炼行为和接口边界，不复制实现代码。
- 功能层面：优先对齐飞书事件接入、卡片更新、footer、权限、去重和长任务体验。
- 架构层面：保留 fca 自己的 Codex app-server、thread / turn、审批和工作目录策略。
- 交付层面：新增或修改飞书侧能力时，必须同步更新本文档的对齐表，标明 OpenClaw 源码行为、fca 映射方式和差异理由。

## 重叠能力裁决

OpenClaw 飞书插件和相关文章已经覆盖大量飞书通道能力：WebSocket 长连接、消息收发、持续卡片更新、footer、文件/图片资源、审批按钮、群配置和权限策略。fca 不再把这些能力当作空白问题重新设计。

后续路线：

1. 飞书通道体验优先按 OpenClaw 行为对齐，包括长连接生命周期、消息 gate、卡片状态、footer、节流、文件通道和审批交互。
2. fca 不 fork OpenClaw，也不引入 OpenClaw runtime / plugin SDK 作为核心依赖；只读审计其源码和公开文档，抽取稳定行为。
3. 自研范围收敛为 Codex 差异层：Codex app-server JSON-RPC、thread / turn 映射、Codex streamed agent events、Codex approval server request、工作目录白名单、Codex 任务日志和本地执行安全边界。
4. 如果某项飞书侧能力 OpenClaw 已有成熟实现，fca 必须先说明“为什么不能直接按 OpenClaw 行为对齐”，再进入实现；否则默认只做 Codex 映射和测试。
5. 文章或新资料提出的能力若与 OpenClaw 飞书通道重叠，优先更新本文档的对齐表，不直接扩大 fca 自研范围。

## 源码对齐交付规则

每个飞书侧功能进入实现前，需要先完成一轮 OpenClaw 源码对齐记录：

1. 定位 OpenClaw 相关模块和函数，记录只读审计版本。
2. 抽取用户可见行为、事件护栏、错误处理和重试/节流策略。
3. 明确 fca 的 Codex 映射：`message_id`、`chat_id`、`open_id`、`thread_id`、`turn_id`、卡片 id 和状态机如何对应。
4. 如果 fca 不采用 OpenClaw 的实现方式，必须写明原因，例如 Codex app-server 模型不同、安全边界不同或 MVP 范围不同。
5. 实现后补测试，测试名称或断言要能反映对应的 OpenClaw 行为基线。

这条规则的含义是：不 fork 代码，但不能凭印象重写飞书体验；飞书侧行为要以 OpenClaw 源码为参照物持续校准。

## OpenClaw 能力基线

OpenClaw 飞书插件公开 README 和源码体现的主要能力：

- Messenger：读消息、发消息、回复消息、搜索消息、下载图片/文件。
- Docs / Base / Sheets / Calendar / Tasks：作为 OpenClaw 工具能力暴露。
- Interactive Cards：Thinking / Generating / Complete 状态和敏感操作确认按钮。
- Streaming Responses：在消息卡片内实时流式更新文本。
- Permission Policies：私聊、群聊、发送者和 group 配置策略。
- Advanced Group Configuration：按群配置 allowlist、skill 绑定和系统提示词。

fca 第一阶段不追求完整复制工具生态，优先对齐“飞书作为 Codex 会话入口”的核心体验。

## 已对齐项

| 能力 | OpenClaw 行为 | fca 当前状态 |
| --- | --- | --- |
| 私聊文本入口 | 支持 DM 消息进入 Agent | 已支持私聊文本解析 |
| 群聊 @ 入口 | 群聊需要按 mention、群配置和发送者策略触发 | 已支持明确 @ 当前 bot 的群聊文本，可用 `FCA_ALLOWED_GROUP_CHAT_IDS` 或 `FCA_GROUP_CONFIG_PATH` 限制群 `chat_id`，并可用群内 sender allowlist 进一步收紧 sender |
| 卡片持续更新 | 先发卡片，再更新同一张卡片 | 已有 send / update action 和 controller，并串行化同一卡片更新；限频错误会指数退避，非重试业务错误会快速失败；卡片正文和 footer 会做尺寸收敛 |
| footer | 可展示状态、耗时、模型、token 等 | 已展示 status / thread / turn / elapsed / token / cache / context / model / fca version / error type / cwd，并支持 `FCA_CARD_FOOTER_FIELDS` 调整字段 |
| app 归属校验 | 事件 app_id 不匹配时丢弃 | 已支持 `FEISHU_APP_ID` 校验 |
| 自回声过滤 | bot 自己发出的消息不再处理 | 已支持 `botOpenId` 过滤入口 |
| 去重 | WebSocket 重连重复消息只处理一次 | 已支持持久化 message_id 去重窗口 |
| 过期事件丢弃 | 重连回放的旧事件丢弃 | 已支持 `create_time` 年龄校验 |
| 按会话串行 | 同一 chat / thread 内任务串行执行 | 已支持按 `chat_id` 串行 |
| 更新节流 | 流式内容低频刷新卡片 | 已支持 Codex delta 运行中节流更新和 card update 互斥 flush |
| 取消快路径 | 用户发送停止文本时快速中断当前任务 | 已支持取消文本识别、cancelled 卡片和 `turn/interrupt` |
| 状态查询快路径 | 用户查询当前任务时刷新已有卡片，不打断长任务 | 已支持状态文本识别，并绕过同 chat 队列刷新 active task 卡片 |
| 长连接可观测性 | WebSocket 启动、入站事件、gate 后分发耗时和 dispatch 失败进入日志 | 已记录 WS 启动阶段、事件收到、message handled/skipped 耗时和 handler 失败的 JSONL 日志 |
| 长驻进程退出治理 | 收到进程退出信号时释放 listener / 子进程资源 | 已注册 `SIGINT` / `SIGTERM`，按 app-server、transport 顺序 best-effort 停止并记录 JSONL 日志 |
| 审批按钮权限 | 交互卡片操作也要受账号和群策略约束 | 已要求审批操作者命中全局 `open_id` 白名单；配置群 sender allowlist 时，按钮操作者也必须命中该群策略 |

## 近期差距

| 优先级 | 差距 | fca 处理方式 |
| --- | --- | --- |
| P0 | 真实飞书 SDK transport | 已接入 `@larksuiteoapi/node-sdk`，实现长连接和消息 API |
| P0 | bot open_id 探测 | 已在 dev 启动时查询 bot 身份，并注入 `FeishuEventHandler` |
| P0 | 按 chat / thread 串行队列 | 已增加 per-chat queue，避免同一会话并发 turn 打乱卡片 |
| P0 | 卡片更新节流 | 已增加 delta 聚合低频 patch 和同一卡片更新队列 |
| P1 | CardKit 优先、IM patch fallback | 已支持 `FCA_CARD_CHANNEL=cardkit`、SDK CardKit create/update、CardKit 优先和 IM fallback；默认仍保持 IM |
| P1 | 群聊策略 | 已完成群聊 @ 最小入口、可选群 `chat_id` allowlist、群内 sender 收紧策略和群级 developer instructions |
| P1 | 卡片交互审批 | 已完成 Codex approval server request 识别、等待审批卡片、详情展开、飞书按钮回调和超时默认安全拒绝 |
| P2 | 文件/图片资源 | 私聊非文本消息已返回固定暂不支持提示且不下载附件；已补 `FCA_FEISHU_FILE_INPUTS_ENABLED` 显式门禁并默认关闭；已增加附件下载 adapter 脱敏契约和默认 disabled 实现，后续作为 Codex 输入附件和输出附件能力规划 |
| P2 | 文档/多维表/日历/任务工具 | 不属于 fca MVP；只在 Codex 能力需要飞书工具时评估 |

## 源码对齐待办

| 优先级 | OpenClaw 源码能力 | fca 目标 |
| --- | --- | --- |
| P0 | 长连接启动、重连、事件分发和错误日志 | 已接入 SDK 长连接，并补充 WS lifecycle / event dispatch 结构化日志；默认启用 SDK `autoReconnect`，可用 `FCA_FEISHU_WS_AUTO_RECONNECT=false` 显式关闭；已补退出信号治理、关闭结果日志、重建前关闭旧连接和启动失败清理 |
| P0 | 消息事件去重、回放过滤、自回声过滤 | 已实现基础护栏和持久化去重窗口，避免进程重启后重复处理 |
| P0 | 持续回复卡片更新、节流和最终态兜底 | 已实现 running 节流、阶段标签更新、同一卡片互斥 flush、发送/更新错误分类退避和最终态更新；后续继续补 CardKit 降级策略 |
| P0 | 卡片 footer 的状态、会话和排障字段 | 已展示 status / thread / turn / elapsed / token / cache / context / model / fca version / error type / cwd，并支持字段可配置 |
| P1 | 群聊 @、群配置和发送者策略 | 已实现 @ 触发、可选群 `chat_id` allowlist、群级 JSON 配置文件、全局发送者 `open_id` 白名单、群内 sender 收紧策略和群级 developer instructions |
| P1 | 敏感操作确认卡片 | 已映射到 Codex approval server request，展示风险等级、固定枚举风险因素和脱敏范围摘要，并支持同一卡片展开详情；不复用 OpenClaw tool approval 内核 |
| P1 | CardKit 2.0 与普通卡片降级 | 已补 CardKit 优先、IM fallback 的配置开关、卡片身份元数据、稳定 element id、正文 element content 局部更新、message client 降级链路和 SDK transport CardKit create/update |

## 事件入口对齐

OpenClaw 的入站链路包含以下护栏：

1. 校验事件 `app_id` 是否属于当前账号。
2. 丢弃 bot 自己发出的自回声消息。
3. 使用 message dedup 处理 WebSocket 重连重复投递。
4. 丢弃超过有效窗口的旧消息。
5. 按 `account + chat + thread` 串行执行任务。
6. 对取消文本走快速中断路径。
7. 对状态查询文本走快速卡片刷新路径，不创建新的 Agent / Codex turn。

fca 当前已实现 1 到 7。

## 长连接源码对齐

只读审计版本：`larksuite/openclaw-lark@adaa568`。

OpenClaw 源码基线：

- `src/core/lark-client.ts` 的 `startWS` 按 `probe -> EventDispatcher -> WSClient -> start` 启动长连接。
- `startWS` 在重建连接前会关闭旧 `WSClient`，避免遗留连接。
- `src/channel/monitor.ts` 默认走 `websocket` connection mode，并记录 WebSocket starting / started。
- `src/messaging/inbound/handler.ts` 会记录收到消息、gate 后分发，以及 dispatch 失败耗时。

fca 映射：

- `FeishuSdkTransport.startMessageListener()` 保持 `EventDispatcher + WSClient` 入口，但不引入 OpenClaw 的多账号 channel monitor。
- `FeishuSdkTransport.startMessageListener()` 重建 listener 前会先关闭旧 `WSClient`，启动失败时也会 best-effort 清理半初始化 client，避免重复长连接残留。
- `FeishuSdkTransport` 默认透传 SDK `autoReconnect=true`，并将 SDK reconnecting / reconnected / error callback 转为结构化日志；测试或特殊排障场景可用 `FCA_FEISHU_WS_AUTO_RECONNECT=false` 关闭 SDK 自动重连。
- `FeishuSdkTransport.getMessageListenerStatus()` 提供长连接脱敏快照，字段限定为 active、autoReconnect、state、last/next connect time 和 reconnectAttempts，供后续 `/status` 或运维探针复用。
- `runDev` 将同一个 JSONL logger 注入 transport 和 runtime，保证飞书连接、入站事件、Codex task 日志在同一日志流里关联。
- 新增 `feishu.ws_starting`、`feishu.ws_dispatcher_created`、`feishu.ws_handlers_registered`、`feishu.ws_client_created`、`feishu.ws_started`、`feishu.ws_reconnecting`、`feishu.ws_reconnected`、`feishu.ws_error`、`feishu.ws_start_failed`、`feishu.ws_cleanup_failed`、`feishu.ws_stopped` 和 `feishu.ws_stop_failed`。
- 新增 `feishu.event_received` 和 `feishu.event_handler_failed`，只记录 `appId`、event type、`message_id`、`chat_id`、`chat_type` 和错误摘要。
- 新增 `feishu.message_handled` 和 `feishu.message_skipped`，记录消息 gate 结果、处理耗时、跳过原因和任务状态，不记录消息正文、附件 key、文件名或完整 payload。
- `FCA_FEISHU_FILE_INPUTS_ENABLED` 先作为文件输入能力门禁进入配置检查和 diagnostics，当前只暴露布尔状态，不下载或读取附件。
- 非文本消息已增加安全 envelope，后续对齐 OpenClaw 文件/图片下载能力时只从该 envelope 进入下载流程，日志仍只允许记录 `attachmentKind` 枚举。
- 附件输入策略层已能按开关、chat 类型和附件分类给出 `eligible` 决策；真实下载仍未接入，避免在缺少审批和审计闭环时读取飞书文件内容。
- 附件下载审批摘要已先收敛为 Codex 风格的脱敏风险信息；后续可映射到现有 approval card，但当前不触发审批按钮或下载动作。
- 附件审批摘要已验证可渲染为现有 waiting approval 卡片模型，复用当前卡片结构和按钮 value 形状；后续接入前仍需要真实 pending approval 映射和下载执行器。
- 附件审批卡片在下载执行链路完成前已隐藏允许按钮，只保留查看详情、拒绝和停止，避免与 OpenClaw 已具备的真实下载能力产生误导性等价。
- 附件审批卡片 action builder 已能生成飞书 interactive card send action；当前仍不发送该卡片、不登记真实 pending map，避免按钮回调早于下载执行和审计闭环。
- 附件 pending approval 骨架已生成脱敏 request / approval / item id、keys 和日志字段；当前不写入运行时 pending map，避免按钮误回调后触发不存在的下载流程。
- 附件下载 adapter 骨架已定义后续审批通过链路到下载执行器之间的脱敏请求契约，并提供 transport-backed 包装和默认 disabled fallback；当前入站事件层不会在审批前调用 adapter。这一步只对齐 OpenClaw 文件/图片下载能力的接入点，不复用 OpenClaw 下载源码，也不调用真实飞书下载 API。
- diagnostics 已暴露附件下载 adapter 的脱敏 `status`，便于后续运维 smoke 判断接入点是否配置；该状态不包含附件 key、文件名、路径或下载 payload。

差异理由：

- fca 当前只有单个自建应用入口，不需要复制 OpenClaw 多账号 monitor 和 connection mode 配置。
- fca 的权威执行状态在 Codex thread / turn / runtime task，连接层只提供安全可观测信号，不记录消息正文、完整 payload、app secret、verification token 或 encrypt key。

群聊入口的当前安全边界：

- 仅 `chat_type=group` 且文本内容的 `mentions` 包含当前 bot `open_id` 时进入任务链路。
- 如果配置了 `FCA_ALLOWED_GROUP_CHAT_IDS`，群聊 `chat_id` 必须命中该 allowlist；留空则保持群 @ 入口兼容，不额外限制群。
- 如果配置了 `FCA_GROUP_SENDER_OPEN_IDS`，指定群内发送者 `open_id` 和审批按钮操作者还必须命中该群 sender allowlist；留空或未配置该群时不额外收紧。
- 如果配置了 `FCA_GROUP_DEVELOPER_INSTRUCTIONS`，该群的 Codex turn 会通过 app-server `developer_instructions` 接收群级上下文；私聊不受影响。
- 解析时会移除 mention key，只把用户真实任务文本交给 Codex。
- 普通群聊文本继续跳过，不作为后台触发命令。
- 进入运行时后仍以发送者 `open_id` 白名单为准，不使用群名、昵称等可变展示字段做权限依据。

## 卡片体验对齐

OpenClaw 的卡片链路包含：

- 显式状态机：idle / creating / streaming / completed / aborted / terminated。
- CardKit 卡片优先，失败后回退到普通 IM 卡片。
- 流式文本区域使用稳定 element id。
- 更新节流和互斥 flush，避免 API 频率和并发更新冲突。
- 发送或更新失败时应具备有限重试、限频退避和非重试错误快速失败，最终失败再进入可观测错误链路。
- 最终态必须落卡片，异常时展示可读错误。
- footer 可展示状态、耗时、token、cache、context、model。

fca 的目标：

- 默认：普通 IM 卡片 send + patch，running / completed / failed 三态稳定。
- 已增加运行中更新节流、同一卡片互斥 flush、发送/更新错误分类退避、卡片 payload 尺寸保护、per-chat queue 和飞书 API 错误归一化。
- 已增加 `FCA_CARD_CHANNEL=cardkit` 配置、卡片 channel / card id / sequence 元数据流转、SDK CardKit create/update、稳定 element id、正文 element content 局部更新、CardKit send/update 优先调用、`feishu.cardkit_fallback` 脱敏日志和 IM fallback；默认仍保持 IM。
- footer 字段可配置化已由 `FCA_CARD_FOOTER_FIELDS` 支持。

## 不对齐项

以下 OpenClaw 能力不进入 fca MVP：

- OpenClaw Agent 执行内核。
- OpenClaw skill / tool registry。
- 飞书文档、多维表、日历、任务完整工具集。
- 多账号配置迁移和 OpenClaw channel plugin 协议。
- OpenClaw session store 和 tool-use trace store。

这些能力可以作为长期参考，但不能替代 Codex app-server 的 thread / turn / approval 模型。
