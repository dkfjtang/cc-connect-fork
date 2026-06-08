const SUPPORTED_ATTACHMENT_KINDS = new Set(["file", "image", "audio", "document"]);

export function decideAttachmentInput(envelope, { enabled = false } = {}) {
  if (!envelope?.messageId || !envelope?.chatId) {
    return {
      action: "skip",
      reason: "Only text messages are supported",
    };
  }

  if (envelope.chatType !== "p2p") {
    return {
      action: "skip",
      reason: "Only text messages are supported",
      attachmentKind: envelope.attachmentKind,
    };
  }

  if (!SUPPORTED_ATTACHMENT_KINDS.has(envelope.attachmentKind)) {
    return {
      action: "notify_unsupported",
      reason: "Unsupported Feishu attachment type",
      attachmentKind: "unsupported",
    };
  }

  if (!enabled) {
    return {
      action: "notify_disabled",
      reason: "Feishu attachment input is disabled",
      attachmentKind: envelope.attachmentKind,
    };
  }

  return {
    action: "eligible",
    reason: "Feishu attachment input is eligible",
    attachmentKind: envelope.attachmentKind,
  };
}
