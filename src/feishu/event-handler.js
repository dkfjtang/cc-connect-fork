import {
  parseMessageReceiveEvent,
  UnsupportedFeishuEventError,
} from "./message-event-parser.js";

export class FeishuEventHandler {
  #runtime;
  #expectedAppId;
  #botOpenId;
  #now;
  #maxEventAgeMs;
  #seenMessageIds = new Set();

  constructor({
    runtime,
    expectedAppId = null,
    botOpenId = null,
    now = () => Date.now(),
    maxEventAgeMs = 5 * 60 * 1000,
  }) {
    this.#runtime = runtime;
    this.#expectedAppId = expectedAppId;
    this.#botOpenId = botOpenId;
    this.#now = now;
    this.#maxEventAgeMs = maxEventAgeMs;
  }

  async handleMessageReceive(payload) {
    const precheck = this.#precheck(payload);
    if (precheck) {
      return precheck;
    }

    let message;
    try {
      message = parseMessageReceiveEvent(payload);
    } catch (error) {
      if (error instanceof UnsupportedFeishuEventError) {
        return { status: "skipped", reason: error.message };
      }
      throw error;
    }

    if (this.#seenMessageIds.has(message.messageId)) {
      return { status: "skipped", reason: "Duplicate Feishu message" };
    }
    this.#seenMessageIds.add(message.messageId);

    const task = await this.#runtime.handleTextMessage(message);
    return {
      status: "handled",
      taskStatus: task.snapshot().status,
    };
  }

  #precheck(payload) {
    const appId = payload?.app_id;
    if (this.#expectedAppId && appId && appId !== this.#expectedAppId) {
      return { status: "skipped", reason: "Feishu app_id mismatch" };
    }

    const senderOpenId = payload?.event?.sender?.sender_id?.open_id;
    if (this.#botOpenId && senderOpenId && senderOpenId === this.#botOpenId) {
      return { status: "skipped", reason: "Self-echo Feishu message" };
    }

    const createTime = Number(payload?.event?.message?.create_time);
    if (Number.isFinite(createTime) && this.#now() - createTime > this.#maxEventAgeMs) {
      return { status: "skipped", reason: "Feishu message is stale" };
    }

    return null;
  }
}
