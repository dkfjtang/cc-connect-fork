export function prepareAttachmentDownloadRequest(envelope, pendingApproval) {
  return {
    attachmentKind: pendingApproval?.approval?.attachmentKind ?? envelope?.attachmentKind ?? "unsupported",
    messageId: envelope?.messageId ?? null,
    chatId: envelope?.chatId ?? null,
    chatType: envelope?.chatType ?? null,
    approvalId: pendingApproval?.approvalId ?? null,
    requestId: pendingApproval?.requestId ?? null,
    itemId: pendingApproval?.itemId ?? null,
  };
}

export function createDisabledAttachmentDownloadAdapter() {
  return {
    async downloadAttachment(request) {
      return {
        status: "disabled",
        reason: "Feishu attachment download adapter is not configured",
        attachmentKind: request?.attachmentKind ?? "unsupported",
        approvalId: request?.approvalId ?? null,
      };
    },
  };
}
