## 2026-06-16 - Feishu Service Runtime Diagnostics

### Key Information
- Workspace: `F:\development\cc-connect-fork`.
- Runtime service directory: `F:\development\cc-connect-service`.
- Windows service: `cc-connect-codex-feishu`, managed by NSSM.
- Runtime binary: `F:\development\cc-connect-service\cc-connect.exe`.
- Runtime config: `F:\development\cc-connect-service\config.toml`; this session did not modify it. User had already updated Feishu App ID and secret.
- Active Feishu App ID observed in config: `cli_a962f86e59f81cce`.
- Runtime bot open_id observed from service logs/API: `ou_434613a19c55a666622b1706b04bb66d`.
- Config hash observed during deployment/diagnostics: `FB34B60AD013060D8888AB13EF8F41616402B1FAFCA508F95BB7B2D204D98FAF`.
- During the later distillation check, the current config hash was `322D652FCAA3D12A567CE02EC0F883E6411A81DE4B3B47F3D28B4325C6FFC945`; this distillation step did not write the config, and the intervening hash change was not traced in this session.

### Important Information
- Service was running and connected to Feishu long connection:
  - `sc.exe queryex cc-connect-codex-feishu` showed `RUNNING`.
  - cc-connect child process path: `F:\development\cc-connect-service\cc-connect.exe`.
  - NSSM parameters: `--config F:\development\cc-connect-service\config.toml --force`.
  - TCP connection from cc-connect to Feishu `msg-frontier.feishu.cn:443` was `Established`.
- Initial user messages in the old group/private context produced no `im.message.receive_v1` logs because stored session identifiers belonged to a previous app/context:
  - Old session key: `feishu:oc_f674c3ebd9418a93f797ec9a56ce7e9b:ou_acd2260eb282d1359a7c70133d9a059d`.
  - `cc-connect.exe send` to the old session failed with Feishu `code=230002 msg=Bot/User can NOT be out of the chat`.
  - Direct API send to old `ou_acd...` failed with Feishu `code=99992361 msg=open_id cross app`.
- Current app visible users from `contact/v3/scopes` included:
  - `ou_c89ae4c66d6445c72ebf8ef2fa113e84`
  - `ou_2168b8082cbd37d5743af0780cc12263`
  - `ou_cbf107a6946ef213ff5be223dea15ef1`
- Direct Feishu API sends to all three current-app open_ids succeeded. User confirmed receiving the message for suffix `113e84`.
- Current user for this app was therefore confirmed as `ou_c89ae4c66d6445c72ebf8ef2fa113e84`, with private chat_id `oc_2340ab71b4291e4ade0cd15aa3720b30`.

### Verification Results
- User replied `ping-113e84` in Feishu private chat.
- Service log showed:
  - raw Feishu event `im.message.receive_v1`
  - `feishu: inbound message`
  - `feishu: routed inbound message`
  - `message received`
  - `processing message`
  - new session spawned for `feishu:oc_2340ab71b4291e4ade0cd15aa3720b30:ou_c89ae4c66d6445c72ebf8ef2fa113e84`
- Session file `F:\development\cc-connect-service\data\sessions\cc-connect-fork.json` now contains new session `s2`.
- Agent completed the turn and replied:
  - `pong-113e84`
  - service log showed `turn complete`, agent session `019ecf21-f149-70a1-b72d-1d08911aafad`
- `cc-connect.exe send` to the new current-app session succeeded with `Message sent successfully`.

### Conclusion
- Current private Feishu chain is working end to end: Feishu inbound event, cc-connect routing, Codex processing, and Feishu outbound send.
- Previous no-response behavior was not caused by cc-connect receiving and dropping messages. It was caused by stale session identifiers from a previous app/chat context plus the current bot not being in the old chat.
- For group chat use, the current `高级智能助手` bot for App ID `cli_a962f86e59f81cce` must be added to the target group, then tested again from that group.

### Follow-ups
- Keep temporary diagnostic log elevation in `platform/feishu/feishu.go` only until root cause work is closed; later decide whether to revert inbound/routed logs from `Info` to `Debug`.
- If group messages still fail after re-adding the current bot, check Feishu event delivery logs for `im.message.receive_v1` at the exact send time and verify the group chat_id belongs to the current app.
- Old session `s1` is stale for the current app context; avoid using it for send tests.

### Dropped Noise
- Repeated continuation prompts and raw long Feishu payloads were not preserved.
- Feishu app secret, local API token, tenant token, and any credential values were not recorded.
