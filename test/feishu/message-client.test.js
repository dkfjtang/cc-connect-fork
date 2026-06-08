import assert from "node:assert/strict";
import { test } from "node:test";

import { FeishuMessageClient } from "../../src/feishu/message-client.js";

test("sendAction sends an interactive card message", async () => {
  const calls = [];
  const client = new FeishuMessageClient({
    transport: {
      sendMessage: async (payload) => {
        calls.push({ method: "sendMessage", payload });
        return { data: { message_id: "om_123" } };
      },
    },
  });

  const result = await client.sendAction({
    type: "send",
    receiveIdType: "chat_id",
    receiveId: "oc_123",
    messageType: "interactive",
    card: { header: { title: { content: "任务已接收" } } },
  });

  assert.deepEqual(calls, [
    {
      method: "sendMessage",
      payload: {
        receiveIdType: "chat_id",
        receiveId: "oc_123",
        msgType: "interactive",
        content: JSON.stringify({ header: { title: { content: "任务已接收" } } }),
      },
    },
  ]);
  assert.deepEqual(result, { messageId: "om_123", cardChannel: "im", cardId: null, cardSequence: null });
});

test("sendAction can send CardKit card when configured", async () => {
  const calls = [];
  const client = new FeishuMessageClient({
    cardChannel: "cardkit",
    transport: {
      sendCardKitMessage: async (payload) => {
        calls.push({ method: "sendCardKitMessage", payload });
        return { data: { message_id: "om_cardkit", card_id: "card_123", sequence: 1 } };
      },
      sendMessage: async () => {
        throw new Error("should not use IM fallback");
      },
    },
  });

  const result = await client.sendAction({
    type: "send",
    receiveIdType: "chat_id",
    receiveId: "oc_123",
    messageType: "interactive",
    card: { header: { title: { content: "任务已接收" } } },
  });

  assert.deepEqual(calls, [
    {
      method: "sendCardKitMessage",
      payload: {
        receiveIdType: "chat_id",
        receiveId: "oc_123",
        card: { header: { title: { content: "任务已接收" } } },
      },
    },
  ]);
  assert.deepEqual(result, {
    messageId: "om_cardkit",
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 1,
  });
});

test("sendAction falls back to IM card when CardKit send fails", async () => {
  const calls = [];
  const logEntries = [];
  const client = new FeishuMessageClient({
    cardChannel: "cardkit",
    logger: fakeLogger(logEntries),
    transport: {
      sendCardKitMessage: async (payload) => {
        calls.push({ method: "sendCardKitMessage", payload });
        throw new Error("cardkit unavailable");
      },
      sendMessage: async (payload) => {
        calls.push({ method: "sendMessage", payload });
        return { data: { message_id: "om_im" } };
      },
    },
  });

  const card = { header: { title: { content: "任务已接收" } } };
  const result = await client.sendAction({
    type: "send",
    receiveIdType: "chat_id",
    receiveId: "oc_123",
    messageType: "interactive",
    card,
  });

  assert.equal(calls[0].method, "sendCardKitMessage");
  assert.deepEqual(calls[1], {
    method: "sendMessage",
    payload: {
      receiveIdType: "chat_id",
      receiveId: "oc_123",
      msgType: "interactive",
      content: JSON.stringify(card),
    },
  });
  assert.deepEqual(result, { messageId: "om_im", cardChannel: "im", cardId: null, cardSequence: null });
  assert.deepEqual(logEntries, [
    {
      level: "warn",
      event: "feishu.cardkit_fallback",
      actionType: "send",
      reason: "cardkit_send_failed",
      errorSummary: "Feishu send failed: cardkit unavailable",
      errorName: "FeishuApiError",
    },
  ]);
  assert.equal(JSON.stringify(logEntries).includes("任务已接收"), false);
});

test("sendAction logs IM fallback when CardKit transport is missing", async () => {
  const logEntries = [];
  const client = new FeishuMessageClient({
    cardChannel: "cardkit",
    logger: fakeLogger(logEntries),
    transport: {
      sendMessage: async () => ({ data: { message_id: "om_im" } }),
    },
  });

  const result = await client.sendAction({
    type: "send",
    receiveIdType: "chat_id",
    receiveId: "oc_123",
    messageType: "interactive",
    card: { header: { title: { content: "任务已接收" } } },
  });

  assert.equal(result.cardChannel, "im");
  assert.deepEqual(logEntries, [
    {
      level: "warn",
      event: "feishu.cardkit_fallback",
      actionType: "send",
      reason: "cardkit_transport_missing",
    },
  ]);
});

