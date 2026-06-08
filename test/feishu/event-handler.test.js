import assert from "node:assert/strict";
import { test } from "node:test";

import { FeishuEventHandler } from "../../src/feishu/event-handler.js";

test("handleMessageReceive passes parsed text message to bridge runtime", async () => {
  const calls = [];
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async (message) => {
        calls.push(message);
        return { snapshot: () => ({ status: "completed" }) };
      },
    },
  });

  const result = await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });

  assert.deepEqual(calls, [
    {
      messageId: "om_123",
      openId: "ou_123",
      chatId: "oc_123",
      text: "hello",
    },
  ]);
  assert.deepEqual(result, { status: "handled", taskStatus: "completed" });
});

test("handleMessageReceive skips unsupported events", async () => {
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const result = await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });

  assert.equal(result.status, "skipped");
  assert.match(result.reason, /Only private chat messages/);
});

test("handleMessageReceive skips duplicate message ids", async () => {
  let calls = 0;
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        calls += 1;
        return { snapshot: () => ({ status: "completed" }) };
      },
    },
  });
  const payload = {
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  };

  const first = await handler.handleMessageReceive(payload);
  const second = await handler.handleMessageReceive(payload);

  assert.equal(calls, 1);
  assert.deepEqual(first, { status: "handled", taskStatus: "completed" });
  assert.deepEqual(second, { status: "skipped", reason: "Duplicate Feishu message" });
});

test("handleMessageReceive skips stale replayed messages", async () => {
  const handler = new FeishuEventHandler({
    now: () => 1_700_000_120_000,
    maxEventAgeMs: 60_000,
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const result = await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        create_time: "1700000000000",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Feishu message is stale" });
});

test("handleMessageReceive skips self-echo messages from configured bot open id", async () => {
  const handler = new FeishuEventHandler({
    botOpenId: "ou_bot",
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const result = await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_bot" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Self-echo Feishu message" });
});

test("handleMessageReceive skips events for a different Feishu app id", async () => {
  const handler = new FeishuEventHandler({
    expectedAppId: "cli_a",
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const result = await handler.handleMessageReceive({
    app_id: "cli_b",
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Feishu app_id mismatch" });
});

test("handleMessageReceive propagates runtime errors", async () => {
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        throw new Error("Codex failed");
      },
    },
  });

  await assert.rejects(
    () =>
      handler.handleMessageReceive({
        event: {
          sender: { sender_id: { open_id: "ou_123" } },
          message: {
            message_id: "om_123",
            chat_id: "oc_123",
            chat_type: "p2p",
            message_type: "text",
            content: JSON.stringify({ text: "hello" }),
          },
        },
      }),
    /Codex failed/,
  );
});
