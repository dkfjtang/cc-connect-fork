export class UnsupportedFeishuEventError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedFeishuEventError";
  }
}

export function parseMessageReceiveEvent(payload, { botOpenId = null } = {}) {
  const event = payload?.event;
  const message = event?.message;

  if (message?.message_type !== "text") {
    throw new UnsupportedFeishuEventError("Only text messages are supported");
  }

  const content = parseContent(message.content);
  const chatType = message?.chat_type;
  if (chatType !== "p2p" && chatType !== "group") {
    throw new UnsupportedFeishuEventError("Only private or mentioned group text messages are supported");
  }

  let text = content.text?.trim();
  if (chatType === "group") {
    text = groupMentionText(content, botOpenId);
  }

  if (!text) {
    throw new UnsupportedFeishuEventError("Text message is empty");
  }

  return {
    messageId: message.message_id,
    openId: event?.sender?.sender_id?.open_id,
    chatId: message.chat_id,
    chatType,
    text,
  };
}

function groupMentionText(content, botOpenId) {
  if (!botOpenId) {
    throw new UnsupportedFeishuEventError("Group messages require bot open_id for mention filtering");
  }

  const mention = (content.mentions ?? []).find((item) => item?.id?.open_id === botOpenId);
  if (!mention?.key) {
    throw new UnsupportedFeishuEventError("Group message does not mention bot");
  }

  return content.text?.replace(mention.key, "").trim();
}

function parseContent(rawContent) {
  try {
    return JSON.parse(rawContent);
  } catch (cause) {
    throw new UnsupportedFeishuEventError("Invalid Feishu message content JSON", {
      cause,
    });
  }
}
