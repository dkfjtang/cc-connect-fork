import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDisabledAttachmentDownloadAdapter,
  prepareAttachmentDownloadRequest,
} from "../../src/feishu/attachment-download-adapter.js";
import {
  buildAttachmentPendingApproval,
  decideAttachmentInput,
} from "../../src/feishu/attachment-policy.js";

test("prepareAttachmentDownloadRequest builds sanitized adapter input", () => {
  const envelope = {
    messageId: "om_file_123456789",
    chatId: "oc_123",
    chatType: "p2p",
    attachmentKind: "file",
    fileKey: "file_secret",
    fileName: "secret.txt",
  };
  const pending = buildAttachmentPendingApproval(
    envelope,
    decideAttachmentInput(envelope, { enabled: true }),
  );

  const request = prepareAttachmentDownloadRequest(envelope, pending);

  assert.deepEqual(request, {
    attachmentKind: "file",
    messageId: "om_file_123456789",
    chatId: "oc_123",
    chatType: "p2p",
    approvalId: "attachment-om_file_",
    requestId: "attachment-request-om_file_",
    itemId: "attachment-item-om_file_",
  });
  assert.equal(JSON.stringify(request).includes("file_secret"), false);
  assert.equal(JSON.stringify(request).includes("secret.txt"), false);
});

test("disabled attachment download adapter never downloads content", async () => {
  const adapter = createDisabledAttachmentDownloadAdapter();

  const result = await adapter.downloadAttachment({
    attachmentKind: "image",
    approvalId: "attachment-om_image",
    fileKey: "image_secret",
    fileName: "secret.png",
  });

  assert.deepEqual(result, {
    status: "disabled",
    reason: "Feishu attachment download adapter is not configured",
    attachmentKind: "image",
    approvalId: "attachment-om_image",
  });
  assert.equal(JSON.stringify(result).includes("image_secret"), false);
  assert.equal(JSON.stringify(result).includes("secret.png"), false);
});
