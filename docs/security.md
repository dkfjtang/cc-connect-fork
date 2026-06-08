# fca 安全边界

## 基本原则

fca 的默认安全模型是最小暴露、最小权限、可审计。飞书只是远程入口，不等同于获得本机 shell 或全盘文件访问。

## 身份边界

- 第一阶段只允许白名单飞书用户使用。
- 白名单以 `open_id` 为准。
- 长连接事件必须与配置的 `FEISHU_APP_ID` 匹配。
- Bot 自己发送的消息必须被过滤，避免自回声循环。
- 群聊只响应明确 @ Bot 的文本；普通群聊消息默认跳过。
- 配置 `FCA_ALLOWED_GROUP_CHAT_IDS` 后，群聊 `chat_id` 必须命中 allowlist；留空表示不额外限制已 @ Bot 的群。
- 配置 `FCA_GROUP_SENDER_OPEN_IDS` 后，指定群内只有列出的发送者 `open_id` 可触发文本任务和审批按钮；该策略只会在全局 `FCA_ALLOWED_OPEN_IDS` 之上进一步收紧。
- 配置 `FCA_GROUP_CONFIG_PATH` 后，文件内群配置会补充群 allowlist、群内 sender 收紧策略和群级 developer instructions；它不会绕过全局 `open_id` 白名单。
- 不把飞书昵称、群名等可变展示字段作为权限依据。

## 工作目录边界

- Codex turn 的 `cwd` 必须来自本地白名单。
- 默认不允许用户在飞书消息里任意切换路径。
- 不允许访问未列入白名单的项目目录。
- 当前 `/cwd` / `cwd` 命令只返回固定暂不支持提示，不启动 Codex turn、不切换目录、不回显用户输入路径。后续开放真实 `/cwd` 时必须先经过目录白名单校验。
- 当前 `/permission` / `permission` / `权限` 命令只返回固定暂不支持提示，不启动 Codex turn、不修改 sandbox、approval policy 或工作目录白名单、不回显用户输入参数。后续开放真实权限修改时必须加入确认、审计和最小权限校验。

## Codex 执行边界

- MVP 使用本地 `codex app-server` 的 `stdio://` 传输。
- fca Bridge 管理 app-server 子进程生命周期。
- 第一阶段不开放非本机 WebSocket 监听。
- 不默认使用无边界执行权限。
- Codex approval request 进入飞书审批链路，用户未处理时默认拒绝。

## 凭据边界

以下内容不得提交到仓库：

- 飞书 App ID。
- 飞书 App Secret。
- 飞书 Verification Token。
- 飞书 Encrypt Key。
- Codex 登录凭据。
- 任何代理、API 或私有服务认证凭据。

仓库只保留 `.env.example` 这类无真实值模板。

## 消息边界

- 第一阶段只处理私聊文本消息，以及明确 @ Bot 的群聊文本消息。
- 群聊消息进入任务链路后仍按发送者 `open_id` 做白名单校验。
- 相同 `message_id` 的重复投递只处理一次。
- 超过有效窗口的重连回放旧消息默认丢弃。
- 私聊文件、图片、文档或语音消息默认返回固定暂不支持提示，并按 `message_id` 去重；当前不会下载附件、读取文件名、读取 `file_key` 或把附件内容交给 Codex。
- `FCA_FEISHU_FILE_INPUTS_ENABLED` 是后续附件输入能力的显式安全门禁，默认关闭；当前版本只在配置检查和 diagnostics 中暴露布尔状态，不改变附件处理行为。
- 非文本消息进入日志前会先收敛为脱敏 envelope，只记录消息维度和 `attachmentKind` 枚举，不解析附件 `content` 或记录文件名、图片 key、文件 key。
- 附件策略层会先给出 `skip` / `notify_disabled` / `notify_unsupported` / `eligible` 决策；即使决策为 `eligible`，当前仍只返回固定提示，不下载附件。
- 附件审批摘要只展示风险等级、固定风险因素、附件类型、短消息 id 和会话类型；当前不会进入真实审批卡片，也不会读取附件内容。
- 附件下载 adapter 当前只有脱敏契约和默认 disabled 实现；adapter 请求不包含附件 key、文件名、文件路径或内容，返回结果也不包含这些字段。默认实现不会调用飞书下载 API、不会创建临时文件、不会把附件内容交给 Codex。
- 群聊非文本消息默认跳过，避免在未明确文本 @ Bot 的群聊里刷屏。
- Codex 输出回传前必须做长度控制；任务卡片正文和 footer 字段都要在渲染阶段截断，避免超长输出或路径撑爆卡片 payload。
- 错误消息只暴露可读摘要，不回传内部堆栈、环境变量或本机敏感路径。

## 网络边界

- app-server 不直接暴露到公网。
- 如后续启用 WebSocket，只允许 `127.0.0.1` 或受控内网，并配置鉴权。
- 需要公网入口时，应由飞书官方长连接承载，不暴露本机 Codex 端口。

## 审批边界

以下 Codex approval request 会进入飞书交互卡片审批：

- 写入或修改文件。
- 执行可能改变本机状态的命令。
- 联网访问。
- 外发本机文件或执行结果。
- 切换工作目录。
- 长时间任务继续运行。

审批卡片只展示必要的脱敏上下文，例如目录别名、动作类型数量、文件变更数量和扩展名、权限读写数量、网络目标域名；不展示命令正文、diff、完整路径、搜索词、reason 原文、完整环境变量、令牌或敏感文件内容。按钮只回写 `accept`、`acceptForSession`、`decline` 或 `cancel`，并且操作者必须满足全局 `open_id` 白名单和该群 sender 收紧策略；超过 `FCA_APPROVAL_TIMEOUT_SECONDS` 默认 `decline`。

## 日志边界

日志应包含：

- 飞书 `message_id`。
- 飞书 `open_id`。
- Codex `thread_id`。
- Codex `turn_id`。
- 工作目录。
- 状态和错误摘要。

日志不应包含：

- 真实凭据。
- 完整环境变量。
- 未脱敏的访问令牌。
- 大段用户私密内容。
