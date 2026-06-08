# Scripts

此目录用于放置启动、检查、部署和本地验证脚本。

建议后续脚本：

- `check-config`：检查必需配置和凭据占位。
- `check-codex-app-server`：验证本机 `codex app-server` 可启动。
- `smoke-codex-turn`：不依赖飞书，直接跑通一次 Codex turn。

当前可用验证命令：

```powershell
npm test
```

```powershell
npm run dev
```

`dev` 当前会检查飞书凭据是否存在；真实飞书长连接 transport 后续接入。

```powershell
npm run smoke:codex -- --help
```

真实启动本地 Codex app-server 的 smoke 命令：

```powershell
npm run smoke:codex -- --cwd F:\development\f-codex --prompt "Summarize this repository in one short paragraph."
```
