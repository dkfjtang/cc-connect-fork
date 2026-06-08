export class FeishuMessageClient {
  #transport;
  #cardChannel;

  constructor({ transport, cardChannel = "im" }) {
    this.#transport = transport;
    if (!["im", "cardkit"].includes(cardChannel)) {
      throw new Error("FeishuMessageClient cardChannel must be im or cardkit");
    }
    this.#cardChannel = cardChannel;
  }

  async sendAction(action) {
    if (action.type === "send") {
      return this.#sendCard(action);
    }

    if (action.type === "update") {
      return this.#updateCard(action);
    }

    throw new Error(`Unsupported Feishu action type: ${action.type}`);
  }

  async sendTextMessage({ chatId, text }) {
    if (!chatId) {
      throw new Error("chatId is required");
    }

    const response = await callFeishuAction("send", () =>
      this.#transport.sendMessage({
        receiveIdType: "chat_id",
        receiveId: chatId,
        msgType: "text",
        content: JSON.stringify({ text }),
      }),
    );

    return {
      messageId: response?.data?.message_id ?? null,
    };
  }

  async #sendCard(action) {
    if (this.#cardChannel === "cardkit") {
      return this.#sendCardKitCardWithFallback(action);
    }

    return this.#sendImCard(action);
  }

  async #sendCardKitCardWithFallback(action) {
    if (typeof this.#transport.sendCardKitMessage === "function") {
      try {
        const response = await callFeishuAction("send", () =>
          this.#transport.sendCardKitMessage({
            receiveIdType: action.receiveIdType,
            receiveId: action.receiveId,
            card: action.card,
          }),
        );

        return {
          messageId: response?.data?.message_id ?? response?.data?.messageId ?? null,
          cardChannel: "cardkit",
          cardId: response?.data?.card_id ?? response?.data?.cardId ?? null,
          cardSequence: normalizeSequence(response?.data?.sequence),
        };
      } catch {
        // Fall back to the stable IM card path when CardKit is unavailable or rejected.
      }
    }

    return this.#sendImCard(action);
  }

  async #sendImCard(action) {
    const response = await callFeishuAction("send", () =>
      this.#transport.sendMessage({
        receiveIdType: action.receiveIdType,
        receiveId: action.receiveId,
        msgType: action.messageType,
        content: JSON.stringify(action.card),
      }),
    );

    return {
      messageId: response?.data?.message_id ?? null,
      cardChannel: "im",
      cardId: null,
      cardSequence: null,
    };
  }

  async #updateCard(action) {
    if (
      action.cardChannel === "cardkit" &&
      action.cardId &&
      typeof this.#transport.updateCardKitCard === "function"
    ) {
      try {
        const response = await callFeishuAction("update", () =>
          this.#transport.updateCardKitCard({
            cardId: action.cardId,
            sequence: nextSequence(action.cardSequence),
            card: action.card,
          }),
        );

        return {
          cardChannel: "cardkit",
          cardId: action.cardId,
          cardSequence: normalizeSequence(
            response?.data?.sequence,
            nextSequence(action.cardSequence),
          ),
        };
      } catch {
        // Keep the already-sent message usable by patching it through the IM fallback.
      }
    }

    await callFeishuAction("update", () =>
      this.#transport.patchMessageCard({
        messageId: action.messageId,
        card: action.card,
      }),
    );

    return {
      cardChannel: "im",
      cardId: null,
      cardSequence: null,
    };
  }
}

export class FeishuApiError extends Error {
  constructor({ actionType, code = null, message, cause = null }) {
    super(`Feishu ${actionType} failed${code ? ` (${code})` : ""}: ${message}`, { cause });
    this.name = "FeishuApiError";
    this.actionType = actionType;
    this.code = code;
  }
}

async function callFeishuAction(actionType, action) {
  try {
    const response = await action();
    if (response?.code && response.code !== 0) {
      throw new FeishuApiError({
        actionType,
        code: response.code,
        message: response.msg || "Feishu API returned an error",
      });
    }

    return response;
  } catch (error) {
    if (error instanceof FeishuApiError) {
      throw error;
    }

    throw new FeishuApiError({
      actionType,
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
}

function nextSequence(value) {
  return normalizeSequence(value) + 1;
}

function normalizeSequence(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
