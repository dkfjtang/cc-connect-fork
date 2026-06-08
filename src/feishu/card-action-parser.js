export class UnsupportedFeishuCardActionError extends Error {}

export function parseCardActionEvent(payload) {
  const event = payload?.event ?? {};
  const value = event.action?.value ?? payload?.action?.value ?? {};

  if (value.fcaAction !== "approval.resolve") {
    throw new UnsupportedFeishuCardActionError("Unsupported Feishu card action");
  }

  const decision = normalizeDecision(value.decision);
  if (!decision) {
    throw new UnsupportedFeishuCardActionError("Unsupported approval decision");
  }

  return {
    action: "approval.resolve",
    decision,
    taskId: value.taskId ?? null,
    requestId: value.requestId ?? null,
    approvalId: value.approvalId ?? null,
    itemId: value.itemId ?? null,
    openId: operatorOpenId(event),
    chatId: event.context?.open_chat_id ?? value.chatId ?? null,
    messageId: event.context?.open_message_id ?? value.messageId ?? null,
  };
}

function normalizeDecision(decision) {
  if (["accept", "acceptForSession", "decline", "cancel"].includes(decision)) {
    return decision;
  }
  return null;
}

function operatorOpenId(event) {
  return (
    event.operator?.open_id ??
    event.operator?.operator_id?.open_id ??
    event.sender?.sender_id?.open_id ??
    event.user?.open_id ??
    null
  );
}
