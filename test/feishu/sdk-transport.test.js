import assert from "node:assert/strict";
import { test } from "node:test";

import { FeishuSdkTransport } from "../../src/feishu/sdk-transport.js";

test("sendMessage calls Feishu SDK im.message.create", async () => {
  const calls = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({
      im: {
        message: {
          create: async (payload) => {
            calls.push(payload);
            return { data: { message_id: "om_123" } };
          },
        },
      },
    }),
  });

  const result = await transport.sendMessage({
    receiveIdType: "chat_id",
    receiveId: "oc_123",
    msgType: "interactive",
    content: "{\"config\":{}}",
  });

  assert.deepEqual(calls, [
    {
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        msg_type: "interactive",
        content: "{\"config\":{}}",
      },
    },
  ]);
  assert.deepEqual(result, { data: { message_id: "om_123" } });
});

test("patchMessageCard calls Feishu SDK im.message.patch with stringified card", async () => {
  const calls = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({
      im: {
        message: {
          patch: async (payload) => {
            calls.push(payload);
            return { data: {} };
          },
        },
      },
    }),
  });

  const result = await transport.patchMessageCard({
    messageId: "om_123",
    card: { config: { update_multi: true } },
  });

  assert.deepEqual(calls, [
    {
      path: { message_id: "om_123" },
      data: {
        content: JSON.stringify({ config: { update_multi: true } }),
      },
    },
  ]);
  assert.deepEqual(result, { data: {} });
});

test("sendCardKitMessage creates CardKit card and sends card instance message", async () => {
  const calls = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({
      cardkit: {
        v1: {
          card: {
            create: async (payload) => {
              calls.push({ method: "cardkit.card.create", payload });
              return { data: { card_id: "card_123" } };
            },
          },
        },
      },
      im: {
        message: {
          create: async (payload) => {
            calls.push({ method: "im.message.create", payload });
            return { data: { message_id: "om_123" } };
          },
        },
      },
    }),
  });

  const result = await transport.sendCardKitMessage({
    receiveIdType: "chat_id",
    receiveId: "oc_123",
    card: {
      config: { update_multi: true },
      header: { title: { tag: "plain_text", content: "任务已接收" } },
      elements: [
        {
          tag: "markdown",
          text: { tag: "lark_md", content: "Codex 正在处理..." },
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "停止" },
              value: { fcaAction: "approval.resolve", decision: "cancel" },
            },
          ],
        },
        { tag: "hr" },
        {
          tag: "note",
          elements: [{ tag: "lark_md", content: "状态: queued" }],
        },
      ],
    },
  });

  assert.equal(calls[0].method, "cardkit.card.create");
  assert.equal(calls[0].payload.data.type, "card_json");
  assert.deepEqual(JSON.parse(calls[0].payload.data.data), {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: { tag: "plain_text", content: "任务已接收" } },
    body: {
      elements: [
        {
          tag: "markdown",
          element_id: "fca_body",
          content: "Codex 正在处理...",
        },
        {
          tag: "action",
          element_id: "fca_actions",
          actions: [
            {
              tag: "button",
              element_id: "fca_action_0",
              text: { tag: "plain_text", content: "停止" },
              value: { fcaAction: "approval.resolve", decision: "cancel" },
            },
          ],
        },
        {
          tag: "hr",
          element_id: "fca_divider",
        },
        {
          tag: "note",
          element_id: "fca_footer",
          elements: [{ tag: "lark_md", content: "状态: queued" }],
        },
      ],
    },
  });
  assert.deepEqual(calls[1], {
    method: "im.message.create",
    payload: {
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_123",
        msg_type: "interactive",
        content: JSON.stringify({
          type: "card",
          data: { card_id: "card_123" },
        }),
      },
    },
  });
  assert.deepEqual(result, {
    data: {
      message_id: "om_123",
      card_id: "card_123",
      sequence: 1,
    },
  });
});

