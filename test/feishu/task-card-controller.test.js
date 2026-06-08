import assert from "node:assert/strict";
import { test } from "node:test";

import { RuntimeTask } from "../../src/runtime/runtime-task.js";
import { FeishuApiError } from "../../src/feishu/message-client.js";
import { TaskCardController } from "../../src/feishu/task-card-controller.js";

test("sync sends a new card and attaches returned card message id", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  const actions = [];
  const controller = new TaskCardController({
    sendAction: async (action) => {
      actions.push(action);
      return { messageId: "om_123" };
    },
  });

  await controller.sync(task);

  assert.equal(actions[0].type, "send");
  assert.equal(actions[0].receiveId, "oc_123");
  assert.equal(task.snapshot().cardMessageId, "om_123");
});

test("sync stores card channel metadata returned by sender", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  const controller = new TaskCardController({
    sendAction: async () => ({
      messageId: "om_123",
      cardChannel: "cardkit",
      cardId: "card_123",
      cardSequence: 1,
    }),
  });

  await controller.sync(task);

  assert.equal(task.snapshot().cardMessageId, "om_123");
  assert.equal(task.snapshot().cardChannel, "cardkit");
  assert.equal(task.snapshot().cardId, "card_123");
  assert.equal(task.snapshot().cardSequence, 1);
});

test("sync updates existing card without replacing card message id", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  task.attachCard("om_123");
  task.handleCodexEvent({
    method: "turn/started",
    params: { turn: { id: "turn_123" } },
  });

  const actions = [];
  const controller = new TaskCardController({
    sendAction: async (action) => {
      actions.push(action);
      return {};
    },
  });

  await controller.sync(task);

  assert.equal(actions[0].type, "update");
  assert.equal(actions[0].messageId, "om_123");
  assert.equal(task.snapshot().cardMessageId, "om_123");
});

test("sync downgrades stored card channel when update falls back to IM", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  task.attachCard("om_123", {
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 1,
  });
  const actions = [];
  const controller = new TaskCardController({
    sendAction: async (action) => {
      actions.push(action);
      return { cardChannel: "im", cardId: null, cardSequence: null };
    },
  });

  await controller.sync(task);

  assert.equal(actions[0].type, "update");
  assert.equal(actions[0].cardChannel, "cardkit");
  assert.equal(actions[0].cardId, "card_123");
  assert.equal(actions[0].cardSequence, 1);
  assert.equal(task.snapshot().cardMessageId, "om_123");
  assert.equal(task.snapshot().cardChannel, "im");
  assert.equal(task.snapshot().cardId, null);
  assert.equal(task.snapshot().cardSequence, null);
});

test("sync renders cards with configured footer fields", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
    model: "gpt-5.1-codex",
    appVersion: "0.2.0-test",
  });
  task.handleCodexEvent({
    method: "turn/started",
    params: { turn: { id: "turn_123" } },
  });

  const actions = [];
  const controller = new TaskCardController({
    footerFields: ["status", "model"],
    sendAction: async (action) => {
      actions.push(action);
      return { messageId: "om_123" };
    },
  });

  await controller.sync(task);

  const footer = actions[0].card.elements.at(-1).elements[0].content;
  assert.equal(footer, "状态: running | model: gpt-5.1-codex");
});

test("sync surfaces sender failures", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
  });
  const controller = new TaskCardController({
    maxSendAttempts: 1,
    sendAction: async () => {
      throw new Error("Feishu API failed");
    },
  });

  await assert.rejects(() => controller.sync(task), /Feishu API failed/);
});

test("sync retries transient sender failures", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  const actions = [];
  const controller = new TaskCardController({
    retryDelayMs: 0,
    sendAction: async (action) => {
      actions.push(action);
      if (actions.length === 1) {
        throw new Error("rate limited");
      }

      return { messageId: "om_123" };
    },
  });

  await controller.sync(task);

  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, "send");
  assert.equal(actions[1].type, "send");
  assert.equal(task.snapshot().cardMessageId, "om_123");
});

test("sync uses longer exponential backoff for Feishu rate limits", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  const delays = [];
  let attempts = 0;
  const controller = new TaskCardController({
    maxSendAttempts: 3,
    retryDelayMs: 100,
    rateLimitRetryDelayMs: 1000,
    setTimeoutFn: (callback, delay) => {
      delays.push(delay);
      callback();
      return "timer";
    },
    sendAction: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new FeishuApiError({
          actionType: "update",
          code: 99991663,
          message: "frequency limited",
        });
      }

      return { messageId: "om_123" };
    },
  });

  await controller.sync(task);

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("sync does not retry non-retryable Feishu API errors", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  let attempts = 0;
  const controller = new TaskCardController({
    maxSendAttempts: 3,
    retryDelayMs: 0,
    sendAction: async () => {
      attempts += 1;
      throw new FeishuApiError({
        actionType: "send",
        code: 230001,
        message: "invalid card payload",
      });
    },
  });

  await assert.rejects(() => controller.sync(task), /invalid card payload/);
  assert.equal(attempts, 1);
});

test("sync serializes concurrent card updates so later sync sees attached card", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  const actions = [];
  let finishFirst;
  const firstStarted = new Promise((resolve) => {
    finishFirst = resolve;
  });
  const controller = new TaskCardController({
    sendAction: async (action) => {
      actions.push(action);
      if (actions.length === 1) {
        await firstStarted;
        return { messageId: "om_123" };
      }

      return {};
    },
  });

  const firstSync = controller.sync(task);
  const secondSync = controller.sync(task);
  await Promise.resolve();
  assert.equal(actions.length, 1);

  finishFirst();
  await Promise.all([firstSync, secondSync]);

  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, "send");
  assert.equal(actions[1].type, "update");
  assert.equal(actions[1].messageId, "om_123");
});

test("sync continues queue after a failed update", async () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuChatId: "oc_123",
    cwd: "F:\\development\\f-codex",
  });
  const actions = [];
  const controller = new TaskCardController({
    maxSendAttempts: 1,
    sendAction: async (action) => {
      actions.push(action);
      if (actions.length === 1) {
        throw new Error("rate limited");
      }

      return { messageId: "om_123" };
    },
  });

  await assert.rejects(() => controller.sync(task), /rate limited/);
  await controller.sync(task);

  assert.equal(actions.length, 2);
  assert.equal(actions[1].type, "send");
  assert.equal(task.snapshot().cardMessageId, "om_123");
});
