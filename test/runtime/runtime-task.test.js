import assert from "node:assert/strict";
import { test } from "node:test";

import { RuntimeTask } from "../../src/runtime/runtime-task.js";

test("new runtime task starts queued with Feishu context", () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuMessageId: "msg_123",
    feishuOpenId: "ou_123",
    feishuChatId: "chat_123",
    cwd: "F:\\development\\f-codex",
    model: "gpt-5.1-codex",
    appVersion: "0.2.0-test",
    now: () => 1_000,
  });

  assert.deepEqual(task.snapshot(), {
    taskId: "task_123",
    feishuMessageId: "msg_123",
    feishuOpenId: "ou_123",
    feishuChatId: "chat_123",
    cardMessageId: null,
    threadId: null,
    turnId: null,
    cwd: "F:\\development\\f-codex",
    model: "gpt-5.1-codex",
    appVersion: "0.2.0-test",
    status: "queued",
    startedAt: 1000,
    completedAt: null,
    elapsedMs: 0,
    summaryText: "Codex 正在处理...",
    finalText: "",
    errorSummary: null,
    errorType: null,
  });
});

test("thread result and turn started notification move task to running", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.attachThread("thr_123");
  task.handleCodexEvent({
    method: "turn/started",
    params: { turn: { id: "turn_123" } },
  });

  assert.equal(task.snapshot().threadId, "thr_123");
  assert.equal(task.snapshot().turnId, "turn_123");
  assert.equal(task.snapshot().status, "running");
});

test("agent message deltas update summary and final output", () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    summaryLimit: 8,
  });

  task.handleCodexEvent({
    method: "item/agentMessage/delta",
    params: { delta: "abcdefghijk" },
  });

  assert.equal(task.snapshot().summaryText, "abcdefgh...");
  assert.equal(task.snapshot().finalText, "abcdefghijk");
});

test("turn completion marks task completed", () => {
  let now = 1_000;
  const task = new RuntimeTask({ taskId: "task_123", now: () => now });
  now = 2_500;

  task.handleCodexEvent({
    method: "turn/completed",
    params: { status: "success" },
  });

  const snapshot = task.snapshot();
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.completedAt, 2500);
  assert.equal(snapshot.elapsedMs, 1500);
});

test("turn failure records a readable error summary", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "turn/completed",
    params: { status: "failed", error: { message: "Tool approval denied", type: "approval_denied" } },
  });

  const snapshot = task.snapshot();
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.errorSummary, "Tool approval denied");
  assert.equal(snapshot.errorType, "approval_denied");
});

test("cancel marks task cancelled with readable reason", () => {
  let now = 1_000;
  const task = new RuntimeTask({ taskId: "task_123", now: () => now });
  now = 1_250;

  task.cancel("用户已停止任务");

  const snapshot = task.snapshot();
  assert.equal(snapshot.status, "cancelled");
  assert.equal(snapshot.errorSummary, "用户已停止任务");
  assert.equal(snapshot.errorType, "cancelled");
  assert.equal(snapshot.completedAt, 1250);
  assert.equal(snapshot.elapsedMs, 250);
});
