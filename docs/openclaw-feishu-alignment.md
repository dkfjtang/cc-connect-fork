# OpenClaw 飞书插件对齐审计

## 结论

fca 不 fork OpenClaw 飞书插件，也不把它作为运行时依赖；但后续功能要持续对齐其飞书侧体验和防护能力。

当前对齐基准：

- 仓库：`https://github.com/larksuite/openclaw-lark`
- 只读审计版本：`adaa568`
- 许可证：MIT
- 包名：`@larksuite/openclaw-lark`

## 对齐原则

- 源码层面：只读审计、提炼行为和接口边界，不复制实现代码。
- 功能层面：优先对齐飞书事件接入、卡片更新、footer、权限、去重和长任务体验。
- 架构层面：保留 fca 自己的 Codex app-server、thread / turn、审批和工作目录策略。

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
| 卡片持续更新 | 先发卡片，再更新同一张卡片 | 已有 send / update action 和 controller |
| footer | 可展示状态、耗时、模型、token 等 | 已展示 status / thread / turn / cwd |
| app 归属校验 | 事件 app_id 不匹配时丢弃 | 已支持 `FEISHU_APP_ID` 校验 |
| 自回声过滤 | bot 自己发出的消息不再处理 | 已支持 `botOpenId` 过滤入口 |
| 去重 | WebSocket 重连重复消息只处理一次 | 已支持进程内 message_id 去重 |
| 过期事件丢弃 | 重连回放的旧事件丢弃 | 已支持 `create_time` 年龄校验 |

## 近期差距

| 优先级 | 差距 | fca 处理方式 |
| --- | --- | --- |
| P0 | 真实飞书 SDK transport | 接入 `@larksuiteoapi/node-sdk`，实现长连接和消息 API |
| P0 | bot open_id 探测 | dev 启动时查询 bot 身份，并注入 `FeishuEventHandler` |
| P0 | 按 chat / thread 串行队列 | 增加 per-chat queue，避免同一会话并发 turn 打乱卡片 |
| P0 | 卡片更新节流 | 增加 flush controller，delta 聚合后低频 patch |
| P1 | CardKit 优先、IM patch fallback | MVP 先用 IM card patch，后续增加 CardKit 2.0 |
| P1 | 取消快路径 | 识别“取消/停止/abort”并中断当前 turn、更新卡片 |
| P1 | 群聊策略 | 私聊稳定后再做群聊 @、群 allowlist、sender allowlist |
| P1 | 卡片交互审批 | Codex approval event 映射到飞书按钮回调 |
| P2 | 文件/图片资源 | 后续作为 Codex 输入附件和输出附件能力规划 |
| P2 | 文档/多维表/日历/任务工具 | 不属于 fca MVP；只在 Codex 能力需要飞书工具时评估 |

## 事件入口对齐

OpenClaw 的入站链路包含以下护栏：

1. 校验事件 `app_id` 是否属于当前账号。
2. 丢弃 bot 自己发出的自回声消息。
3. 使用 message dedup 处理 WebSocket 重连重复投递。
4. 丢弃超过有效窗口的旧消息。
5. 按 `account + chat + thread` 串行执行任务。
6. 对取消文本走快速中断路径。

fca 当前已实现 1 到 4；5 和 6 是下一阶段 P0/P1。

## 卡片体验对齐

OpenClaw 的卡片链路包含：

- 显式状态机：idle / creating / streaming / completed / aborted / terminated。
- CardKit 卡片优先，失败后回退到普通 IM 卡片。
- 流式文本区域使用稳定 element id。
- 更新节流和互斥 flush，避免 API 频率和并发更新冲突。
- 最终态必须落卡片，异常时展示可读错误。
- footer 可配置展示状态、耗时、token、cache、context、model。

fca 的目标：

- MVP：普通 IM 卡片 send + patch，running / completed / failed 三态稳定。
- 下一步：增加节流 flush 和 per-chat queue。
- 后续：再评估 CardKit 2.0 和更丰富 footer 指标。

## 不对齐项

以下 OpenClaw 能力不进入 fca MVP：

- OpenClaw Agent 执行内核。
- OpenClaw skill / tool registry。
- 飞书文档、多维表、日历、任务完整工具集。
- 多账号配置迁移和 OpenClaw channel plugin 协议。
- OpenClaw session store 和 tool-use trace store。

这些能力可以作为长期参考，但不能替代 Codex app-server 的 thread / turn / approval 模型。
