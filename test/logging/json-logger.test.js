import assert from "node:assert/strict";
import { test } from "node:test";

import { createJsonLogger } from "../../src/logging/json-logger.js";

test("createJsonLogger writes one structured JSON line", () => {
  let outputText = "";
  const logger = createJsonLogger({
    output: { write: (text) => (outputText += text) },
    now: () => "2026-06-08T00:00:00.000Z",
  });

  logger.info("task.completed", {
    messageId: "msg_123",
    turnId: "turn_123",
    status: "completed",
  });

  assert.deepEqual(JSON.parse(outputText), {
    timestamp: "2026-06-08T00:00:00.000Z",
    level: "info",
    event: "task.completed",
    messageId: "msg_123",
    turnId: "turn_123",
    status: "completed",
  });
});

test("createJsonLogger filters entries below the configured level", () => {
  let outputText = "";
  const logger = createJsonLogger({
    level: "warn",
    output: { write: (text) => (outputText += text) },
    now: () => "2026-06-08T00:00:00.000Z",
  });

  logger.info("task.completed", { messageId: "msg_123" });
  logger.warn("feishu.retry", { messageId: "msg_123" });

  assert.deepEqual(JSON.parse(outputText), {
    timestamp: "2026-06-08T00:00:00.000Z",
    level: "warn",
    event: "feishu.retry",
    messageId: "msg_123",
  });
});
