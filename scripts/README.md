# Scripts

此目录用于放置启动、检查、部署和本地验证脚本。

建议后续脚本：

- `dev`：本地启动 Bridge。
- `check-config`：检查必需配置和凭据占位。
- `check-codex-app-server`：验证本机 `codex app-server` 可启动。
- `smoke-codex-turn`：不依赖飞书，直接跑通一次 Codex turn。

当前可用验证命令：

```powershell
npm test
```
