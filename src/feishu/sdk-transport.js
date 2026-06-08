export class FeishuSdkTransport {
  #appId;
  #appSecret;
  #verificationToken;
  #encryptKey;
  #createClient;
  #createEventDispatcher;
  #createWsClient;
  #clientPromise = null;

  constructor({
    appId,
    appSecret,
    verificationToken = "",
    encryptKey = "",
    createClient = createDefaultClient,
    createEventDispatcher = createDefaultEventDispatcher,
    createWsClient = createDefaultWsClient,
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

    const dispatcher = await this.#createEventDispatcher({
      verificationToken: this.#verificationToken,
      encryptKey: this.#encryptKey,
    });
    dispatcher.register({
      "im.message.receive_v1": onMessageReceive,
      "im.message.message_read_v1": async () => {},
      "im.message.reaction.created_v1": async () => {},
      "im.message.reaction.deleted_v1": async () => {},
      "im.chat.access_event.bot_p2p_chat_entered_v1": async () => {},
      "im.chat.member.bot.added_v1": async () => {},
      "im.chat.member.bot.deleted_v1": async () => {},
      "card.action.trigger": onCardAction,
    });

    const wsClient = await this.#createWsClient({
      appId: this.#appId,
      appSecret: this.#appSecret,
    });
    return wsClient.start({ eventDispatcher: dispatcher });
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
