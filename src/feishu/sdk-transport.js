export class FeishuSdkTransport {
  #appId;
  #appSecret;
  #verificationToken;
  #encryptKey;
  #createClient;
  #createEventDispatcher;
  #createWsClient;
  #logger;
  #clientPromise = null;
  #wsClient = null;

  constructor({
    appId,
    appSecret,
    verificationToken = "",
    encryptKey = "",
    createClient = createDefaultClient,
    createEventDispatcher = createDefaultEventDispatcher,
    createWsClient = createDefaultWsClient,
    logger = null,
  }) {
    if (!appId?.trim() || !appSecret?.trim()) {
      throw new Error("FeishuSdkTransport requires FEISHU_APP_ID and FEISHU_APP_SECRET");
    }

    this.#appId = appId.trim();
    this.#appSecret = appSecret.trim();
    this.#verificationToken = verificationToken;
    this.#encryptKey = encryptKey;
    this.#createClient = createClient;
    this.#createEventDispatcher = createEventDispatcher;
    this.#createWsClient = createWsClient;
    this.#logger = logger ?? {
      info: () => {},
      error: () => {},
    };
  }

  async sendMessage({ receiveIdType, receiveId, msgType, content }) {
    const client = await this.#client();
    return client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: msgType,
        content,
      },
    });
  }

  async patchMessageCard({ messageId, card }) {
    const client = await this.#client();
    return client.im.message.patch({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify(card),
      },
    });
  }

  async sendCardKitMessage({ receiveIdType, receiveId, card }) {
    const client = await this.#client();
    const createResponse = await client.cardkit.v1.card.create({
      data: {
        type: "card_json",
        data: JSON.stringify(toCardKitCard(card)),
      },
    });
    const cardId = createResponse?.data?.card_id;
    if (!cardId) {
      return createResponse;
    }

    const sendResponse = await this.sendMessage({
      receiveIdType,
      receiveId,
      msgType: "interactive",
      content: JSON.stringify({
        type: "card",
        data: {
          card_id: cardId,
        },
      }),
    });

    return {
      ...sendResponse,
      data: {
        ...(sendResponse?.data ?? {}),
        card_id: cardId,
        sequence: 1,
      },
    };
  }

  async updateCardKitCard({ cardId, sequence, card }) {
    const client = await this.#client();
    const response = await client.cardkit.v1.card.update({
      path: {
        card_id: cardId,
      },
      data: {
        card: {
          type: "card_json",
          data: JSON.stringify(toCardKitCard(card)),
        },
        sequence,
      },
    });

    return {
      ...response,
      data: {
        ...(response?.data ?? {}),
        sequence,
      },
    };
  }

  async updateCardKitElementContent({ cardId, elementId, sequence, content }) {
    const client = await this.#client();
    const response = await client.cardkit.v1.cardElement.content({
      path: {
        card_id: cardId,
        element_id: elementId,
      },
      data: {
        content,
        sequence,
      },
    });

    return {
      ...response,
      data: {
        ...(response?.data ?? {}),
        sequence,
      },
    };
  }

  async probeBot() {
    const client = await this.#client();
    try {
      const response = await client.request({
        method: "POST",
        url: "/open-apis/bot/v1/openclaw_bot/ping",
        data: { needBotInfo: true },
      });

      if (response?.code && response.code !== 0) {
        return {
          ok: false,
          appId: this.#appId,
          error: response.msg || `code ${response.code}`,
        };
      }

      const botInfo = response?.data?.pingBotInfo;
      return {
        ok: true,
        appId: this.#appId,
        botOpenId: botInfo?.botID,
        botName: botInfo?.botName,
      };
    } catch (error) {
      return {
        ok: false,
        appId: this.#appId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async startMessageListener({ onMessageReceive, onCardAction = async () => {} }) {
    if (typeof onMessageReceive !== "function") {
      throw new TypeError("startMessageListener requires onMessageReceive");
    }
    if (typeof onCardAction !== "function") {
      throw new TypeError("startMessageListener requires onCardAction");
    }

    await this.stop();
    this.#log("info", "feishu.ws_starting");
    const dispatcher = await this.#createEventDispatcher({
      verificationToken: this.#verificationToken,
      encryptKey: this.#encryptKey,
    });
    this.#log("info", "feishu.ws_dispatcher_created");

    const handlers = {
      "im.message.receive_v1": this.#wrapEventHandler("im.message.receive_v1", onMessageReceive),
      "im.message.message_read_v1": async () => {},
      "im.message.reaction.created_v1": async () => {},
      "im.message.reaction.deleted_v1": async () => {},
      "im.chat.access_event.bot_p2p_chat_entered_v1": async () => {},
      "im.chat.member.bot.added_v1": async () => {},
      "im.chat.member.bot.deleted_v1": async () => {},
      "card.action.trigger": this.#wrapEventHandler("card.action.trigger", onCardAction),
    };
    dispatcher.register({
      ...handlers,
    });
    this.#log("info", "feishu.ws_handlers_registered", {
      eventTypes: Object.keys(handlers),
    });

    const wsClient = await this.#createWsClient({
      appId: this.#appId,
      appSecret: this.#appSecret,
    });
    this.#wsClient = wsClient;
    this.#log("info", "feishu.ws_client_created");

    try {
      const result = await wsClient.start({ eventDispatcher: dispatcher });
      this.#log("info", "feishu.ws_started");
      return result;
    } catch (error) {
      this.#log("error", "feishu.ws_start_failed", errorLogFields(error));
      if (this.#wsClient === wsClient) {
        this.#wsClient = null;
      }
      if (typeof wsClient.close === "function") {
        try {
          await wsClient.close({});
        } catch (closeError) {
          this.#log("error", "feishu.ws_cleanup_failed", errorLogFields(closeError));
        }
      }
      throw error;
    }
  }

  async stop() {
    const wsClient = this.#wsClient;
    this.#wsClient = null;
    if (wsClient && typeof wsClient.close === "function") {
      try {
        await wsClient.close({});
        this.#log("info", "feishu.ws_stopped");
      } catch (error) {
        this.#log("error", "feishu.ws_stop_failed", errorLogFields(error));
        throw error;
      }
    }
  }

  async #client() {
    if (!this.#clientPromise) {
      this.#clientPromise = Promise.resolve(
        this.#createClient({
          appId: this.#appId,
          appSecret: this.#appSecret,
        }),
      );
    }

    return this.#clientPromise;
  }

  #wrapEventHandler(eventType, handler) {
    return async (payload) => {
      const fields = eventLogFields(eventType, payload);
      this.#log("info", "feishu.event_received", fields);
      try {
        return await handler(payload);
      } catch (error) {
        this.#log("error", "feishu.event_handler_failed", {
          ...fields,
          ...errorLogFields(error),
        });
        throw error;
      }
    };
  }

  #log(level, event, fields = {}) {
    const write = this.#logger[level] ?? this.#logger.info ?? (() => {});
    write(event, {
      appId: this.#appId,
      ...fields,
    });
  }
}

