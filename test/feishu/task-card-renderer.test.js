import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAttachmentApprovalCardModel,
  buildAttachmentApprovalSummary,
} from "../../src/feishu/attachment-policy.js";
import { renderTaskCard } from "../../src/feishu/task-card-renderer.js";

test("renderTaskCard renders queued status with user input summary", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "queued",
    cwd: "F:\\development\\f-codex",
    summaryText: "帮我看项目状态",
    finalText: "",
    threadId: null,
    turnId: null,
    errorSummary: null,
  });

  assert.equal(card.config.update_multi, true);
  assert.equal(card.header.title.content, "任务已接收");
  assert.equal(card.header.template, "blue");
  assert.equal(card.elements[0].text.content, "帮我看项目状态");
  assert.match(card.elements.at(-1).elements[0].content, /状态: queued/);
  assert.match(card.elements.at(-1).elements[0].content, /cwd: F:\\development\\f-codex/);
});

test("renderTaskCard renders running status with thread and turn footer", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "running",
    cwd: "F:\\development\\f-codex",
    summaryText: "正在检查 README",
    finalText: "",
    currentStage: {
      id: "item_123",
      type: "commandExecution",
      status: "inProgress",
      label: "执行命令",
    },
    threadId: "thr_123456789",
    turnId: "turn_123456789",
    model: "gpt-5.1-codex",
    appVersion: "0.2.0-test",
    elapsedMs: 3500,
    tokenUsage: {
      total: {
        inputTokens: 7000,
        cachedInputTokens: 2500,
        outputTokens: 2000,
        reasoningOutputTokens: 500,
        totalTokens: 9500,
      },
      modelContextWindow: 38000,
    },
    errorSummary: null,
    errorType: null,
  });

  assert.equal(card.header.title.content, "Codex 执行中");
  assert.equal(card.header.template, "wathet");
  assert.match(card.elements.at(-1).elements[0].content, /thread: thr_1234/);
  assert.match(card.elements.at(-1).elements[0].content, /turn: turn_123/);
  assert.match(card.elements.at(-1).elements[0].content, /耗时: 3\.5s/);
  assert.match(card.elements.at(-1).elements[0].content, /tokens: 9\.5k/);
  assert.match(card.elements.at(-1).elements[0].content, /cache: 2\.5k/);
  assert.match(card.elements.at(-1).elements[0].content, /ctx: 25%/);
  assert.match(card.elements.at(-1).elements[0].content, /model: gpt-5.1-codex/);
  assert.match(card.elements.at(-1).elements[0].content, /fca: 0.2.0-test/);
  assert.match(card.elements[0].text.content, /当前阶段: 执行命令/);
  assert.match(card.elements[0].text.content, /正在检查 README/);
});

test("renderTaskCard can render only configured footer fields", () => {
  const card = renderTaskCard(
    {
      taskId: "task_123",
      status: "running",
      cwd: "F:\\development\\f-codex",
      summaryText: "正在检查 README",
      finalText: "",
      threadId: "thr_123456789",
      turnId: "turn_123456789",
      model: "gpt-5.1-codex",
      appVersion: "0.2.0-test",
      elapsedMs: 3500,
      tokenUsage: {
        total: {
          totalTokens: 9500,
          cachedInputTokens: 2500,
        },
        modelContextWindow: 38000,
      },
    },
    {
      footerFields: ["status", "elapsed", "tokens"],
    },
  );

  const footer = card.elements.at(-1).elements[0].content;
  assert.equal(footer, "状态: running | 耗时: 3.5s | tokens: 9.5k / cache: 2.5k / ctx: 25%");
});

test("renderTaskCard renders completed status with final text", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "completed",
    cwd: "F:\\development\\f-codex",
    summaryText: "summary",
    finalText: "最终回复",
    lastStage: {
      id: "item_123",
      type: "fileChange",
      status: "completed",
      label: "处理文件变更",
    },
    threadId: "thr_123",
    turnId: "turn_123",
    errorSummary: null,
  });

  assert.equal(card.header.title.content, "已完成");
  assert.equal(card.header.template, "green");
  assert.equal(card.elements[0].text.content, "最近阶段: 处理文件变更\n\n最终回复");
});

test("renderTaskCard renders failed status with readable error", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "failed",
    cwd: "F:\\development\\f-codex",
    summaryText: "summary",
    finalText: "",
    threadId: "thr_123",
    turnId: "turn_123",
    elapsedMs: 62_000,
    errorSummary: "Codex turn failed",
    errorType: "app_server_error",
  });

  assert.equal(card.header.title.content, "执行失败");
  assert.equal(card.header.template, "red");
  assert.equal(card.elements[0].text.content, "Codex turn failed");
  assert.match(card.elements.at(-1).elements[0].content, /耗时: 1m 2s/);
  assert.match(card.elements.at(-1).elements[0].content, /错误: app_server_error/);
});