test("sendAction updates an existing card message", async () => {
  const calls = [];
  const client = new FeishuMessageClient({
    transport: {
      patchMessageCard: async (payload) => {
        calls.push({ method: "patchMessageCard", payload });
        return { data: {} };
      },
    },
  });

  const result = await client.sendAction({
    type: "update",
    messageId: "om_123",
    card: { header: { title: { content: "Codex 执行中" } } },
  });

  assert.deepEqual(calls, [
    {
      method: "patchMessageCard",
      payload: {
        messageId: "om_123",
        card: { header: { title: { content: "Codex 执行中" } } },
      },
    },
  ]);
  assert.deepEqual(result, { cardChannel: "im", cardId: null, cardSequence: null });
});

test("sendAction can update CardKit card metadata", async () => {
  const calls = [];
  const client = new FeishuMessageClient({
    transport: {
      updateCardKitCard: async (payload) => {
        calls.push({ method: "updateCardKitCard", payload });
        return { data: { sequence: 4 } };
      },
      patchMessageCard: async () => {
        throw new Error("should not use IM fallback");
      },
    },
  });

  const card = { header: { title: { content: "Codex 执行中" } } };
  const result = await client.sendAction({
    type: "update",
    messageId: "om_123",
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 3,
    card,
  });

  assert.deepEqual(calls, [
    {
      method: "updateCardKitCard",
      payload: {
        cardId: "card_123",
        sequence: 4,
        card,
      },
    },
  ]);
  assert.deepEqual(result, {
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 4,
  });
});

test("sendAction updates CardKit body content before full card update", async () => {
  const calls = [];
  const client = new FeishuMessageClient({
    transport: {
      updateCardKitElementContent: async (payload) => {
        calls.push({ method: "updateCardKitElementContent", payload });
        return { data: { sequence: 4 } };
      },
      updateCardKitCard: async () => {
        throw new Error("should not use full update");
      },
      patchMessageCard: async () => {
        throw new Error("should not use IM fallback");
      },
    },
  });

  const result = await client.sendAction({
    type: "update",
    messageId: "om_123",
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 3,
    taskStatus: "running",
    card: {
      elements: [
        {
          tag: "markdown",
          text: { tag: "lark_md", content: "流式正文更新" },
        },
      ],
    },
  });

  assert.deepEqual(calls, [
    {
      method: "updateCardKitElementContent",
      payload: {
        cardId: "card_123",
        elementId: "fca_body",
        sequence: 4,
        content: "流式正文更新",
      },
    },
  ]);
  assert.deepEqual(result, {
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 4,
  });
});

test("sendAction uses CardKit full update for non-running task states", async () => {
  const calls = [];
  const client = new FeishuMessageClient({
    transport: {
      updateCardKitElementContent: async () => {
        throw new Error("should not use body content update for terminal state");
      },
      updateCardKitCard: async (payload) => {
        calls.push({ method: "updateCardKitCard", payload });
        return { data: { sequence: 4 } };
      },
      patchMessageCard: async () => {
        throw new Error("should not use IM fallback");
      },
    },
  });

  const result = await client.sendAction({
    type: "update",
    messageId: "om_123",
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 3,
    taskStatus: "completed",
    card: {
      elements: [
        {
          tag: "markdown",
          text: { tag: "lark_md", content: "最终回复" },
        },
      ],
    },
  });

  assert.equal(calls[0].method, "updateCardKitCard");
  assert.deepEqual(result, {
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 4,
  });
});

test("sendAction falls back to CardKit full update when body content update fails", async () => {
  const calls = [];
  const logEntries = [];
  const client = new FeishuMessageClient({
    logger: fakeLogger(logEntries),
    transport: {
      updateCardKitElementContent: async (payload) => {
        calls.push({ method: "updateCardKitElementContent", payload });
        throw new Error("content update failed");
      },
      updateCardKitCard: async (payload) => {
        calls.push({ method: "updateCardKitCard", payload });
        return { data: { sequence: 4 } };
      },
      patchMessageCard: async () => {
        throw new Error("should not use IM fallback");
      },
    },
  });

  const result = await client.sendAction({
    type: "update",
    messageId: "om_123",
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 3,
    taskStatus: "running",
    card: {
      elements: [
        {
          tag: "markdown",
          text: { tag: "lark_md", content: "secret body should not be logged" },
        },
      ],
    },
  });

  assert.equal(calls[0].method, "updateCardKitElementContent");
  assert.equal(calls[1].method, "updateCardKitCard");
  assert.deepEqual(result, {
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 4,
  });
  assert.deepEqual(logEntries, [
    {
      level: "warn",
      event: "feishu.cardkit_fallback",
      actionType: "update",
      reason: "cardkit_content_update_failed",
      messageId: "om_123",
      cardId: "card_123",
      elementId: "fca_body",
      errorSummary: "Feishu update failed: content update failed",
      errorName: "FeishuApiError",
    },
  ]);
  assert.equal(JSON.stringify(logEntries).includes("secret body"), false);
});

