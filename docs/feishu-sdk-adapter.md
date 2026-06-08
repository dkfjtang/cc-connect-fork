# 飞书 SDK 适配层

## 目标

飞书 SDK 适配层负责把 fca 内部的消息动作转换成飞书 SDK 或 HTTP API 调用。业务层只处理 SDK 无关的 action，不直接依赖飞书 SDK 包。

```text
TaskCardController
  -> FeishuMessageClient
  -> Feishu SDK transport
  -> 飞书消息 API
```

## 当前边界

已落地：

- `FeishuMessageClient.sendAction(action)`。
- `send` action 转换为发送 interactive 消息。
- `update` action 转换为更新已发送消息卡片。
- transport 通过依赖注入提供，便于测试和后续替换 SDK。
- `FCA_CARD_CHANNEL=cardkit` 时，`FeishuMessageClient` 会优先调用 CardKit transport 方法；方法缺失或调用失败会回退普通 IM 卡片。
- `FeishuSdkTransport` 使用 `@larksuiteoapi/node-sdk` 调用飞书消息 API。
- `FeishuSdkTransport.probeBot()` 通过 bot ping API 探测 bot open_id，用于自回声过滤。
- `FeishuSdkTransport.startMessageListener()` 使用飞书 SDK `EventDispatcher` 和 `WSClient` 监听 `im.message.receive_v1`。
- `FeishuSdkTransport.startMessageListener()` 已输出 WebSocket 启动、dispatcher 注册、入站事件收到和 handler 失败的结构化日志。

## transport 接口

```js
{
  sendMessage: async ({
    receiveIdType,
    receiveId,
    msgType,
    content,
  }) => ({ data: { message_id: "om_xxx" } }),

  patchMessageCard: async ({
    messageId,
    card,
  }) => ({ data: {} }),

  // Optional. Used only when FCA_CARD_CHANNEL=cardkit.
  sendCardKitMessage: async ({
    receiveIdType,
    receiveId,
    card,
  }) => ({ data: { message_id: "om_xxx", card_id: "card_xxx", sequence: 1 } }),

  // Optional. Used only for cards previously sent through CardKit.
  updateCardKitCard: async ({
    cardId,
    sequence,
    card,
  }) => ({ data: { sequence } }),

  // Optional. Updates the stable body markdown element with CardKit typewriter effect.
  updateCardKitElementContent: async ({
    cardId,
    elementId,
    sequence,
    content,
  }) => ({ data: { sequence } }),

  startMessageListener: async ({
    onMessageReceive,
    onCardAction,
  }) => {},

  stop: async () => {},
}
```

## 长连接可观测性

`FeishuSdkTransport` 和 `FeishuMessageClient` 接收可选 `logger`，并通过 `runDev` 与 runtime 共用同一个 JSONL logger。

当前事件：

- `feishu.ws_starting`
- `feishu.ws_dispatcher_created`
- `feishu.ws_handlers_registered`
- `feishu.ws_client_created`
- `feishu.ws_started`
- `feishu.ws_start_failed`
- `feishu.ws_cleanup_failed`
- `feishu.ws_stopped`
- `feishu.ws_stop_failed`
- `feishu.event_received`
- `feishu.event_handler_failed`
- `feishu.cardkit_fallback`
- `bridge.shutdown_requested`
- `bridge.stopped`
- `bridge.shutdown_failed`

日志只记录 `appId`、事件类型、`message_id`、`chat_id`、`chat_type`、CardKit 回退原因和错误摘要；不记录 `appSecret`、verification token、encrypt key、消息正文、卡片 payload 或完整事件 payload。

`FeishuSdkTransport.startMessageListener()` 重建 listener 前会先关闭旧 `WSClient`，避免重复长连接残留；如果新 `WSClient.start()` 失败，也会 best-effort 关闭半初始化 client，且保留原始启动失败向上抛出。

`runDev` 会注册 `SIGINT` / `SIGTERM` 退出信号。收到信号后，Bridge 先停止 Codex app-server，再 best-effort 调用 transport `stop()`；SDK transport 会通过 `WSClient.close({})` 关闭已启动的长连接，并记录关闭成功或失败。停机失败会记录 `bridge.shutdown_failed`、首个错误摘要和 `failedResources`，但不会输出额外敏感信息。

## 卡片更新重试

`TaskCardController` 会串行化同一卡片的 send / update，并对可重试错误做有限重试。

当前策略：

- 飞书限频错误 `99991663` 使用更长的指数退避，默认从 1000ms 开始。
- 无明确飞书错误码的 transport / 网络异常沿用普通短退避。
- 带明确飞书业务错误码且非限频的错误不重试，避免无效 payload 或权限错误反复打 API。

## 卡片尺寸保护

`TaskCardRenderer` 会在渲染阶段收敛卡片正文和 footer 字段：

- 正文摘要和最终回复会截断到固定上限。
- footer 中的 model、版本、错误类型等字段会单项截断。
- 工作目录超长时只保留短路径尾部并截断，避免长路径撑爆卡片 payload。

## 发送卡片

输入 action：

```js
{
  type: "send",
  receiveIdType: "chat_id",
  receiveId: "oc_xxx",
  messageType: "interactive",
  card: {}
}
```

transport payload：

```js
{
  receiveIdType: "chat_id",
  receiveId: "oc_xxx",
  msgType: "interactive",
  content: JSON.stringify(card)
}
```

返回值：

```js
{ messageId: "om_xxx", cardChannel: "im" }
```

当 `FCA_CARD_CHANNEL=cardkit` 且 transport 提供 `sendCardKitMessage` 时，会先尝试 CardKit：

```js
{
  receiveIdType: "chat_id",
  receiveId: "oc_xxx",
  card
}
```

成功返回：

```js
{
  messageId: "om_xxx",
  cardChannel: "cardkit",
  cardId: "card_xxx",
  cardSequence: 1
}
```

## 更新卡片

输入 action：

```js
{
  type: "update",
  messageId: "om_xxx",
  cardChannel: "cardkit",
  cardId: "card_xxx",
  cardSequence: 1,
  card: {}
}
```

transport payload：

```js
{
  messageId: "om_xxx",
  card
}
```

返回值：

```js
{ cardChannel: "im" }
```

如果 action 带有 `cardChannel=cardkit`、`cardId`，且 transport 提供 CardKit 更新方法，会先尝试 `updateCardKitElementContent` 更新稳定正文元素 `fca_body`，以使用 CardKit 的打字机效果；正文局部更新不可用或失败时，继续尝试 `updateCardKitCard` 全量更新，并用 `cardSequence + 1` 作为下一次更新序号。CardKit send / update 方法缺失或失败时，会记录 `feishu.cardkit_fallback`，回退到 `sendMessage` / `patchMessageCard`；update 回退还会把 task 中保存的 `cardChannel` 降级为 `im`，避免后续继续依赖不可用的 CardKit 通道。

## CardKit element id

CardKit 转换层会为 legacy IM card 元素补稳定 `element_id`：

- 正文 markdown：`fca_body`
- 审批按钮区：`fca_actions`
- 审批按钮：`fca_action_0`、`fca_action_1` 等
- 分隔线：`fca_divider`
- footer note：`fca_footer`

已有 `element_id` 不会被覆盖。当前 CardKit update 会优先使用 `fca_body` 做 element content 局部更新；其它元素仍走全量卡片更新。

## 后续接入点

- 继续评估 footer / action 等非正文元素的 CardKit 局部更新。
- 增加长连接断线和重连策略评估。
