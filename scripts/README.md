# Scripts

此目录用于放置启动、检查、部署和本地验证脚本。

建议后续脚本：

- `smoke-codex-turn`：不依赖飞书，直接跑通一次 Codex turn。

当前可用验证命令：

```powershell
npm test
```

`npm test` 使用低并发稳定模式，适合 Windows 本地验证；资源充足时可用 `npm run test:parallel` 跑 Node 默认并发模式。

```powershell
npm run check-config
```

`check-config` 会检查飞书凭据、open_id 白名单、工作目录白名单、默认工作目录和基础 runtime 配置；它只读取当前环境变量，不读取或提交真实 `.env`。

```powershell
npm run migrate:thread-store -- --help
```

将 JSON thread store 迁移到 SQLite 的命令：

```powershell
npm run migrate:thread-store -- --from-json data/threads.json --to-sqlite data/threads.sqlite --dry-run
npm run migrate:thread-store -- --from-json data/threads.json --to-sqlite data/threads.sqlite
```

迁移脚本会保留可迁移记录的 `openId`、`chatId`、`chatType`、`conversationId`、`cwd`、`threadId`、`lastTurnId` 和 `lastSeenAt`；缺少 `openId`、`cwd` 或 `threadId` 的坏记录会被跳过并计数。

```powershell
npm run check-codex-app-server -- --help
```

`check-codex-app-server` 会启动本机 `codex app-server` 并验证 `initialize` 能完成，不会创建 thread 或发起 turn。

```powershell
npm run dev
```

`dev` 当前会检查飞书凭据，创建飞书 SDK transport，探测 bot open_id，并通过飞书 SDK 长连接监听私聊消息事件。

```powershell
npm run smoke:codex -- --help
```

真实启动本地 Codex app-server 的 smoke 命令：

```powershell
npm run smoke:codex -- --cwd F:\development\f-codex --prompt "Summarize this repository in one short paragraph."
```
