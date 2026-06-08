import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseCardActionEvent,
  UnsupportedFeishuCardActionError,
} from "../../src/feishu/card-action-parser.js";

test("parseCardActionEvent extracts approval resolution action", () => {
  const action = parseCardActionEvent({
    event: {
      operator: { open_id: "ou_123" },
      context: { open_chat_id: "oc_123", open_message_id: "om_123" },
      action: {
        value: {
          fcaAction: "approval.resolve",
          decision: "accept",
          taskId: "task_123",
          requestId: 7,
          approvalId: "approval_123",
          itemId: "item_123",
        },
      },
    },
  });

  assert.deepEqual(action, {
    action: "approval.resolve",
    decision: "accept",
    taskId: "task_123",
    requestId: 7,
    approvalId: "approval_123",
    itemId: "item_123",
    openId: "ou_123",
    chatId: "oc_123",
    messageId: "om_123",
  });
});

test("parseCardActionEvent rejects unsupported actions", () => {
  assert.throws(
    () => parseCardActionEvent({ event: { action: { value: { fcaAction: "other" } } } }),
    UnsupportedFeishuCardActionError,
  );
});

test("parseCardActionEvent rejects unsupported approval decisions", () => {
  assert.throws(
    () =>
      parseCardActionEvent({
        event: {
          action: {
            value: {
              fcaAction: "approval.resolve",
              decision: "approveEverything",
            },
          },
        },
      }),
    UnsupportedFeishuCardActionError,
  );
});
