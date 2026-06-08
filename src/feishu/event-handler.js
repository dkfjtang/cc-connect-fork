import {
  parseMessageReceiveEvent,
  UnsupportedFeishuEventError,
} from "./message-event-parser.js";
import {
  parseCardActionEvent,
  UnsupportedFeishuCardActionError,
} from "./card-action-parser.js";

export class FeishuEventHandler {
  #runtime;
  #expectedAppId;
  #botOpenId;
  #allowedGroupChatIds;
  #groupSenderOpenIds;
  #now;
  #maxEventAgeMs;
  #messageDedupStore;
  #seenMessageIds = new Set();
  #chatQueues = new Map();

  constructor({
    runtime,
    expectedAppId = null,
    botOpenId = null,
    allowedGroupChatIds = [],
    groupSenderOpenIds = {},
    now = () => Date.now(),
    maxEventAgeMs = 5 * 60 * 1000,
    messageDedupStore = null,
  }) {
    this.#runtime = runtime;
    this.#expectedAppId = expectedAppId;
    this.#botOpenId = botOpenId;
    this.#allowedGroupChatIds = new Set(allowedGroupChatIds);
    this.#groupSenderOpenIds = mapGroupSenderOpenIds(groupSenderOpenIds);
    this.#now = now;
    this.#maxEventAgeMs = maxEventAgeMs;
    this.#messageDedupStore = messageDedupStore;
  }

  async handleMessageReceive(payload) {
    const precheck = this.#precheck(payload);
    if (precheck) {
      return precheck;
    }

    let message;
    try {
      message = parseMessageReceiveEvent(payload, { botOpenId: this.#botOpenId });
    } catch (error) {
      if (error instanceof UnsupportedFeishuEventError) {
        return { status: "skipped", reason: error.message };
      }
      throw error;
    }

    if (!this.#canUseChat(message)) {
      return { status: "skipped", reason: "Feishu group chat is not allowed" };
    }
    if (!this.#canUseGroupSender(message)) {
      return { status: "skipped", reason: "Feishu group sender is not allowed" };
    }

    if (this.#seenMessageIds.has(message.messageId) || (await this.#hasSeenMessage(message.messageId))) {
      return { status: "skipped", reason: "Duplicate Feishu message" };
    }
    this.#seenMessageIds.add(message.messageId);
    await this.#markSeenMessage(message.messageId);

    if (isCancelText(message.text)) {
      if (typeof this.#runtime.cancelActiveTask !== "function") {
        return { status: "skipped", reason: "Cancel is not supported" };
      }

      return this.#runtime.cancelActiveTask({
        chatId: message.chatId,
        reason: "用户已停止任务",
      });
    }

    if (isStatusText(message.text)) {
      if (typeof this.#runtime.syncActiveTaskStatus !== "function") {
        return { status: "skipped", reason: "Status refresh is not supported" };
      }

      return this.#runtime.syncActiveTaskStatus({
        chatId: message.chatId,
      });
    }

    return this.#enqueue(message.chatId, async () => {
      const task = await this.#runtime.handleTextMessage(message);
      return {
        status: "handled",
        taskStatus: task.snapshot().status,
      };
    });
  }

  async handleCardAction(payload) {
    const precheck = this.#precheck(payload);
    if (precheck) {
      return precheck;
    }

    let action;
    try {
      action = parseCardActionEvent(payload);
    } catch (error) {
      if (error instanceof UnsupportedFeishuCardActionError) {
        return { status: "skipped", reason: error.message };
      }
      throw error;
    }

    if (typeof this.#runtime.resolveApproval !== "function") {
      return { status: "skipped", reason: "Approval actions are not supported" };
    }

    return this.#runtime.resolveApproval(action);
  }

  async #hasSeenMessage(messageId) {
    return (await this.#messageDedupStore?.has(messageId)) ?? false;
  }

  async #markSeenMessage(messageId) {
    await this.#messageDedupStore?.mark(messageId);
  }

  #precheck(payload) {
    const appId = payload?.app_id;
    if (this.#expectedAppId && appId && appId !== this.#expectedAppId) {
      return { status: "skipped", reason: "Feishu app_id mismatch" };
    }

    const senderOpenId =
      payload?.event?.sender?.sender_id?.open_id ??
      payload?.event?.operator?.open_id ??
      payload?.event?.operator?.operator_id?.open_id;
    if (this.#botOpenId && senderOpenId && senderOpenId === this.#botOpenId) {
      return { status: "skipped", reason: "Self-echo Feishu message" };
    }

    const createTime = Number(payload?.event?.message?.create_time);
    if (Number.isFinite(createTime) && this.#now() - createTime > this.#maxEventAgeMs) {
      return { status: "skipped", reason: "Feishu message is stale" };
    }

    return null;
  }

  #enqueue(chatId, task) {
    const key = chatId || "unknown";
    const previous = this.#chatQueues.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    this.#chatQueues.set(key, current);

    const cleanup = () => {
      if (this.#chatQueues.get(key) === current) {
        this.#chatQueues.delete(key);
      }
    };
    current.then(cleanup, cleanup);

    return current;
  }

  #canUseChat(message) {
    if (message.chatType !== "group") {
      return true;
    }
    if (this.#allowedGroupChatIds.size === 0) {
      return true;
    }

    return this.#allowedGroupChatIds.has(message.chatId);
  }

  #canUseGroupSender(message) {
    if (message.chatType !== "group") {
      return true;
    }

    const allowedOpenIds = this.#groupSenderOpenIds.get(message.chatId);
    if (!allowedOpenIds) {
      return true;
    }

    return allowedOpenIds.has(message.openId);
  }
}

function isCancelText(text) {
  return /^(取消|停止|终止|中止|stop|abort|cancel|cancel task|stop task)$/i.test(text.trim());
}

function isStatusText(text) {
  return /^(状态|查询状态|任务状态|当前状态|\/status|status|task status)$/i.test(text.trim());
}

function mapGroupSenderOpenIds(policy) {
  const result = new Map();
  for (const [chatId, openIds] of Object.entries(policy ?? {})) {
    result.set(chatId, new Set(openIds));
  }
  return result;
}
