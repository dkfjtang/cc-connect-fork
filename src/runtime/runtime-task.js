import { TurnOutputBuffer } from "../codex/turn-output-buffer.js";

export class RuntimeTask {
  #taskId;
  #feishuMessageId;
  #feishuOpenId;
  #feishuChatId;
  #feishuChatType;
  #cardMessageId = null;
  #threadId = null;
  #turnId = null;
  #cwd;
  #model;
  #appVersion;
  #now;
  #startedAt;
  #completedAt = null;
  #status = "queued";
  #errorSummary = null;
  #errorType = null;
  #output;

  constructor({
    taskId,
    feishuMessageId = null,
    feishuOpenId = null,
    feishuChatId = null,
    feishuChatType = null,
    cwd = null,
    model = null,
    appVersion = null,
    now = () => Date.now(),
    summaryLimit,
  }) {
    this.#taskId = taskId;
    this.#feishuMessageId = feishuMessageId;
    this.#feishuOpenId = feishuOpenId;
    this.#feishuChatId = feishuChatId;
    this.#feishuChatType = feishuChatType;
    this.#cwd = cwd;
    this.#model = model;
    this.#appVersion = appVersion;
    this.#now = now;
    this.#startedAt = this.#now();
    this.#output = new TurnOutputBuffer({ summaryLimit });
  }

  attachThread(threadId) {
    this.#threadId = threadId;
  }

  attachCard(cardMessageId) {
    this.#cardMessageId = cardMessageId;
  }

  cancel(reason = "任务已取消") {
    this.#status = "cancelled";
    this.#errorSummary = reason;
    this.#errorType = "cancelled";
    this.#completedAt = this.#now();
  }

  handleCodexEvent(event) {
    if (this.#status === "cancelled") {
      return;
    }

    switch (event.method) {
      case "turn/started":
        this.#turnId = event.params?.turn?.id ?? this.#turnId;
        if (this.#status === "queued") {
          this.#status = "running";
        }
        break;
      case "item/agentMessage/delta":
        this.#output.appendDelta(event.params?.delta);
        break;
      case "turn/completed":
        this.#handleTurnCompleted(event.params);
        break;
      default:
        break;
    }
  }

  snapshot() {
    return {
      taskId: this.#taskId,
      feishuMessageId: this.#feishuMessageId,
      feishuOpenId: this.#feishuOpenId,
      feishuChatId: this.#feishuChatId,
      feishuChatType: this.#feishuChatType,
      cardMessageId: this.#cardMessageId,
      threadId: this.#threadId,
      turnId: this.#turnId,
      cwd: this.#cwd,
      model: this.#model,
      appVersion: this.#appVersion,
      status: this.#status,
      startedAt: this.#startedAt,
      completedAt: this.#completedAt,
      elapsedMs: this.#elapsedMs(),
      summaryText: this.#output.summaryText(),
      finalText: this.#output.finalText(),
      errorSummary: this.#errorSummary,
      errorType: this.#errorType,
    };
  }

  #handleTurnCompleted(params = {}) {
    this.#completedAt = this.#now();
    if (params.status === "failed" || params.error) {
      this.#status = "failed";
      this.#errorSummary = params.error?.message ?? "Codex turn failed";
      this.#errorType = params.error?.type ?? params.status ?? "failed";
      return;
    }

    this.#status = "completed";
  }

  #elapsedMs() {
    return (this.#completedAt ?? this.#now()) - this.#startedAt;
  }
}
