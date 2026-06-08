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
      throw error;
    }
  }

  async stop() {
    const wsClient = this.#wsClient;
    this.#wsClient = null;
    if (wsClient && typeof wsClient.close === "function") {
      await wsClient.close({});
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
