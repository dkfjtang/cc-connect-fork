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

test("handleMessageReceive logs handled message gate result without message content", async () => {
  const logEntries = [];
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => ({ snapshot: () => ({ status: "completed" }) }),
    },
    logger: fakeLogger(logEntries),
    now: steppingClock(1000, 123),
  });

  await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "secret user task" }),
      },
    },
  });

  assert.deepEqual(logEntries.at(-1), {
    level: "info",
    event: "feishu.message_handled",
    messageId: "om_123",
    chatId: "oc_123",
    chatType: "p2p",
    resultStatus: "handled",
    durationMs: 123,
    taskStatus: "completed",
  });
  assert.equal(JSON.stringify(logEntries).includes("secret user task"), false);
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

test("handleMessageReceive logs skipped message gate result without raw content", async () => {
  const logEntries = [];
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not start Codex turn for file message");
      },
    },
    logger: fakeLogger(logEntries),
    now: steppingClock(2000, 75),
  });

  await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_file",
        chat_id: "oc_123",
        chat_type: "group",
        message_type: "file",
        content: JSON.stringify({ file_key: "file_secret", file_name: "secret.txt" }),
      },
    },
  });

  assert.deepEqual(logEntries.at(-1), {
    level: "info",
    event: "feishu.message_skipped",
    messageId: "om_file",
    chatId: "oc_123",
    chatType: "group",
    resultStatus: "skipped",
    durationMs: 75,
    reason: "Only text messages are supported",
  });
  assert.equal(JSON.stringify(logEntries).includes("file_secret"), false);
  assert.equal(JSON.stringify(logEntries).includes("secret.txt"), false);
});

test("handleMessageReceive replies unsupported notice for private non-text messages", async () => {
  const notices = [];
  const marked = [];
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not start Codex turn for file message");
      },
    },
    unsupportedMessageClient: {
      sendTextMessage: async (message) => {
        notices.push(message);
        return { messageId: "om_notice" };
      },
    },
    messageDedupStore: {
      has: async () => false,
      mark: async (messageId) => marked.push(messageId),
    },
  });

  const result = await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_file",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "file",
        content: JSON.stringify({ file_key: "file_secret", file_name: "secret.txt" }),
      },
    },
  });

  assert.deepEqual(result, { status: "handled", reason: "Unsupported Feishu message type notified" });
  assert.deepEqual(notices, [
    {
      chatId: "oc_123",
      text: "暂不支持文件、图片、文档或语音消息。请先发送文本任务；文件下载与回传能力将在后续版本开放。",
    },
  ]);
  assert.deepEqual(marked, ["om_file"]);
  assert.equal(JSON.stringify(notices).includes("secret.txt"), false);
  assert.equal(JSON.stringify(notices).includes("file_secret"), false);
});

test("handleMessageReceive deduplicates unsupported non-text notices", async () => {
  const notices = [];
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
    },
    unsupportedMessageClient: {
      sendTextMessage: async (message) => {
        notices.push(message);
        return { messageId: "om_notice" };
      },
    },
    messageDedupStore: {
      has: async (messageId) => messageId === "om_seen",
      mark: async () => {},
    },
  });

  const result = await handler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_seen",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "image",
        content: "{}",
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Duplicate Feishu message" });
  assert.deepEqual(notices, []);
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

test("handleMessageReceive skips mentioned group text when group chat is not allowed", async () => {
  const handler = new FeishuEventHandler({
    botOpenId: "ou_bot",
    allowedGroupChatIds: ["oc_allowed"],
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
      cancelActiveTask: async () => {
        throw new Error("should not cancel from denied group");
      },
    },
  });

  const result = await handler.handleMessageReceive(
    groupMentionPayload({
      messageId: "om_123",
      chatId: "oc_denied",
      text: "@_user_1 停止",
    }),
  );

  assert.deepEqual(result, { status: "skipped", reason: "Feishu group chat is not allowed" });
});

