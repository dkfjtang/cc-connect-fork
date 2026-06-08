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
| `FCA_LOG_LEVEL` | 日志级别。 |
| `FCA_TURN_TIMEOUT_SECONDS` | 单个 turn 超时时间。 |

## 凭据规则

`.env.example` 只能包含空值或示例值。真实 `.env` 文件不得提交到仓库。
