# OpenClaw 飞书插件对齐审计

## 结论

fca 不 fork OpenClaw 飞书插件，也不把它作为运行时依赖；但后续功能必须持续对齐其飞书侧源码行为、交互体验和防护能力。

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
| 群聊 @ 入口 | 群聊需要按 mention、群配置和发送者策略触发 | 已支持明确 @ 当前 bot 的群聊文本，可用 `FCA_ALLOWED_GROUP_CHAT_IDS` 限制群 `chat_id`，并可用 `FCA_GROUP_SENDER_OPEN_IDS` 对指定群进一步收紧 sender |
| 卡片持续更新 | 先发卡片，再更新同一张卡片 | 已有 send / update action 和 controller，并串行化同一卡片更新 |
| footer | 可展示状态、耗时、模型、token 等 | 已展示 status / thread / turn / elapsed / model / fca version / error type / cwd |
| app 归属校验 | 事件 app_id 不匹配时丢弃 | 已支持 `FEISHU_APP_ID` 校验 |
| 自回声过滤 | bot 自己发出的消息不再处理 | 已支持 `botOpenId` 过滤入口 |
| 去重 | WebSocket 重连重复消息只处理一次 | 已支持持久化 message_id 去重窗口 |
| 过期事件丢弃 | 重连回放的旧事件丢弃 | 已支持 `create_time` 年龄校验 |
| 按会话串行 | 同一 chat / thread 内任务串行执行 | 已支持按 `chat_id` 串行 |
| 更新节流 | 流式内容低频刷新卡片 | 已支持 Codex delta 运行中节流更新和 card update 互斥 flush |
| 取消快路径 | 用户发送停止文本时快速中断当前任务 | 已支持取消文本识别、cancelled 卡片和 `turn/interrupt` |

## 近期差距

| 优先级 | 差距 | fca 处理方式 |
| --- | --- | --- |
| P0 | 真实飞书 SDK transport | 已接入 `@larksuiteoapi/node-sdk`，实现长连接和消息 API |
| P0 | bot open_id 探测 | 已在 dev 启动时查询 bot 身份，并注入 `FeishuEventHandler` |
| P0 | 按 chat / thread 串行队列 | 已增加 per-chat queue，避免同一会话并发 turn 打乱卡片 |
| P0 | 卡片更新节流 | 已增加 delta 聚合低频 patch 和同一卡片更新队列 |
| P1 | CardKit 优先、IM patch fallback | MVP 先用 IM card patch，后续增加 CardKit 2.0 |
| P1 | 群聊策略 | 已完成群聊 @ 最小入口、可选群 `chat_id` allowlist、群内 sender 收紧策略和群级 developer instructions |
| P1 | 卡片交互审批 | Codex approval event 映射到飞书按钮回调 |
| P2 | 文件/图片资源 | 后续作为 Codex 输入附件和输出附件能力规划 |
| P2 | 文档/多维表/日历/任务工具 | 不属于 fca MVP；只在 Codex 能力需要飞书工具时评估 |

## 源码对齐待办

| 优先级 | OpenClaw 源码能力 | fca 目标 |
| --- | --- | --- |
| P0 | 长连接启动、重连、事件分发和错误日志 | 已接入 SDK 长连接；继续补结构化日志和连接状态可观测性 |
| P0 | 消息事件去重、回放过滤、自回声过滤 | 已实现基础护栏和持久化去重窗口，避免进程重启后重复处理 |
| P0 | 持续回复卡片更新、节流和最终态兜底 | 已实现 running 节流、同一卡片互斥 flush、基础发送/更新重试和最终态更新；后续补更细的错误分类退避策略 |
| P0 | 卡片 footer 的状态、会话和排障字段 | 已展示 status / thread / turn / elapsed / model / fca version / error type / cwd；后续补 token/cache 等更细指标 |
| P1 | 群聊 @、群配置和发送者策略 | 已实现 @ 触发、可选群 `chat_id` allowlist、全局发送者 `open_id` 白名单、群内 sender 收紧策略和群级 developer instructions |
| P1 | 敏感操作确认卡片 | 映射到 Codex approval event，不复用 OpenClaw tool approval 内核 |
| P1 | CardKit 2.0 与普通卡片降级 | 先保留 IM patch；后续实现 CardKit 优先、IM patch fallback |

## 事件入口对齐

OpenClaw 的入站链路包含以下护栏：

1. 校验事件 `app_id` 是否属于当前账号。
2. 丢弃 bot 自己发出的自回声消息。
3. 使用 message dedup 处理 WebSocket 重连重复投递。
4. 丢弃超过有效窗口的旧消息。
5. 按 `account + chat + thread` 串行执行任务。
6. 对取消文本走快速中断路径。

fca 当前已实现 1 到 6。

群聊入口的当前安全边界：

- 仅 `chat_type=group` 且文本内容的 `mentions` 包含当前 bot `open_id` 时进入任务链路。
- 如果配置了 `FCA_ALLOWED_GROUP_CHAT_IDS`，群聊 `chat_id` 必须命中该 allowlist；留空则保持群 @ 入口兼容，不额外限制群。
- 如果配置了 `FCA_GROUP_SENDER_OPEN_IDS`，指定群内发送者 `open_id` 还必须命中该群 sender allowlist；留空或未配置该群时不额外收紧。
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
- 发送或更新失败时应具备有限重试，最终失败再进入可观测错误链路。
- 最终态必须落卡片，异常时展示可读错误。
- footer 可配置展示状态、耗时、token、cache、context、model。

fca 的目标：

- MVP：普通 IM 卡片 send + patch，running / completed / failed 三态稳定。
- 已增加运行中更新节流、同一卡片互斥 flush、基础发送/更新重试、per-chat queue 和飞书 API 错误归一化。
- 后续：再评估 CardKit 2.0 和更丰富 footer 指标。

## 不对齐项

以下 OpenClaw 能力不进入 fca MVP：

- OpenClaw Agent 执行内核。
- OpenClaw skill / tool registry。
- 飞书文档、多维表、日历、任务完整工具集。
- 多账号配置迁移和 OpenClaw channel plugin 协议。
- OpenClaw session store 和 tool-use trace store。

这些能力可以作为长期参考，但不能替代 Codex app-server 的 thread / turn / approval 模型。
