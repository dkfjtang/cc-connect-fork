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
  #unsupportedMessageClient;
  #logger;
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
    unsupportedMessageClient = null,
    logger = null,
  }) {
    this.#runtime = runtime;
    this.#expectedAppId = expectedAppId;
    this.#botOpenId = botOpenId;
    this.#allowedGroupChatIds = new Set(allowedGroupChatIds);
    this.#groupSenderOpenIds = mapGroupSenderOpenIds(groupSenderOpenIds);
    this.#now = now;
    this.#maxEventAgeMs = maxEventAgeMs;
    this.#messageDedupStore = messageDedupStore;
    this.#unsupportedMessageClient = unsupportedMessageClient;
    this.#logger = logger ?? {
      info: () => {},
    };
  }

  async handleMessageReceive(payload) {
    const startedAt = this.#now();
    const result = await this.#handleMessageReceive(payload);
    this.#logMessageResult(payload, result, {
      durationMs: Math.max(0, this.#now() - startedAt),
    });
    return result;
  }

  async #handleMessageReceive(payload) {
    const precheck = this.#precheck(payload);
    if (precheck) {
      return precheck;
    }

    let message;
    try {
      message = parseMessageReceiveEvent(payload, { botOpenId: this.#botOpenId });
    } catch (error) {
      if (error instanceof UnsupportedFeishuEventError) {
        if (error.message === "Only text messages are supported") {
          return this.#handleUnsupportedMessageType(payload);
        }
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

    if (isCwdText(message.text)) {
      return this.#handleUnsupportedCwdCommand(message.chatId);
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

    if (!this.#canUseGroupActionSender(action)) {
      return { status: "skipped", reason: "Feishu group sender is not allowed" };
    }

    if (action.action === "approval.details") {
      if (typeof this.#runtime.showApprovalDetails !== "function") {
        return { status: "skipped", reason: "Approval details are not supported" };
      }

      return this.#runtime.showApprovalDetails(action);
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

  async #handleUnsupportedMessageType(payload) {
    const message = payload?.event?.message;
    const messageId = message?.message_id;
    if (!messageId || !message?.chat_id || message?.chat_type !== "p2p") {
      return { status: "skipped", reason: "Only text messages are supported" };
    }
    if (this.#seenMessageIds.has(messageId) || (await this.#hasSeenMessage(messageId))) {
      return { status: "skipped", reason: "Duplicate Feishu message" };
    }

    this.#seenMessageIds.add(messageId);
    await this.#markSeenMessage(messageId);

    if (!this.#unsupportedMessageClient?.sendTextMessage) {
      return { status: "skipped", reason: "Only text messages are supported" };
    }

    await this.#unsupportedMessageClient.sendTextMessage({
      chatId: message.chat_id,
      text: "暂不支持文件、图片、文档或语音消息。请先发送文本任务；文件下载与回传能力将在后续版本开放。",
    });

    return { status: "handled", reason: "Unsupported Feishu message type notified" };
  }

  async #handleUnsupportedCwdCommand(chatId) {
    if (!this.#unsupportedMessageClient?.sendTextMessage) {
      return { status: "skipped", reason: "Cwd command is not supported" };
    }

    await this.#unsupportedMessageClient.sendTextMessage({
      chatId,
      text: "暂不支持在飞书内切换工作目录。当前版本只使用已配置的默认工作目录；后续开放 /cwd 时会先经过工作目录白名单校验。",
    });

    return { status: "handled", reason: "Cwd command is not supported" };
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

  #canUseGroupActionSender(action) {
    const allowedOpenIds = this.#groupSenderOpenIds.get(action.chatId);
    if (!allowedOpenIds) {
      return true;
    }

    return allowedOpenIds.has(action.openId);
  }

  #logMessageResult(payload, result, { durationMs }) {
    const event = result?.status === "skipped" ? "feishu.message_skipped" : "feishu.message_handled";
    const write = this.#logger.info ?? (() => {});
    const fields = {
      ...messageLogFields(payload),
      resultStatus: result?.status ?? "unknown",
      durationMs,
    };
    if (result?.taskStatus) {
      fields.taskStatus = result.taskStatus;
    }
    if (result?.reason) {
      fields.reason = result.reason;
    }
    write(event, fields);
  }
}

function messageLogFields(payload) {
  const message = payload?.event?.message ?? {};
  return {
    messageId: message.message_id ?? null,
    chatId: message.chat_id ?? null,
    chatType: message.chat_type ?? null,
  };
}

function isCancelText(text) {
  return /^(取消|停止|终止|中止|stop|abort|cancel|cancel task|stop task)$/i.test(text.trim());
}

function isStatusText(text) {
  return /^(状态|查询状态|任务状态|当前状态|\/status|status|task status)$/i.test(text.trim());
}

function isCwdText(text) {
  return /^(\/cwd|cwd)(\s+.*)?$/i.test(text.trim());
}

function mapGroupSenderOpenIds(policy) {
  const result = new Map();
  for (const [chatId, openIds] of Object.entries(policy ?? {})) {
    result.set(chatId, new Set(openIds));
  }
  return result;
}