test("handleMessageReceive allows mentioned group text when group chat is allowed", async () => {
  const calls = [];
  const handler = new FeishuEventHandler({
    botOpenId: "ou_bot",
    allowedGroupChatIds: ["oc_allowed"],
    runtime: {
      handleTextMessage: async (message) => {
        calls.push(message);
        return { snapshot: () => ({ status: "completed" }) };
      },
    },
  });

  const result = await handler.handleMessageReceive(
    groupMentionPayload({ messageId: "om_123", chatId: "oc_allowed" }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, "oc_allowed");
  assert.equal(calls[0].chatType, "group");
  assert.deepEqual(result, { status: "handled", taskStatus: "completed" });
});

test("handleMessageReceive skips mentioned group text when sender is not allowed for group", async () => {
  const handler = new FeishuEventHandler({
    botOpenId: "ou_bot",
    groupSenderOpenIds: { oc_allowed: ["ou_allowed"] },
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not be called");
      },
      cancelActiveTask: async () => {
        throw new Error("should not cancel from denied sender");
      },
    },
  });

  const result = await handler.handleMessageReceive(
    groupMentionPayload({
      messageId: "om_123",
      chatId: "oc_allowed",
      text: "@_user_1 停止",
      openId: "ou_denied",
    }),
  );

  assert.deepEqual(result, { status: "skipped", reason: "Feishu group sender is not allowed" });
});

test("handleMessageReceive allows mentioned group text when sender is allowed for group", async () => {
  const calls = [];
  const handler = new FeishuEventHandler({
    botOpenId: "ou_bot",
    groupSenderOpenIds: { oc_allowed: ["ou_allowed"] },
    runtime: {
      handleTextMessage: async (message) => {
        calls.push(message);
        return { snapshot: () => ({ status: "completed" }) };
      },
    },
  });

  const result = await handler.handleMessageReceive(
    groupMentionPayload({
      messageId: "om_123",
      chatId: "oc_allowed",
      openId: "ou_allowed",
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].openId, "ou_allowed");
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

test("handleMessageReceive uses status fast path without waiting for queued chat work", async () => {
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
      syncActiveTaskStatus: async ({ chatId }) => {
        calls.push(`status:${chatId}`);
        return { status: "handled", taskStatus: "running" };
      },
    },
  });

  const first = handler.handleMessageReceive(textPayload({ messageId: "om_1", chatId: "oc_123" }));
  await firstStarted;
  const status = await handler.handleMessageReceive(
    textPayload({ messageId: "om_2", chatId: "oc_123", text: "/status" }),
  );

  assert.deepEqual(calls, ["start:om_1", "status:oc_123"]);
  assert.deepEqual(status, { status: "handled", taskStatus: "running" });

  firstCanFinish();
  await first;
});

test("handleMessageReceive replies cwd unsupported notice without starting a turn", async () => {
  const notices = [];
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not start Codex turn for cwd command");
      },
    },
    unsupportedMessageClient: {
      sendTextMessage: async (message) => {
        notices.push(message);
      },
    },
  });

  const result = await handler.handleMessageReceive(
    textPayload({
      messageId: "om_cwd",
      chatId: "oc_123",
      text: "/cwd F:\\development\\secret-project",
    }),
  );

  assert.deepEqual(result, { status: "handled", reason: "Cwd command is not supported" });
  assert.deepEqual(notices, [
    {
      chatId: "oc_123",
      text: "暂不支持在飞书内切换工作目录。当前版本只使用已配置的默认工作目录；后续开放 /cwd 时会先经过工作目录白名单校验。",
    },
  ]);
  assert.equal(JSON.stringify(notices).includes("secret-project"), false);
});