test("updateCardKitCard calls Feishu SDK CardKit full update with next sequence", async () => {
  const calls = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({
      cardkit: {
        v1: {
          card: {
            update: async (payload) => {
              calls.push(payload);
              return { data: {} };
            },
          },
        },
      },
    }),
  });

  const result = await transport.updateCardKitCard({
    cardId: "card_123",
    sequence: 4,
    card: {
      schema: "2.0",
      header: { title: { tag: "plain_text", content: "Codex 执行中" } },
      body: { elements: [{ tag: "markdown", content: "working" }] },
    },
  });

  assert.deepEqual(calls, [
    {
      path: { card_id: "card_123" },
      data: {
        card: {
          type: "card_json",
          data: JSON.stringify({
            schema: "2.0",
            header: { title: { tag: "plain_text", content: "Codex 执行中" } },
            body: { elements: [{ tag: "markdown", content: "working" }] },
          }),
        },
        sequence: 4,
      },
    },
  ]);
  assert.deepEqual(result, { data: { sequence: 4 } });
});

test("updateCardKitElementContent calls Feishu SDK CardKit content update", async () => {
  const calls = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({
      cardkit: {
        v1: {
          cardElement: {
            content: async (payload) => {
              calls.push(payload);
              return { data: {} };
            },
          },
        },
      },
    }),
  });

  const result = await transport.updateCardKitElementContent({
    cardId: "card_123",
    elementId: "fca_body",
    sequence: 4,
    content: "流式正文更新",
  });

  assert.deepEqual(calls, [
    {
      path: {
        card_id: "card_123",
        element_id: "fca_body",
      },
      data: {
        content: "流式正文更新",
        sequence: 4,
      },
    },
  ]);
  assert.deepEqual(result, { data: { sequence: 4 } });
});

test("sendCardKitMessage preserves existing CardKit element ids", async () => {
  const calls = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({
      cardkit: {
        v1: {
          card: {
            create: async (payload) => {
              calls.push({ method: "cardkit.card.create", payload });
              return { data: { card_id: "card_123" } };
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: "om_123" } }),
        },
      },
    }),
  });

  await transport.sendCardKitMessage({
    receiveIdType: "chat_id",
    receiveId: "oc_123",
    card: {
      schema: "2.0",
      body: {
        elements: [
          {
            tag: "markdown",
            element_id: "custom_body",
            content: "existing cardkit content",
          },
        ],
      },
    },
  });

  assert.equal(JSON.parse(calls[0].payload.data.data).body.elements[0].element_id, "custom_body");
});

test("probeBot returns bot open id and name from Feishu ping API", async () => {
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({
      request: async (payload) => {
        assert.deepEqual(payload, {
          method: "POST",
          url: "/open-apis/bot/v1/openclaw_bot/ping",
          data: { needBotInfo: true },
        });
        return {
          code: 0,
          data: {
            pingBotInfo: {
              botID: "ou_bot",
              botName: "Codex",
            },
          },
        };
      },
    }),
  });

  assert.deepEqual(await transport.probeBot(), {
    ok: true,
    appId: "cli_123",
    botOpenId: "ou_bot",
    botName: "Codex",
  });
});

