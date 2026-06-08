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
    cardChannel: null,
    cardId: null,
    cardSequence: null,
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
    risk: "中",
    riskReasons: ["命令审批"],
    details: ["风险: 中", "风险因素: 命令审批", "目录: f-codex"],
  });
  assert.equal(JSON.stringify(snapshot.approval).includes("secret.txt"), false);
});

test("approval request summarizes command actions without raw command details", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "item/commandExecution/requestApproval",
    requestId: 7,
    serverRequest: true,
    params: {
      itemId: "item_123",
      approvalId: "approval_123",
      command: "cat C:\\Users\\Administrator\\secret.txt",
      cwd: "F:\\development\\f-codex",
      commandActions: [
        { type: "read", path: "C:\\Users\\Administrator\\secret.txt", command: "cat secret.txt" },
        { type: "search", query: "password", command: "rg password" },
      ],
      networkApprovalContext: { protocol: "https", host: "api.example.com" },
    },
  });

  const approval = task.snapshot().approval;
  assert.equal(approval.risk, "高");
  assert.deepEqual(approval.riskReasons, ["命令审批", "网络访问"]);
  assert.deepEqual(approval.details, [
    "风险: 高",
    "风险因素: 命令审批 / 网络访问",
    "目录: f-codex",
    "命令动作: 读取 1 / 搜索 1",
    "网络目标: api.example.com",
  ]);
  assert.equal(JSON.stringify(approval).includes("secret.txt"), false);
  assert.equal(JSON.stringify(approval).includes("password"), false);
});

test("file change approval summarizes counts and extensions without paths or diffs", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "applyPatchApproval",
    requestId: 7,
    serverRequest: true,
    params: {
      callId: "call_123",
      conversationId: "thr_123",
      grantRoot: "F:\\development\\f-codex",
      fileChanges: {
        "F:\\development\\f-codex\\secret.txt": { type: "update", unified_diff: "-password\n+token" },
        "F:\\development\\f-codex\\src\\app.js": { type: "add", content: "secret" },
        "F:\\development\\f-codex\\old.env": { type: "delete", content: "secret" },
      },
    },
  });

  const approval = task.snapshot().approval;
  assert.deepEqual(approval.riskReasons, ["文件变更", "删除文件"]);
  assert.deepEqual(approval.details, [
    "风险: 高",
    "风险因素: 文件变更 / 删除文件",
    "目录: f-codex",
    "文件变更: 3 个 (修改 1 / 新增 1 / 删除 1), 扩展名: .txt, .js, .env",
  ]);
  assert.equal(JSON.stringify(approval).includes("secret.txt"), false);
  assert.equal(JSON.stringify(approval).includes("password"), false);
  assert.equal(JSON.stringify(approval).includes("app.js"), false);
});

test("permissions approval summarizes requested permission counts", () => {
  const task = new RuntimeTask({ taskId: "task_123" });

  task.handleCodexEvent({
    method: "item/permissions/requestApproval",
    requestId: 7,
    serverRequest: true,
    params: {
      itemId: "item_123",
      cwd: "F:\\development\\f-codex",
      permissions: {
        fileSystem: {
          read: ["C:\\Users\\Administrator\\secret.txt"],
          write: ["F:\\development\\f-codex\\out.txt", "F:\\development\\f-codex\\log.txt"],
        },
        network: { enabled: true },
      },
      reason: "need secret",
    },
  });

  const approval = task.snapshot().approval;
  assert.deepEqual(approval.riskReasons, ["权限变更", "文件写入", "网络开启", "包含说明"]);
  assert.deepEqual(approval.details, [
    "风险: 高",
    "风险因素: 权限变更 / 文件写入 / 网络开启 / 包含说明",
    "目录: f-codex",
    "权限: 读 1 / 写 2 / 网络开启",
    "包含说明: 是",
  ]);
  assert.equal(JSON.stringify(approval).includes("secret.txt"), false);
  assert.equal(JSON.stringify(approval).includes("need secret"), false);
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
  assert.equal(snapshot.approval.risk, "高");
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
