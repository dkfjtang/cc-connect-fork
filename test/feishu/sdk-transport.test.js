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
