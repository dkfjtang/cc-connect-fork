import { buildTaskCardAction } from "./task-card-actions.js";

export class TaskCardController {
  #sendAction;
  #maxSendAttempts;
  #retryDelayMs;
  #setTimeout;
  #syncQueue = Promise.resolve();

  constructor({
    sendAction,
    maxSendAttempts = 2,
    retryDelayMs = 300,
    setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
  }) {
    if (typeof sendAction !== "function") {
      throw new TypeError("TaskCardController requires a sendAction function");
    }
    if (!Number.isInteger(maxSendAttempts) || maxSendAttempts <= 0) {
      throw new TypeError("TaskCardController maxSendAttempts must be a positive integer");
    }

    this.#sendAction = sendAction;
    this.#maxSendAttempts = maxSendAttempts;
    this.#retryDelayMs = retryDelayMs;
    this.#setTimeout = setTimeoutFn;
  }

  async sync(task) {
    const syncOperation = this.#syncQueue.then(() => this.#syncNow(task));
    this.#syncQueue = syncOperation.catch(() => {});
    return syncOperation;
  }

  async #syncNow(task) {
    const action = buildTaskCardAction(task.snapshot());
    const result = await this.#sendWithRetry(action);

    if (action.type === "send" && result?.messageId) {
      task.attachCard(result.messageId);
    }

    return result;
  }

  async #sendWithRetry(action) {
    let lastError;
    for (let attempt = 1; attempt <= this.#maxSendAttempts; attempt += 1) {
      try {
        return await this.#sendAction(action);
      } catch (error) {
        lastError = error;
        if (attempt === this.#maxSendAttempts) {
          break;
        }
        await this.#delay();
      }
    }

    throw lastError;
  }

  #delay() {
    if (this.#retryDelayMs <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.#setTimeout(resolve, this.#retryDelayMs);
    });
  }
}
