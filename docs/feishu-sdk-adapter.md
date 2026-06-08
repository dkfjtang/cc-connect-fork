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

  startMessageListener: async ({
    onMessageReceive,
    onCardAction,
  }) => {},
}
```

## 长连接可观测性

`FeishuSdkTransport` 接收可选 `logger`，并通过 `runDev` 与 runtime 共用同一个 JSONL logger。

当前事件：

- `feishu.ws_starting`
- `feishu.ws_dispatcher_created`
- `feishu.ws_handlers_registered`
- `feishu.ws_client_created`
- `feishu.ws_started`
- `feishu.ws_start_failed`
- `feishu.event_received`
- `feishu.event_handler_failed`

日志只记录 `appId`、事件类型、`message_id`、`chat_id`、`chat_type` 和错误摘要；不记录 `appSecret`、verification token、encrypt key、消息正文或完整事件 payload。

## 卡片更新重试

`TaskCardController` 会串行化同一卡片的 send / update，并对可重试错误做有限重试。

当前策略：

- 飞书限频错误 `99991663` 使用更长的指数退避，默认从 1000ms 开始。
- 无明确飞书错误码的 transport / 网络异常沿用普通短退避。
- 带明确飞书业务错误码且非限频的错误不重试，避免无效 payload 或权限错误反复打 API。

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
{ messageId: "om_xxx" }
```

## 更新卡片

输入 action：

```js
{
  type: "update",
  messageId: "om_xxx",
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
{}
```

## 后续接入点

- 增加长连接断线、重连和退出信号治理。
- 增加消息长度和卡片 payload 尺寸保护。
