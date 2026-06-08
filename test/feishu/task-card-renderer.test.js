import assert from "node:assert/strict";
import { test } from "node:test";

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
    threadId: "thr_123456789",
    turnId: "turn_123456789",
    errorSummary: null,
  });

  assert.equal(card.header.title.content, "Codex 执行中");
  assert.equal(card.header.template, "wathet");
  assert.match(card.elements.at(-1).elements[0].content, /thread: thr_1234/);
  assert.match(card.elements.at(-1).elements[0].content, /turn: turn_123/);
});

test("renderTaskCard renders completed status with final text", () => {
  const card = renderTaskCard({
    taskId: "task_123",
    status: "completed",
    cwd: "F:\\development\\f-codex",
    summaryText: "summary",
    finalText: "最终回复",
    threadId: "thr_123",
    turnId: "turn_123",
    errorSummary: null,
  });

  assert.equal(card.header.title.content, "已完成");
  assert.equal(card.header.template, "green");
  assert.equal(card.elements[0].text.content, "最终回复");
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
    errorSummary: "Codex turn failed",
  });

  assert.equal(card.header.title.content, "执行失败");
  assert.equal(card.header.template, "red");
  assert.equal(card.elements[0].text.content, "Codex turn failed");
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