test("sendAction falls back to IM patch when CardKit update fails", async () => {
  const calls = [];
  const logEntries = [];
  const client = new FeishuMessageClient({
    logger: fakeLogger(logEntries),
    transport: {
      updateCardKitCard: async (payload) => {
        calls.push({ method: "updateCardKitCard", payload });
        throw new Error("cardkit update failed");
      },
      patchMessageCard: async (payload) => {
        calls.push({ method: "patchMessageCard", payload });
        return { data: {} };
      },
    },
  });

  const card = { header: { title: { content: "Codex 执行中" } } };
  const result = await client.sendAction({
    type: "update",
    messageId: "om_123",
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 3,
    card,
  });

  assert.equal(calls[0].method, "updateCardKitCard");
  assert.deepEqual(calls[1], {
    method: "patchMessageCard",
    payload: {
      messageId: "om_123",
      card,
    },
  });
  assert.deepEqual(result, { cardChannel: "im", cardId: null, cardSequence: null });
  assert.deepEqual(logEntries, [
    {
      level: "warn",
      event: "feishu.cardkit_fallback",
      actionType: "update",
      reason: "cardkit_update_failed",
      messageId: "om_123",
      cardId: "card_123",
      errorSummary: "Feishu update failed: cardkit update failed",
      errorName: "FeishuApiError",
    },
  ]);
  assert.equal(JSON.stringify(logEntries).includes("Codex 执行中"), false);
});

test("sendTextMessage sends a plain text chat message", async () => {
  const calls = [];
  const client = new FeishuMessageClient({
    transport: {
      sendMessage: async (payload) => {
        calls.push({ method: "sendMessage", payload });
        return { data: { message_id: "om_text" } };
      },
    },
  });

  const result = await client.sendTextMessage({
    chatId: "oc_123",
    text: "暂不支持文件消息。",
  });

  assert.deepEqual(calls, [
    {
      method: "sendMessage",
      payload: {
        receiveIdType: "chat_id",
        receiveId: "oc_123",
        msgType: "text",
        content: JSON.stringify({ text: "暂不支持文件消息。" }),
      },
    },
  ]);
  assert.deepEqual(result, { messageId: "om_text" });
});

test("sendTextMessage requires a chat id", async () => {
  const client = new FeishuMessageClient({ transport: {} });

  await assert.rejects(
    () => client.sendTextMessage({ text: "hello" }),
    /chatId is required/,
  );
});

test("sendAction rejects unsupported action type", async () => {
  const client = new FeishuMessageClient({
    transport: {},
  });

  await assert.rejects(
    () => client.sendAction({ type: "delete" }),
    /Unsupported Feishu action type: delete/,
  );
});

test("sendAction normalizes Feishu API error responses", async () => {
  const client = new FeishuMessageClient({
    transport: {
      sendMessage: async () => ({
        code: 99991663,
        msg: "frequency limited",
      }),
    },
  });

  await assert.rejects(
    () =>
      client.sendAction({
        type: "send",
        receiveIdType: "chat_id",
        receiveId: "oc_123",
        messageType: "interactive",
        card: { config: {} },
      }),
    (error) => {
      assert.equal(error.name, "FeishuApiError");
      assert.equal(error.code, 99991663);
      assert.equal(error.actionType, "send");
      assert.match(error.message, /Feishu send failed/);
      assert.match(error.message, /99991663/);
      assert.match(error.message, /frequency limited/);
      return true;
    },
  );
});

test("sendAction normalizes thrown transport errors", async () => {
  const client = new FeishuMessageClient({
    transport: {
      patchMessageCard: async () => {
        throw new Error("network reset");
      },
    },
  });

  await assert.rejects(
    () =>
      client.sendAction({
        type: "update",
        messageId: "om_123",
        card: { config: {} },
      }),
    (error) => {
      assert.equal(error.name, "FeishuApiError");
      assert.equal(error.actionType, "update");
      assert.equal(error.cause.message, "network reset");
      assert.match(error.message, /Feishu update failed/);
      assert.match(error.message, /network reset/);
      return true;
    },
  );
});

function fakeLogger(entries) {
  return {
    warn: (event, fields) => entries.push({ level: "warn", event, ...fields }),
  };
}
