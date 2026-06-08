# Config

此目录用于放置配置模板。真实凭据不得提交到仓库。

当前提供:

- `.env.example`
- `groups.example.json`

## 配置项

| 变量 | 说明 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书自建应用 App ID。 |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret。 |
| `FEISHU_VERIFICATION_TOKEN` | 飞书事件订阅校验 Token。 |
| `FEISHU_ENCRYPT_KEY` | 飞书事件加密 Key。 |
| `FCA_ALLOWED_OPEN_IDS` | 允许使用 fca 的飞书 `open_id` 列表。 |
| `FCA_ALLOWED_GROUP_CHAT_IDS` | 允许触发 fca 的飞书群聊 `chat_id` 列表；留空时不限制已 @ Bot 的群聊。 |
| `FCA_GROUP_SENDER_OPEN_IDS` | 可选的群内 sender 收紧策略，格式为 `chat_id=open_id,open_id;chat_id=open_id`。 |
| `FCA_GROUP_DEVELOPER_INSTRUCTIONS` | 可选的群级 Codex developer instructions，格式为 `chat_id=instructions;chat_id=instructions`。 |
| `FCA_GROUP_CONFIG_PATH` | 可选的群级 JSON 配置文件路径，用于集中维护群 allowlist、群内 sender 收紧策略和群级 developer instructions。 |
| `FCA_ALLOWED_WORKDIRS` | 允许 Codex 使用的本地工作目录列表。 |
| `FCA_DEFAULT_WORKDIR` | 默认工作目录。 |
| `FCA_CODEX_BIN` | Codex CLI 命令路径，默认可为 `codex`。 |
| `FCA_CODEX_LISTEN` | app-server 监听方式，MVP 固定使用 `stdio://`。 |
| `FCA_CODEX_MODEL` | 可选 Codex 模型覆盖。 |
| `FCA_VERSION` | fca 版本标识，默认 `0.1.0`，会展示在卡片 footer 和结构化日志上下文。 |
| `FCA_CARD_CHANNEL` | 任务卡片发送通道，可选 `im` / `cardkit`，默认 `im`；`cardkit` 会优先尝试 CardKit transport，失败或不可用时回退普通 IM 卡片。 |
| `FCA_CARD_FOOTER_FIELDS` | 可选任务卡片 footer 字段列表，默认 `status,thread,turn,elapsed,tokens,model,version,error,cwd`；可用字段为 `status`、`thread`、`turn`、`elapsed`、`tokens`、`model`、`version`、`error`、`cwd`。 |
| `FCA_LOG_LEVEL` | JSONL 结构化日志级别，可选 `debug` / `info` / `warn` / `error`，默认 `info`。 |
| `FCA_TURN_TIMEOUT_SECONDS` | 单个 turn 超时时间。 |
| `FCA_APPROVAL_TIMEOUT_SECONDS` | Codex approval request 等待飞书按钮处理的超时时间，默认 `300` 秒；超时默认拒绝。 |
| `FCA_THREAD_STORE_DRIVER` | thread 映射存储后端，可选 `json` / `sqlite`，默认 `json`。 |
| `FCA_THREAD_STORE_PATH` | 本地 thread 映射存储路径；`json` 默认 `data/threads.json`，`sqlite` 默认 `data/threads.sqlite`。 |
| `FCA_MESSAGE_DEDUP_STORE_PATH` | 本地消息去重 JSON 文件路径，用于 WebSocket 重连或进程重启后的回放去重。 |
| `FCA_MESSAGE_DEDUP_TTL_SECONDS` | 消息去重保留时间，默认 `86400` 秒。 |

## 凭据规则

`.env.example` 只能包含空值或示例值。真实 `.env` 文件不得提交到仓库。

## 配置检查

启动真实长连接前先运行：

```powershell
npm run check-config
```

该命令只读取当前环境变量，检查：

- `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否存在。
- `FCA_ALLOWED_OPEN_IDS` 是否至少包含一个 `open_id`。
- `FCA_ALLOWED_GROUP_CHAT_IDS` 的配置数量会在摘要中展示；留空不报错。
- `FCA_GROUP_CONFIG_PATH` 的文件路径和群配置数量会在摘要中展示；文件格式错误会报错。
- `FCA_GROUP_SENDER_OPEN_IDS` 的策略数量会在摘要中展示；格式错误会报错。
- `FCA_GROUP_DEVELOPER_INSTRUCTIONS` 的配置数量会在摘要中展示；格式错误会报错。
- `FCA_ALLOWED_WORKDIRS` 是否至少包含一个本地目录。
- `FCA_DEFAULT_WORKDIR` 是否存在且位于工作目录白名单内。
- turn 超时、approval 超时、thread store driver/path、message dedup store 路径、卡片通道、卡片 footer 字段和 Codex 命令等基础 runtime 配置。

## Thread Store

默认配置继续使用 `FCA_THREAD_STORE_DRIVER=json` 和 `data/threads.json`，保持现有部署兼容。

长期会话、群聊会话隔离和后续状态查询建议改用 SQLite：

```powershell
FCA_THREAD_STORE_DRIVER=sqlite
FCA_THREAD_STORE_PATH=data/threads.sqlite
```

SQLite 后端同样按会话维度保存映射：私聊使用 `open_id + cwd`，群聊使用 `chat_id + cwd`。

## Group Config

`FCA_GROUP_CONFIG_PATH` 指向一个 JSON 文件。文件中的群配置会和环境变量中的 `FCA_ALLOWED_GROUP_CHAT_IDS`、`FCA_GROUP_SENDER_OPEN_IDS`、`FCA_GROUP_DEVELOPER_INSTRUCTIONS` 合并；同一群的 sender open_id 取并集，文件里的 developer instructions 覆盖同群环境变量值。

示例：

```json
{
  "groups": [
    {
      "chatId": "oc_xxx",
      "allowedSenderOpenIds": ["ou_1", "ou_2"],
      "developerInstructions": "只处理这个群对应的项目上下文。"
    },
    {
      "chatId": "oc_open"
    }
  ]
}
```

该文件只收紧群入口和补充群上下文，不会绕过 `FCA_ALLOWED_OPEN_IDS` 全局白名单。

从 JSON 切换到 SQLite 前可先 dry-run：

```powershell
npm run migrate:thread-store -- --from-json data/threads.json --to-sqlite data/threads.sqlite --dry-run
```

确认记录数量后再执行迁移，并把运行环境切到 `FCA_THREAD_STORE_DRIVER=sqlite`。

## 日志输出

`npm run dev` 会将结构化任务日志写入 stderr，便于本机终端、容器或进程管理器采集。任务日志包含 `messageId`、`openId`、`chatId`、`threadId`、`turnId`、`status`、`elapsedMs`、`errorSummary` 和 `errorType`，不包含 App Secret、Codex 凭据或完整环境变量。
