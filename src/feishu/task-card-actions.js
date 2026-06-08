import { renderTaskCard } from "./task-card-renderer.js";

export function buildTaskCardAction(snapshot) {
  const card = renderTaskCard(snapshot);

  if (snapshot.cardMessageId) {
    return {
      type: "update",
      messageId: snapshot.cardMessageId,
      card,
    };
  }

  if (!snapshot.feishuChatId) {
    throw new Error("feishuChatId is required to send a task card");
  }

  return {
    type: "send",
    receiveIdType: "chat_id",
    receiveId: snapshot.feishuChatId,
    messageType: "interactive",
    card,
  };
}
