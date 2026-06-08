import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAttachmentApprovalCardModel,
  buildAttachmentApprovalSummary,
  decideAttachmentInput,
} from "../../src/feishu/attachment-policy.js";

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

test("buildAttachmentApprovalSummary returns sanitized approval details", () => {
  const envelope = {
    messageId: "om_file_123456789",
    chatId: "oc_123",
    chatType: "p2p",
    attachmentKind: "file",
    fileKey: "file_secret",
    fileName: "secret.txt",
  };
  const decision = decideAttachmentInput(envelope, { enabled: true });

  const summary = buildAttachmentApprovalSummary(envelope, decision);

  assert.deepEqual(summary, {
    type: "feishu_attachment_input",
    summary: "Codex 请求读取飞书附件，需要先完成确认和审计。",
    risk: "中",
    riskReasons: ["飞书附件读取"],
    attachmentKind: "file",
    details: [
      "风险: 中",
      "风险因素: 飞书附件读取",
      "附件类型: 文件",
      "消息: om_file_",
      "会话类型: 私聊",
      "仅展示脱敏摘要，未展示文件名、附件 key 或附件内容。",
    ],
  });
  assert.equal(JSON.stringify(summary).includes("file_secret"), false);
  assert.equal(JSON.stringify(summary).includes("secret.txt"), false);
  assert.equal(JSON.stringify(summary).includes("om_file_123456789"), false);
});

test("buildAttachmentApprovalSummary handles unknown attachment kinds", () => {
  assert.deepEqual(
    buildAttachmentApprovalSummary(
      { messageId: "om_unknown", chatType: "group", attachmentKind: "unsupported" },
      { attachmentKind: "unsupported" },
    ),
    {
      type: "feishu_attachment_input",
      summary: "Codex 请求读取飞书附件，需要先完成确认和审计。",
      risk: "中",
      riskReasons: ["飞书附件读取"],
      attachmentKind: "unsupported",
      details: [
        "风险: 中",
        "风险因素: 飞书附件读取",
        "附件类型: 未知",
        "消息: om_unkno",
        "会话类型: 群聊",
        "仅展示脱敏摘要，未展示文件名、附件 key 或附件内容。",
      ],
    },
  );
});

test("buildAttachmentApprovalCardModel maps summary to task-card approval shape", () => {
  const summary = buildAttachmentApprovalSummary(
    { messageId: "om_file_123456789", chatType: "p2p", attachmentKind: "file" },
    { attachmentKind: "file" },
  );

  assert.deepEqual(
    buildAttachmentApprovalCardModel(summary, {
      requestId: "attachment-request",
      approvalId: "attachment-approval",
      itemId: "attachment-item",
      detailExpanded: true,
    }),
    {
      requestId: "attachment-request",
      approvalId: "attachment-approval",
      itemId: "attachment-item",
      status: "pending",
      detailExpanded: true,
      type: "feishu_attachment_input",
      summary: "Codex 请求读取飞书附件，需要先完成确认和审计。",
      risk: "中",
      riskReasons: ["飞书附件读取"],
      details: [
        "风险: 中",
        "风险因素: 飞书附件读取",
        "附件类型: 文件",
        "消息: om_file_",
        "会话类型: 私聊",
        "仅展示脱敏摘要，未展示文件名、附件 key 或附件内容。",
      ],
    },
  );
});
