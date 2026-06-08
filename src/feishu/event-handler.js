import {
  parseMessageReceiveEvent,
  parseUnsupportedMessageEnvelope,
  UnsupportedFeishuEventError,
} from "./message-event-parser.js";
import {
  parseCardActionEvent,
  UnsupportedFeishuCardActionError,
} from "./card-action-parser.js";
import { decideAttachmentInput } from "./attachment-policy.js";

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
  #feishuFileInputsEnabled;
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
    feishuFileInputsEnabled = false,
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
    this.#feishuFileInputsEnabled = feishuFileInputsEnabled;
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

      const result = await this.#runtime.syncActiveTaskStatus({
        chatId: message.chatId,
      });
      if (result?.reason === "No active task for chat") {
        return this.#handleNoActiveTaskStatus(message.chatId);
      }
      return result;
    }

    const unsupportedCommand = matchUnsupportedTextCommand(message.text);
    if (unsupportedCommand) {
      return this.#handleUnsupportedTextCommand(message.chatId, unsupportedCommand);
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
    const envelope = parseUnsupportedMessageEnvelope(payload);
    const decision = decideAttachmentInput(envelope, {
      enabled: this.#feishuFileInputsEnabled,
    });
    const messageId = envelope.messageId;
    if (decision.action === "skip") {
      return {
        status: "skipped",
        reason: decision.reason,
        attachmentKind: decision.attachmentKind,
      };
    }
    if (this.#seenMessageIds.has(messageId) || (await this.#hasSeenMessage(messageId))) {
      return { status: "skipped", reason: "Duplicate Feishu message" };
    }

    this.#seenMessageIds.add(messageId);
    await this.#markSeenMessage(messageId);

    if (!this.#unsupportedMessageClient?.sendTextMessage) {
      return {
        status: "skipped",
        reason: decision.reason,
        attachmentKind: decision.attachmentKind,
      };
    }

    await this.#unsupportedMessageClient.sendTextMessage({
      chatId: envelope.chatId,
      text: attachmentDecisionNotice(decision),
    });

    return {
      status: "handled",
      reason: decision.reason,
      attachmentKind: decision.attachmentKind,
    };
  }

  async #handleUnsupportedTextCommand(chatId, command) {
    if (!this.#unsupportedMessageClient?.sendTextMessage) {
      return { status: "skipped", reason: command.reason };
    }

    await this.#unsupportedMessageClient.sendTextMessage({
      chatId,
      text: command.text,
    });

    return { status: "handled", reason: command.reason };
  }

  async #handleNoActiveTaskStatus(chatId) {
    const reason = "No active task for chat";
    if (!this.#unsupportedMessageClient?.sendTextMessage) {
      return { status: "skipped", reason };
    }

    await this.#unsupportedMessageClient.sendTextMessage({
      chatId,
      text: "当前会话没有正在运行的 Codex 任务。",
    });

    return { status: "handled", reason };
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
    if (result?.attachmentKind) {
      fields.attachmentKind = result.attachmentKind;
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

const UNSUPPORTED_TEXT_COMMANDS = [
  {
    pattern: /^(\/cwd|cwd)(\s+.*)?$/i,
    reason: "Cwd command is not supported",
    text: "暂不支持在飞书内切换工作目录。当前版本只使用已配置的默认工作目录；后续开放 /cwd 时会先经过工作目录白名单校验。",
  },
  {
    pattern: /^(\/clear|clear|清理会话|重置会话)(\s+.*)?$/i,
    reason: "Clear command is not supported",
    text: "暂不支持在飞书内清理会话或重置线程。当前版本会继续复用已保存的 Codex thread；后续开放 /clear 时会先加入确认和审计。",
  },
  {
    pattern: /^(\/permission|permission|权限)(\s+.*)?$/i,
    reason: "Permission command is not supported",
    text: "暂不支持在飞书内修改 Codex 权限策略。当前版本仍使用本地已配置的权限边界；后续开放 /permission 时会先加入确认、审计和最小权限校验。",
  },
];

function attachmentDecisionNotice(decision) {
  if (decision.action === "eligible") {
    return "飞书附件输入能力尚未完成下载和审批闭环，当前不会下载附件。请先发送文本任务。";
  }
  if (decision.action === "notify_unsupported") {
    return "暂不支持该类型的飞书消息。请先发送文本任务。";
  }
  return "暂不支持文件、图片、文档或语音消息。请先发送文本任务；文件下载与回传能力将在后续版本开放。";
}

function matchUnsupportedTextCommand(text) {
  const normalized = text.trim();
  return UNSUPPORTED_TEXT_COMMANDS.find((command) => command.pattern.test(normalized)) ?? null;
}

function mapGroupSenderOpenIds(policy) {
  const result = new Map();
  for (const [chatId, openIds] of Object.entries(policy ?? {})) {
    result.set(chatId, new Set(openIds));
  }
  return result;
}