function eventLogFields(eventType, payload) {
  const event = payload?.event ?? {};
  const message = event.message ?? {};
  const context = event.context ?? payload?.context ?? {};

  return {
    eventType,
    messageId: message.message_id ?? context.open_message_id ?? null,
    chatId: message.chat_id ?? context.open_chat_id ?? null,
    chatType: message.chat_type ?? null,
  };
}

function errorLogFields(error) {
  const fields = {
    errorSummary: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof Error && error.name) {
    fields.errorName = error.name;
  }
  if (error?.code) {
    fields.errorCode = error.code;
  }
  return fields;
}

function toCardKitCard(card) {
  if (card?.schema === "2.0") {
    return card;
  }

  return {
    schema: "2.0",
    config: {
      ...(card?.config ?? {}),
      update_multi: true,
    },
    header: card?.header,
    body: {
      elements: (card?.elements ?? [])
        .map((element, index) => toCardKitElement(element, index))
        .filter(Boolean),
    },
  };
}

function toCardKitElement(element, index) {
  if (!element || typeof element !== "object") {
    return null;
  }
  if (element.tag === "markdown" && element.text?.content) {
    return {
      tag: "markdown",
      element_id: stableElementId(element, index),
      content: element.text.content,
    };
  }
  if (element.tag === "action" && Array.isArray(element.actions)) {
    return {
      ...element,
      element_id: stableElementId(element, index),
      actions: element.actions.map((action, actionIndex) => ({
        ...action,
        element_id: action.element_id ?? `fca_action_${actionIndex}`,
      })),
    };
  }
  if (element.tag === "note" && Array.isArray(element.elements)) {
    return {
      ...element,
      element_id: stableElementId(element, index),
      elements: element.elements.map((item) =>
        item?.tag === "lark_md" ? { ...item, content: item.content ?? "" } : item,
      ),
    };
  }
  return {
    ...element,
    element_id: stableElementId(element, index),
  };
}

function stableElementId(element, index) {
  if (element.element_id) {
    return element.element_id;
  }
  if (element.tag === "markdown") {
    return "fca_body";
  }
  if (element.tag === "action") {
    return "fca_actions";
  }
  if (element.tag === "hr") {
    return "fca_divider";
  }
  if (element.tag === "note") {
    return "fca_footer";
  }
  return `fca_element_${index}`;
}

async function createDefaultClient({ appId, appSecret }) {
  const sdk = await import("@larksuiteoapi/node-sdk");
  return new sdk.Client({
    appId,
    appSecret,
    appType: sdk.AppType.SelfBuild,
    domain: sdk.Domain.Feishu,
  });
}

async function createDefaultEventDispatcher({ verificationToken, encryptKey }) {
  const sdk = await import("@larksuiteoapi/node-sdk");
  return new sdk.EventDispatcher({
    verificationToken,
    encryptKey,
  });
}

async function createDefaultWsClient({ appId, appSecret }) {
  const sdk = await import("@larksuiteoapi/node-sdk");
  return new sdk.WSClient({
    appId,
    appSecret,
    domain: sdk.Domain.Feishu,
  });
}