test("handleMessageReceive skips cwd command when notice sender is unavailable", async () => {
  const handler = new FeishuEventHandler({
    runtime: {
      handleTextMessage: async () => {
        throw new Error("should not start Codex turn for cwd command");
      },
    },
  });

  assert.deepEqual(
    await handler.handleMessageReceive(textPayload({ messageId: "om_cwd", text: "/cwd" })),
    { status: "skipped", reason: "Cwd command is not supported" },
  );
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

function groupMentionPayload({ messageId, chatId, text = "@_user_1 hello", openId = "ou_123" }) {
  return {
    event: {
      sender: { sender_id: { open_id: openId } },
      message: {
        message_id: messageId,
        chat_id: chatId,
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({
          text,
          mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
        }),
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

test("handleCardAction forwards approval action to runtime", async () => {
  const calls = [];
  const handler = new FeishuEventHandler({
    runtime: {
      resolveApproval: async (action) => {
        calls.push(action);
        return { status: "handled", decision: action.decision, taskStatus: "running" };
      },
    },
  });

  const result = await handler.handleCardAction({
    event: {
      operator: { open_id: "ou_123" },
      context: { open_chat_id: "oc_123", open_message_id: "om_123" },
      action: {
        value: {
          fcaAction: "approval.resolve",
          decision: "decline",
          taskId: "task_123",
          requestId: 7,
          approvalId: "approval_123",
        },
      },
    },
  });

  assert.deepEqual(result, { status: "handled", decision: "decline", taskStatus: "running" });
  assert.deepEqual(calls, [
    {
      action: "approval.resolve",
      decision: "decline",
      taskId: "task_123",
      requestId: 7,
      approvalId: "approval_123",
      itemId: null,
      openId: "ou_123",
      chatId: "oc_123",
      messageId: "om_123",
    },
  ]);
});

test("handleCardAction forwards approval details action to runtime", async () => {
  const calls = [];
  const handler = new FeishuEventHandler({
    runtime: {
      showApprovalDetails: async (action) => {
        calls.push(action);
        return { status: "handled", taskStatus: "waiting_approval" };
      },
    },
  });

  const result = await handler.handleCardAction({
    event: {
      operator: { open_id: "ou_123" },
      context: { open_chat_id: "oc_123", open_message_id: "om_123" },
      action: {
        value: {
          fcaAction: "approval.details",
          taskId: "task_123",
          requestId: 7,
          approvalId: "approval_123",
        },
      },
    },
  });

  assert.deepEqual(result, { status: "handled", taskStatus: "waiting_approval" });
  assert.deepEqual(calls, [
    {
      action: "approval.details",
      taskId: "task_123",
      requestId: 7,
      approvalId: "approval_123",
      itemId: null,
      openId: "ou_123",
      chatId: "oc_123",
      messageId: "om_123",
    },
  ]);
});

test("handleCardAction skips approval action when sender is not allowed for group", async () => {
  const handler = new FeishuEventHandler({
    groupSenderOpenIds: { oc_group: ["ou_allowed"] },
    runtime: {
      resolveApproval: async () => {
        throw new Error("should not approve from denied group sender");
      },
    },
  });

  const result = await handler.handleCardAction({
    event: {
      operator: { open_id: "ou_denied" },
      context: { open_chat_id: "oc_group", open_message_id: "om_123" },
      action: {
        value: {
          fcaAction: "approval.resolve",
          decision: "accept",
          taskId: "task_123",
          requestId: 7,
        },
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Feishu group sender is not allowed" });
});

test("handleCardAction skips unsupported card actions", async () => {
  const handler = new FeishuEventHandler({
    runtime: {
      resolveApproval: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const result = await handler.handleCardAction({
    event: {
      action: { value: { fcaAction: "other" } },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Unsupported Feishu card action" });
});

function fakeLogger(entries) {
  return {
    info: (event, fields) => entries.push({ level: "info", event, ...fields }),
    error: (event, fields) => entries.push({ level: "error", event, ...fields }),
  };
}

function steppingClock(initialValue, stepMs) {
  let current = initialValue;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}
