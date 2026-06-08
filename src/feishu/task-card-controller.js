import { buildTaskCardAction } from "./task-card-actions.js";

export class TaskCardController {
  #sendAction;
  #maxSendAttempts;
  #retryDelayMs;
  #rateLimitRetryDelayMs;
  #setTimeout;
  #syncQueue = Promise.resolve();

  constructor({
    sendAction,
    maxSendAttempts = 2,
    retryDelayMs = 300,
    rateLimitRetryDelayMs = 1000,
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
    this.#rateLimitRetryDelayMs = rateLimitRetryDelayMs;
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
        if (attempt === this.#maxSendAttempts || !isRetryableError(error)) {
          break;
        }
        await this.#delay(retryDelayFor(error, attempt, {
          retryDelayMs: this.#retryDelayMs,
          rateLimitRetryDelayMs: this.#rateLimitRetryDelayMs,
        }));
      }
    }

    throw lastError;
  }

  #delay(delayMs) {
    if (delayMs <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.#setTimeout(resolve, delayMs);
    });
  }
}

function isRetryableError(error) {
  if (error?.name !== "FeishuApiError") {
    return true;
  }

  if (isRateLimitError(error)) {
    return true;
  }

  return error.code === null || error.code === undefined;
}

function retryDelayFor(error, attempt, { retryDelayMs, rateLimitRetryDelayMs }) {
  if (isRateLimitError(error)) {
    return rateLimitRetryDelayMs * 2 ** (attempt - 1);
  }

  return retryDelayMs;
}

function isRateLimitError(error) {
  return error?.code === 99991663;
}
