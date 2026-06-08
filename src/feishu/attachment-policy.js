const SUPPORTED_ATTACHMENT_KINDS = new Set(["file", "image", "audio", "document"]);
const ATTACHMENT_KIND_LABELS = {
  file: "文件",
  image: "图片",
  audio: "语音",
  document: "文档",
  unsupported: "未知",
};

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

export function buildAttachmentApprovalSummary(envelope, decision) {
  const attachmentKind = decision?.attachmentKind ?? envelope?.attachmentKind ?? "unsupported";
  const details = [
    "风险: 中",
    "风险因素: 飞书附件读取",
    `附件类型: ${ATTACHMENT_KIND_LABELS[attachmentKind] ?? "未知"}`,
  ];

  if (envelope?.messageId) {
    details.push(`消息: ${shortId(String(envelope.messageId))}`);
  }
  if (envelope?.chatType) {
    details.push(`会话类型: ${chatTypeLabel(envelope.chatType)}`);
  }
  details.push("仅展示脱敏摘要，未展示文件名、附件 key 或附件内容。");

  return {
    type: "feishu_attachment_input",
    summary: "Codex 请求读取飞书附件，需要先完成确认和审计。",
    risk: "中",
    riskReasons: ["飞书附件读取"],
    attachmentKind,
    details,
  };
}

export function buildAttachmentApprovalCardModel(summary, {
  requestId = null,
  approvalId = null,
  itemId = null,
  status = "pending",
  detailExpanded = false,
} = {}) {
  return {
    requestId,
    approvalId,
    itemId,
    status,
    detailExpanded,
    type: summary?.type ?? "feishu_attachment_input",
    summary: summary?.summary ?? "Codex 请求读取飞书附件，需要先完成确认和审计。",
    risk: summary?.risk ?? "中",
    riskReasons: Array.isArray(summary?.riskReasons) ? summary.riskReasons : ["飞书附件读取"],
    details: Array.isArray(summary?.details) ? summary.details : [],
  };
}

function shortId(value) {
  if (!value) {
    return "unknown";
  }
  return value.length <= 8 ? value : value.slice(0, 8);
}

function chatTypeLabel(chatType) {
  if (chatType === "p2p") {
    return "私聊";
  }
  if (chatType === "group") {
    return "群聊";
  }
  return "未知";
}