test("renderTaskCard renders waiting approval summary", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "waiting_approval",
    cwd: "F:\\development\\f-codex",
    summaryText: "summary",
    finalText: "",
    threadId: "thr_123",
    turnId: "turn_123",
    approval: {
      requestId: 7,
      approvalId: "approval_123456789",
      itemId: "item_123",
      status: "pending",
      summary: "Codex 请求执行命令，需要审批。",
      details: ["风险: 高", "风险因素: 命令审批 / 网络访问", "目录: f-codex", "命令动作: 读取 1"],
    },
  });

  assert.equal(card.header.title.content, "需要确认");
  assert.equal(card.header.template, "orange");
  assert.equal(
    card.elements[0].text.content,
    "Codex 请求执行命令，需要审批。\n\n风险: 高\n风险因素: 命令审批 / 网络访问\n目录: f-codex\n命令动作: 读取 1\n\napproval: approval",
  );
  assert.equal(card.elements[1].tag, "action");
  assert.deepEqual(
    card.elements[1].actions.map((action) => action.value.fcaAction),
    ["approval.details", "approval.resolve", "approval.resolve", "approval.resolve", "approval.resolve"],
  );
  assert.deepEqual(
    card.elements[1].actions.slice(1).map((action) => action.value.decision),
    ["accept", "acceptForSession", "decline", "cancel"],
  );
  assert.equal(card.elements[1].actions[0].value.requestId, 7);
  assert.equal(card.elements[0].text.content.includes("secret.txt"), false);
});

test("renderTaskCard renders expanded approval details", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "waiting_approval",
    summaryText: "summary",
    finalText: "",
    approval: {
      requestId: 7,
      approvalId: "approval_123456789",
      itemId: "item_123",
      status: "pending",
      detailExpanded: true,
      summary: "Codex 请求额外权限，需要审批。",
      details: [
        "风险: 高",
        "风险因素: 权限变更 / 文件写入",
        "目录: f-codex",
        "权限: 读 1 / 写 2",
        "网络目标: api.example.com",
        "包含说明: 是",
        "附加提示: 已脱敏",
      ],
    },
  });

  assert.equal(
    card.elements[0].text.content,
    "审批详情\n\nCodex 请求额外权限，需要审批。\n\n风险: 高\n风险因素: 权限变更 / 文件写入\n目录: f-codex\n权限: 读 1 / 写 2\n网络目标: api.example.com\n包含说明: 是\n附加提示: 已脱敏\n\n仅展示脱敏摘要，未展示命令正文、diff、完整路径或原始 payload。\n\napproval: approval",
  );
});

test("renderTaskCard renders sanitized attachment approval model", () => {
  const approval = buildAttachmentApprovalCardModel(
    buildAttachmentApprovalSummary(
      {
        messageId: "om_file_123456789",
        chatType: "p2p",
        attachmentKind: "file",
        fileKey: "file_secret",
        fileName: "secret.txt",
      },
      { attachmentKind: "file" },
    ),
    {
      requestId: "attachment-request",
      approvalId: "attachment-approval",
      itemId: "attachment-item",
    },
  );

  const card = renderTaskCard({
    taskId: "task_123",
    status: "waiting_approval",
    summaryText: "",
    finalText: "",
    approval,
  });

  assert.equal(card.header.title.content, "需要确认");
  assert.equal(
    card.elements[0].text.content,
    "Codex 请求读取飞书附件，需要先完成确认和审计。\n\n风险: 中\n风险因素: 飞书附件读取\n附件类型: 文件\n消息: om_file_\n会话类型: 私聊\n仅展示脱敏摘要，未展示文件名、附件 key 或附件内容。\n\napproval: attachme",
  );
  assert.equal(card.elements[1].tag, "action");
  assert.equal(card.elements[1].actions[0].value.requestId, "attachment-request");
  assert.equal(card.elements[1].actions[0].value.approvalId, "attachment-approval");
  assert.equal(JSON.stringify(card).includes("file_secret"), false);
  assert.equal(JSON.stringify(card).includes("secret.txt"), false);
  assert.equal(JSON.stringify(card).includes("om_file_123456789"), false);
});

test("renderTaskCard truncates overly long card body", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "completed",
    cwd: "F:\\development\\f-codex",
    summaryText: "summary",
    finalText: "a".repeat(1200),
    threadId: "thr_123",
    turnId: "turn_123",
    errorSummary: null,
  });

  assert.equal(card.elements[0].text.content.length, 1003);
  assert.match(card.elements[0].text.content, /\.\.\.$/);
});

test("renderTaskCard bounds card payload when body and footer fields are long", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "completed",
    cwd: `F:\\development\\${"nested\\".repeat(1000)}f-codex`,
    summaryText: "summary",
    finalText: "完成".repeat(5000),
    threadId: `thr_${"1".repeat(500)}`,
    turnId: `turn_${"2".repeat(500)}`,
    model: `gpt-${"x".repeat(500)}`,
    appVersion: `0.2.0-${"build".repeat(200)}`,
    errorSummary: null,
  });

  const footer = card.elements.at(-1).elements[0].content;
  assert.ok(JSON.stringify(card).length < 5000);
  assert.ok(footer.length < 800);
  assert.equal(footer.includes("nested\\nested\\nested\\nested"), false);
  assert.match(footer, /\.\.\./);
});
