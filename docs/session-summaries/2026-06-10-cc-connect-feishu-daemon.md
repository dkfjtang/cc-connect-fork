# 2026-06-10 - cc-connect Feishu + Codex Desktop Daemon

## Extracted Conclusions

### Key Decisions

- Active repo/workspace: `F:\development\cc-connect-fork`.
- `F:\development\f-codex` is no longer used and has been deleted.
- Runtime files live in `F:\development\cc-connect-service`; avoid placing this runtime under `C:\`.
- Keep the fork close to upstream `chenhg5/cc-connect`: small compatible patches, easy to rebase/retire, no independent long-lived product branch.
- Preferred runtime path is Windows user-logon scheduled task, not Windows Service, because the Feishu chain needs the logged-in Windows session to work with Codex Desktop/app-server.

### Final Runtime Shape

- Old NSSM service: `cc-connect-codex-feishu`, stopped/disabled.
- Active scheduled task: `cc-connect-codex-feishu-user`.
- Trigger: current user logon.
- Task action:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "F:\development\cc-connect-service\run-user-task.ps1"
```

- Launcher behavior:
  - `run-user-task.ps1` runs from `F:\development\cc-connect-service`.
  - It starts `F:\development\cc-connect-service\cc-connect.exe`.
  - It redirects stdout/stderr to:
    - `F:\development\cc-connect-service\logs\cc-connect.user.out.log`
    - `F:\development\cc-connect-service\logs\cc-connect.user.err.log`
  - It uses `-Wait`, so Task Scheduler remains `Running` while `cc-connect.exe` is alive.

### Black Window Root Cause And Fix

- Root cause: the Windows binary was originally a console subsystem executable; hiding wrapper scripts was insufficient because the child process could still create a console window.
- Fix: build Windows binary with GUI subsystem:

```bash
-ldflags "-s -w -H windowsgui -X main.version=... -X main.commit=... -X main.buildTime=..."
```

- Verified final state:
  - scheduled task `cc-connect-codex-feishu-user` is `Running`;
  - scheduled task `Hidden=True`;
  - `cc-connect.exe` is running with `MainWindowHandle=0`;
  - visible desktop window enumeration shows no `cc-connect`, `wscript`, or wrapper PowerShell window;
  - Feishu WebSocket connection logs are normal.

### Feishu Card/UI Work

- Feishu rich cards were made more Chinese-friendly and more detailed.
- Final footer target:

```text
已完成 · 耗时 11.4s · gpt-5.5
↑ 36.6k ↓ 67 · 缓存 36.2k/0 (50%) · 上下文 36.7k/258.4k (14%)
```

- Suppressed trailing workdir footer of `.`.
- Added cache ratio display.
- Model name may still be missing in some app-server paths; user accepted that as non-blocking.

### Build And Deploy

- Windows binary is built from WSL + Docker, using the repo at `/mnt/f/development/cc-connect-fork`.
- Current build script:
  - `F:\development\cc-connect-fork\deploy\windows-daemon\build-windows-amd64.sh`
- Runtime binary:
  - `F:\development\cc-connect-service\cc-connect.exe`
- Runtime config remains outside repo:
  - `F:\development\cc-connect-service\config.toml`
- Do not commit or print Feishu app secret or raw private token material.

## Validation Commands

```powershell
Get-ScheduledTask -TaskName cc-connect-codex-feishu-user
Get-ScheduledTaskInfo -TaskName cc-connect-codex-feishu-user
Get-Process -Name cc-connect | Select-Object Id,MainWindowHandle,Path,StartTime
Get-Content -LiteralPath F:\development\cc-connect-service\logs\cc-connect.user.out.log -Tail 40
Get-Content -LiteralPath F:\development\cc-connect-service\logs\cc-connect.user.err.log -Tail 40
```

## Known Limitations

- This is not pre-login startup. It starts after the `Administrator` user logs in.
- Windows Service/NSSM remains a fallback, but it is not the main path because it is isolated from the interactive desktop session.
- Feishu -> Codex command execution can still hit Codex Windows sandbox/logon issues, including `CreateProcessWithLogonW failed: 1326`; keep app-server dialogue/card mode as the stable path.
- Full `go test ./core` previously had an unrelated pre-existing failure in `TestEmbeddedProbeScriptBeginsWithShebang`; targeted tests for the card/footer changes passed.

## Dropped Noise

- Raw Feishu credentials and private identifiers were intentionally not preserved.
- Repeated failed process-cleanup commands were reduced to the useful lesson: avoid broad command-line matching that can kill the current maintenance PowerShell.

## Open Follow-ups

- Commit and push the runtime/deploy documentation and code changes after final review.
- If automatic restart after crash becomes required, configure scheduled-task restart policy or move to a small watchdog wrapper, while preserving user-session execution.
