import assert from "node:assert/strict";
import { test } from "node:test";

import { RuntimeTask } from "../../src/runtime/runtime-task.js";

test("new runtime task starts queued with Feishu context", () => {
  const task = new RuntimeTask({
    taskId: "task_123",
    feishuMessageId: "msg_123",
    feishuOpenId: "ou_123",
    feishuChatId: "chat_123",
    feishuChatType: "group",
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
    feishuChatType: "group",
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
    tokenUsage: null,
    currentStage: null,
    lastStage: null,
    approval: null,
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

test("item events update safe stage diagnostics", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "item/started",
    params: {
      threadId: "thr_123",
      turnId: "turn_123",
      item: {
        id: "item_123",
        type: "commandExecution",
        status: "inProgress",
        command: "cat secret.txt",
      },
    },
  });

  let snapshot = task.snapshot();
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.threadId, "thr_123");
  assert.equal(snapshot.turnId, "turn_123");
  assert.deepEqual(snapshot.currentStage, {
    id: "item_123",
    type: "commandExecution",
    status: "inProgress",
    label: "执行命令",
  });

  task.handleCodexEvent({
    method: "item/completed",
    params: {
      item: {
        id: "item_123",
        type: "commandExecution",
        status: "completed",
        command: "cat secret.txt",
      },
    },
  });

  snapshot = task.snapshot();
  assert.equal(snapshot.currentStage, null);
  assert.deepEqual(snapshot.lastStage, {
    id: "item_123",
    type: "commandExecution",
    status: "completed",
    label: "执行命令",
  });
});

test("tool item stage uses tool name without arguments", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "item/started",
    params: {
      item: {
        id: "item_123",
        type: "dynamicToolCall",
        status: "inProgress",
        tool: "shell_command",
        arguments: { command: "cat secret.txt" },
      },
    },
  });

  assert.deepEqual(task.snapshot().currentStage, {
    id: "item_123",
    type: "dynamicToolCall",
    status: "inProgress",
    label: "调用工具 shell_command",
  });
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

test("token usage notification updates task diagnostics", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thr_123",
      turnId: "turn_123",
      tokenUsage: {
        last: {
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 30,
          reasoningOutputTokens: 5,
          totalTokens: 135,
        },
        total: {
          inputTokens: 1000,
          cachedInputTokens: 400,
          outputTokens: 300,
          reasoningOutputTokens: 50,
          totalTokens: 1350,
        },
        modelContextWindow: 8000,
      },
    },
  });

  const snapshot = task.snapshot();
  assert.equal(snapshot.threadId, "thr_123");
  assert.equal(snapshot.turnId, "turn_123");
  assert.equal(snapshot.tokenUsage.total.totalTokens, 1350);
  assert.equal(snapshot.tokenUsage.total.cachedInputTokens, 400);
});

test("approval request moves task to waiting approval without raw details", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "item/commandExecution/requestApproval",
    requestId: 7,
    serverRequest: true,
    params: {
      itemId: "item_123",
      threadId: "thr_123",
      turnId: "turn_123",
      approvalId: "approval_123456789",
      command: "cat secret.txt",
      cwd: "F:\\development\\f-codex",
    },
  });

  const snapshot = task.snapshot();
  assert.equal(snapshot.status, "waiting_approval");
  assert.equal(snapshot.threadId, "thr_123");
  assert.equal(snapshot.turnId, "turn_123");
  assert.deepEqual(snapshot.approval, {
    requestId: 7,
    method: "item/commandExecution/requestApproval",
    approvalId: "approval_123456789",
    itemId: "item_123",
    type: "command",
    status: "pending",
    summary: "Codex 请求执行命令，需要审批。",
  });
  assert.equal(JSON.stringify(snapshot.approval).includes("secret.txt"), false);
});

test("resolveApproval records decision without raw details", () => {
  const task = new RuntimeTask({ taskId: "task_123" });
  task.handleCodexEvent({
    method: "item/fileChange/requestApproval",
    requestId: 7,
    serverRequest: true,
    params: {
      itemId: "item_123",
      approvalId: "approval_123456789",
      diff: "secret.txt",
    },
  });

  task.resolveApproval("decline");

  const snapshot = task.snapshot();
  assert.equal(snapshot.status, "waiting_approval");
  assert.equal(snapshot.approval.status, "declined");
  assert.equal(snapshot.approval.summary, "已拒绝本次操作，等待 Codex 收尾。");
  assert.equal(JSON.stringify(snapshot.approval).includes("secret.txt"), false);
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
