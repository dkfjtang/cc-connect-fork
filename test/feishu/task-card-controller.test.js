import assert from "node:assert/strict";
import { test } from "node:test";

import { RuntimeTask } from "../../src/runtime/runtime-task.js";
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
