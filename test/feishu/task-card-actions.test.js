import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTaskCardAction } from "../../src/feishu/task-card-actions.js";

test("buildTaskCardAction builds send action when no card message exists", () => {
  const action = buildTaskCardAction({
    feishuChatId: "oc_123",
    cardMessageId: null,
    status: "queued",
    summaryText: "hello",
    finalText: "",
    cwd: "F:\\development\\f-codex",
  });

  assert.equal(action.type, "send");
  assert.equal(action.receiveIdType, "chat_id");
  assert.equal(action.receiveId, "oc_123");
  assert.equal(action.messageType, "interactive");
  assert.equal(action.card.header.title.content, "任务已接收");
});

test("buildTaskCardAction builds update action when card message exists", () => {
  const action = buildTaskCardAction({
    feishuChatId: "oc_123",
    cardMessageId: "om_123",
    cardChannel: "cardkit",
    cardId: "card_123",
    cardSequence: 3,
    status: "running",
    summaryText: "working",
    finalText: "",
    cwd: "F:\\development\\f-codex",
  });

  assert.equal(action.type, "update");
  assert.equal(action.messageId, "om_123");
  assert.equal(action.cardChannel, "cardkit");
  assert.equal(action.cardId, "card_123");
  assert.equal(action.cardSequence, 3);
  assert.equal(action.card.header.title.content, "Codex 执行中");
});

test("buildTaskCardAction requires chat id for send action", () => {
  assert.throws(
    () =>
      buildTaskCardAction({
        cardMessageId: null,
        status: "queued",
        summaryText: "hello",
      }),
    /feishuChatId is required to send a task card/,
  );
});
