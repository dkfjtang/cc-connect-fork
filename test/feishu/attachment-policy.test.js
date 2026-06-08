import assert from "node:assert/strict";
import { test } from "node:test";

import { decideAttachmentInput } from "../../src/feishu/attachment-policy.js";

test("decideAttachmentInput notifies supported private attachments when disabled", () => {
  assert.deepEqual(
    decideAttachmentInput({
      messageId: "om_file",
      chatId: "oc_123",
      chatType: "p2p",
      attachmentKind: "file",
    }),
    {
      action: "notify_disabled",
      reason: "Feishu attachment input is disabled",
      attachmentKind: "file",
    },
  );
});

test("decideAttachmentInput marks supported private attachments eligible when enabled", () => {
  assert.deepEqual(
    decideAttachmentInput(
      {
        messageId: "om_image",
        chatId: "oc_123",
        chatType: "p2p",
        attachmentKind: "image",
      },
      { enabled: true },
    ),
    {
      action: "eligible",
      reason: "Feishu attachment input is eligible",
      attachmentKind: "image",
    },
  );
});

test("decideAttachmentInput skips group attachments", () => {
  assert.deepEqual(
    decideAttachmentInput(
      {
        messageId: "om_file",
        chatId: "oc_group",
        chatType: "group",
        attachmentKind: "file",
      },
      { enabled: true },
    ),
    {
      action: "skip",
      reason: "Only text messages are supported",
      attachmentKind: "file",
    },
  );
});

test("decideAttachmentInput notifies unsupported private attachment kinds", () => {
  assert.deepEqual(
    decideAttachmentInput(
      {
        messageId: "om_unknown",
        chatId: "oc_123",
        chatType: "p2p",
        attachmentKind: "unsupported",
      },
      { enabled: true },
    ),
    {
      action: "notify_unsupported",
      reason: "Unsupported Feishu attachment type",
      attachmentKind: "unsupported",
    },
  );
});

test("decideAttachmentInput skips envelopes without message or chat ids", () => {
  assert.deepEqual(decideAttachmentInput({ chatType: "p2p", attachmentKind: "file" }), {
    action: "skip",
    reason: "Only text messages are supported",
  });
});
