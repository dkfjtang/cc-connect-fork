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
      chatType: "p2p",
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
  assert.match(result.reason, /Group messages require bot open_id|Group message does not mention bot/);
});

test("handleMessageReceive handles group text when bot is mentioned", async () => {
  const calls = [];
  const handler = new FeishuEventHandler({
    botOpenId: "ou_bot",
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
        chat_id: "oc_group",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({
          text: "@_user_1 帮我看项目状态",
          mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
        }),
      },
    },
  });

  assert.deepEqual(calls, [
    {
      messageId: "om_123",
      openId: "ou_123",
      chatId: "oc_group",
      chatType: "group",
      text: "帮我看项目状态",
    },
  ]);
  assert.deepEqual(result, { status: "handled", taskStatus: "completed" });
});

test("handleMessageReceive serializes messages in the same chat", async () => {
  const calls = [];
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  let firstCanFinish;
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async (message) => {
        calls.push(`start:${message.messageId}`);
        if (message.messageId === "om_1") {
          await new Promise((resolve) => {
            firstCanFinish = resolve;
            markFirstStarted();
          });
        }
        calls.push(`finish:${message.messageId}`);
        return { snapshot: () => ({ status: "completed" }) };
      },
    },
  });

  const first = handler.handleMessageReceive(textPayload({ messageId: "om_1", chatId: "oc_123" }));
  await firstStarted;
  const second = handler.handleMessageReceive(textPayload({ messageId: "om_2", chatId: "oc_123" }));
  await Promise.resolve();

  assert.deepEqual(calls, ["start:om_1"]);

  firstCanFinish();
  await Promise.all([first, second]);

  assert.deepEqual(calls, ["start:om_1", "finish:om_1", "start:om_2", "finish:om_2"]);
});

test("handleMessageReceive allows different chats to run concurrently", async () => {
  const calls = [];
  let firstCanFinish;
  const firstStarted = new Promise((resolve) => {
    firstCanFinish = resolve;
  });
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async (message) => {
        calls.push(`start:${message.messageId}`);
        if (message.messageId === "om_1") {
          await firstStarted;
        }
        calls.push(`finish:${message.messageId}`);
        return { snapshot: () => ({ status: "completed" }) };
      },
    },
  });

  const first = handler.handleMessageReceive(textPayload({ messageId: "om_1", chatId: "oc_1" }));
  await Promise.resolve();
  const second = handler.handleMessageReceive(textPayload({ messageId: "om_2", chatId: "oc_2" }));
  await second;

  assert.deepEqual(calls, ["start:om_1", "start:om_2", "finish:om_2"]);

  firstCanFinish();
  await first;

  assert.deepEqual(calls, ["start:om_1", "start:om_2", "finish:om_2", "finish:om_1"]);
});

test("handleMessageReceive uses cancel fast path without waiting for queued chat work", async () => {
  const calls = [];
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  let firstCanFinish;
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async (message) => {
        calls.push(`start:${message.messageId}`);
        await new Promise((resolve) => {
          firstCanFinish = resolve;
          markFirstStarted();
        });
        calls.push(`finish:${message.messageId}`);
        return { snapshot: () => ({ status: "completed" }) };
      },
      cancelActiveTask: async ({ chatId, reason }) => {
        calls.push(`cancel:${chatId}:${reason}`);
        return { status: "cancelled", taskStatus: "cancelled" };
      },
    },
  });

  const first = handler.handleMessageReceive(textPayload({ messageId: "om_1", chatId: "oc_123" }));
  await firstStarted;
  const cancel = await handler.handleMessageReceive(
    textPayload({ messageId: "om_2", chatId: "oc_123", text: "停止" }),
  );

  assert.deepEqual(calls, ["start:om_1", "cancel:oc_123:用户已停止任务"]);
  assert.deepEqual(cancel, { status: "cancelled", taskStatus: "cancelled" });

  firstCanFinish();
  await first;
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

test("handleMessageReceive skips message ids already marked by dedup store", async () => {
  const seen = new Set(["om_123"]);
  const handler = new FeishuEventHandler({
    messageDedupStore: {
      has: async (messageId) => seen.has(messageId),
      mark: async (messageId) => seen.add(messageId),
    },
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const result = await handler.handleMessageReceive(textPayload({ messageId: "om_123", chatId: "oc_123" }));

  assert.deepEqual(result, { status: "skipped", reason: "Duplicate Feishu message" });
});

test("handleMessageReceive marks message id in dedup store before handling", async () => {
  const calls = [];
  const handler = new FeishuEventHandler({
    messageDedupStore: {
      has: async (messageId) => {
        calls.push(`has:${messageId}`);
        return false;
      },
      mark: async (messageId) => {
        calls.push(`mark:${messageId}`);
      },
    },
    runtime: {
      handleTextMessage: async (message) => {
        calls.push(`handle:${message.messageId}`);
        return { snapshot: () => ({ status: "completed" }) };
      },
    },
  });

  await handler.handleMessageReceive(textPayload({ messageId: "om_123", chatId: "oc_123" }));

  assert.deepEqual(calls, ["has:om_123", "mark:om_123", "handle:om_123"]);
});

function textPayload({ messageId, chatId, text = "hello" }) {
  return {
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: messageId,
        chat_id: chatId,
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text }),
      },
    },
  };
}

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
