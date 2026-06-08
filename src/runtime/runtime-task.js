import { TurnOutputBuffer } from "../codex/turn-output-buffer.js";

export class RuntimeTask {
  #taskId;
  #feishuMessageId;
  #feishuOpenId;
  #feishuChatId;
  #cardMessageId = null;
  #threadId = null;
  #turnId = null;
  #cwd;
  #status = "queued";
  #errorSummary = null;
  #output;

  constructor({
    taskId,
    feishuMessageId = null,
    feishuOpenId = null,
    feishuChatId = null,
    cwd = null,
    summaryLimit,
  }) {
    this.#taskId = taskId;
    this.#feishuMessageId = feishuMessageId;
    this.#feishuOpenId = feishuOpenId;
    this.#feishuChatId = feishuChatId;
    this.#cwd = cwd;
    this.#output = new TurnOutputBuffer({ summaryLimit });
  }

  attachThread(threadId) {
    this.#threadId = threadId;
  }

  attachCard(cardMessageId) {
    this.#cardMessageId = cardMessageId;
  }

  handleCodexEvent(event) {
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
      cardMessageId: this.#cardMessageId,
      threadId: this.#threadId,
      turnId: this.#turnId,
      cwd: this.#cwd,
      status: this.#status,
      summaryText: this.#output.summaryText(),
      finalText: this.#output.finalText(),
      errorSummary: this.#errorSummary,
    };
  }

  #handleTurnCompleted(params = {}) {
    if (params.status === "failed" || params.error) {
      this.#status = "failed";
      this.#errorSummary = params.error?.message ?? "Codex turn failed";
      return;
    }

    this.#status = "completed";
  }
}