test("startMessageListener registers receive handler and starts WS client", async () => {
  const calls = [];
  const logEntries = [];
  let registeredHandlers;
  let dispatcher;
  class FakeEventDispatcher {
    constructor(options) {
      calls.push({ type: "dispatcher", options });
    }

    register(handlers) {
      registeredHandlers = handlers;
      calls.push({ type: "register", handlers });
    }
  }
  class FakeWsClient {
    constructor(options) {
      calls.push({ type: "ws", options });
    }

    async start(options) {
      calls.push({ type: "start", options });
    }
  }
  const messages = [];
  const cardActions = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    verificationToken: "token",
    encryptKey: "encrypt",
    createClient: () => ({}),
    createEventDispatcher: (options) => {
      dispatcher = new FakeEventDispatcher(options);
      return dispatcher;
    },
    createWsClient: (options) => new FakeWsClient(options),
    logger: fakeLogger(logEntries),
  });

  await transport.startMessageListener({
    onMessageReceive: async (payload) => {
      messages.push(payload);
    },
    onCardAction: async (payload) => {
      cardActions.push(payload);
    },
  });
  await registeredHandlers["im.message.receive_v1"]({ event: { message: { message_id: "om_123" } } });
  await registeredHandlers["card.action.trigger"]({ event: { action: { value: { fcaAction: "approval.resolve" } } } });

  assert.equal(calls[0].type, "dispatcher");
  assert.deepEqual(calls[0].options, {
    verificationToken: "token",
    encryptKey: "encrypt",
  });
  assert.equal(calls[1].type, "register");
  assert.equal(calls[2].type, "ws");
  assert.deepEqual(calls[2].options, {
    appId: "cli_123",
    appSecret: "secret",
  });
  assert.equal(calls[3].type, "start");
  assert.equal(calls[3].options.eventDispatcher, dispatcher);
  assert.deepEqual(messages, [{ event: { message: { message_id: "om_123" } } }]);
  assert.deepEqual(cardActions, [{ event: { action: { value: { fcaAction: "approval.resolve" } } } }]);
  assert.deepEqual(
    logEntries.map((entry) => entry.event),
    [
      "feishu.ws_starting",
      "feishu.ws_dispatcher_created",
      "feishu.ws_handlers_registered",
      "feishu.ws_client_created",
      "feishu.ws_started",
      "feishu.event_received",
      "feishu.event_received",
    ],
  );
  assert.deepEqual(logEntries.at(-2), {
    level: "info",
    event: "feishu.event_received",
    appId: "cli_123",
    eventType: "im.message.receive_v1",
    messageId: "om_123",
    chatId: null,
    chatType: null,
  });
});

test("startMessageListener logs handler failures without message content", async () => {
  const logEntries = [];
  let registeredHandlers;
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({}),
    createEventDispatcher: () => ({
      register: (handlers) => {
        registeredHandlers = handlers;
      },
    }),
    createWsClient: () => ({
      start: async () => {},
    }),
    logger: fakeLogger(logEntries),
  });

  await transport.startMessageListener({
    onMessageReceive: async () => {
      throw new Error("handler failed");
    },
  });

  await assert.rejects(
    () =>
      registeredHandlers["im.message.receive_v1"]({
        event: {
          message: {
            message_id: "om_123",
            chat_id: "oc_123",
            chat_type: "p2p",
            content: JSON.stringify({ text: "secret text" }),
          },
        },
      }),
    /handler failed/,
  );

  assert.deepEqual(logEntries.at(-1), {
    level: "error",
    event: "feishu.event_handler_failed",
    appId: "cli_123",
    eventType: "im.message.receive_v1",
    messageId: "om_123",
    chatId: "oc_123",
    chatType: "p2p",
    errorSummary: "handler failed",
    errorName: "Error",
  });
  assert.equal(JSON.stringify(logEntries).includes("secret text"), false);
});

test("startMessageListener logs websocket start failures", async () => {
  const logEntries = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({}),
    createEventDispatcher: () => ({
      register: () => {},
    }),
    createWsClient: () => ({
      start: async () => {
        throw new Error("ws unavailable");
      },
    }),
    logger: fakeLogger(logEntries),
  });

  await assert.rejects(
    () =>
      transport.startMessageListener({
        onMessageReceive: async () => {},
      }),
    /ws unavailable/,
  );

  assert.deepEqual(logEntries.at(-1), {
    level: "error",
    event: "feishu.ws_start_failed",
    appId: "cli_123",
    errorSummary: "ws unavailable",
    errorName: "Error",
  });
});

