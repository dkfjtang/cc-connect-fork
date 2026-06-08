# Config

此目录用于放置配置模板。真实凭据不得提交到仓库。

当前提供:

- `.env.example`

## 配置项

| 变量 | 说明 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书自建应用 App ID。 |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret。 |
| `FEISHU_VERIFICATION_TOKEN` | 飞书事件订阅校验 Token。 |
| `FEISHU_ENCRYPT_KEY` | 飞书事件加密 Key。 |
| `FCA_ALLOWED_OPEN_IDS` | 允许使用 fca 的飞书 `open_id` 列表。 |
| `FCA_ALLOWED_WORKDIRS` | 允许 Codex 使用的本地工作目录列表。 |
| `FCA_DEFAULT_WORKDIR` | 默认工作目录。 |
| `FCA_CODEX_BIN` | Codex CLI 命令路径，默认可为 `codex`。 |
| `FCA_CODEX_LISTEN` | app-server 监听方式，MVP 固定使用 `stdio://`。 |
| `FCA_CODEX_MODEL` | 可选 Codex 模型覆盖。 |
| `FCA_LOG_LEVEL` | JSONL 结构化日志级别，可选 `debug` / `info` / `warn` / `error`，默认 `info`。 |
| `FCA_TURN_TIMEOUT_SECONDS` | 单个 turn 超时时间。 |
| `FCA_THREAD_STORE_PATH` | 本地 thread 映射 JSON 文件路径。 |

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
- `FCA_ALLOWED_WORKDIRS` 是否至少包含一个本地目录。
- `FCA_DEFAULT_WORKDIR` 是否存在且位于工作目录白名单内。
- turn 超时、thread store 路径和 Codex 命令等基础 runtime 配置。

## 日志输出

`npm run dev` 会将结构化任务日志写入 stderr，便于本机终端、容器或进程管理器采集。任务日志包含 `messageId`、`openId`、`chatId`、`threadId`、`turnId`、`status` 和 `errorSummary`，不包含 App Secret、Codex 凭据或完整环境变量。