test("startMessageListener closes WS client when start fails", async () => {
  const calls = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({}),
    createEventDispatcher: () => ({
      register: () => {},
    }),
    createWsClient: () => ({
      start: async () => {
        calls.push("start");
        throw new Error("ws unavailable");
      },
      close: async (params = {}) => {
        calls.push({ type: "close", params });
      },
    }),
  });

  await assert.rejects(
    () =>
      transport.startMessageListener({
        onMessageReceive: async () => {},
      }),
    /ws unavailable/,
  );
  assert.deepEqual(calls, ["start", { type: "close", params: {} }]);

  await transport.stop();

  assert.deepEqual(calls, ["start", { type: "close", params: {} }]);
});

test("startMessageListener preserves start failure when cleanup close fails", async () => {
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({}),
    createEventDispatcher: () => ({
      register: () => {},
    }),
    createWsClient: () => ({
      start: async () => {
        throw new Error("ws unavailable");
      },
      close: async () => {
        throw new Error("close failed");
      },
    }),
  });

  await assert.rejects(
    () =>
      transport.startMessageListener({
        onMessageReceive: async () => {},
      }),
    /ws unavailable/,
  );
});

test("stop closes started WS client", async () => {
  const calls = [];
  const logEntries = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({}),
    createEventDispatcher: () => ({
      register: () => {},
    }),
    createWsClient: () => ({
      start: async () => {
        calls.push("start");
      },
      close: async (params = {}) => {
        calls.push({ type: "close", params });
      },
    }),
    logger: fakeLogger(logEntries),
  });

  await transport.startMessageListener({
    onMessageReceive: async () => {},
  });
  await transport.stop();

  assert.deepEqual(calls, ["start", { type: "close", params: {} }]);
  assert.equal(logEntries.some((entry) => entry.event === "feishu.ws_stopped"), true);
});

test("stop logs and propagates WS close failures", async () => {
  const logEntries = [];
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({}),
    createEventDispatcher: () => ({
      register: () => {},
    }),
    createWsClient: () => ({
      start: async () => {},
      close: async () => {
        throw new Error("close failed");
      },
    }),
    logger: fakeLogger(logEntries),
  });

  await transport.startMessageListener({
    onMessageReceive: async () => {},
  });

  await assert.rejects(() => transport.stop(), /close failed/);

  assert.deepEqual(logEntries.at(-1), {
    level: "error",
    event: "feishu.ws_stop_failed",
    appId: "cli_123",
    errorSummary: "close failed",
    errorName: "Error",
  });
});

test("startMessageListener closes previous WS client before replacing it", async () => {
  const calls = [];
  let wsId = 0;
  const transport = new FeishuSdkTransport({
    appId: "cli_123",
    appSecret: "secret",
    createClient: () => ({}),
    createEventDispatcher: () => ({
      register: () => {},
    }),
    createWsClient: () => {
      wsId += 1;
      const id = wsId;
      calls.push(`create:${id}`);
      return {
        start: async () => {
          calls.push(`start:${id}`);
        },
        close: async (params = {}) => {
          calls.push({ type: "close", id, params });
        },
      };
    },
  });

  await transport.startMessageListener({
    onMessageReceive: async () => {},
  });
  await transport.startMessageListener({
    onMessageReceive: async () => {},
  });

  assert.deepEqual(calls, [
    "create:1",
    "start:1",
    { type: "close", id: 1, params: {} },
    "create:2",
    "start:2",
  ]);
});

test("constructor requires app credentials", () => {
  assert.throws(
    () =>
      new FeishuSdkTransport({
        appId: "",
        appSecret: "secret",
        createClient: () => ({}),
      }),
    /FeishuSdkTransport requires FEISHU_APP_ID and FEISHU_APP_SECRET/,
  );
});

function fakeLogger(entries) {
  return {
    info: (event, fields) => entries.push({ level: "info", event, ...fields }),
    error: (event, fields) => entries.push({ level: "error", event, ...fields }),
  };
}
