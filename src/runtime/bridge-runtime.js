import { RuntimeTask } from "./runtime-task.js";

export class BridgeRuntime {
  #policy;
  #threadStore;
  #session;
  #cardController;

  constructor({ policy, threadStore, session, cardController, turnTimeoutMs = 900_000 }) {
    this.#policy = policy;
    this.#threadStore = threadStore;
    this.#session = session;
    this.#cardController = cardController;
    this.turnTimeoutMs = turnTimeoutMs;
  }

  async handleTextMessage({ messageId, openId, chatId, text }) {
    if (!this.#policy.canUseOpenId(openId)) {
      throw new Error("Feishu user is not allowed");
    }

    const cwd = this.#policy.defaultWorkdir();
    if (!this.#policy.canUseWorkdir(cwd)) {
      throw new Error("Default workdir is not allowed");
    }

    const task = new RuntimeTask({
      taskId: messageId,
      feishuMessageId: messageId,
      feishuOpenId: openId,
      feishuChatId: chatId,
      cwd,
    });

    await this.#cardController.sync(task);

    const mapping = await this.#threadStore.getThread({ openId, cwd });
    let threadId = mapping?.threadId;

    if (!threadId) {
      const threadResult = await this.#session.startThread({});
      threadId = threadResult.thread.id;
      task.attachThread(threadId);
    } else {
      task.attachThread(threadId);
    }

    const turnCompleted = this.#waitForTurnCompletion(task);
    const turnResult = await this.#session.startTurn({ threadId, text, cwd });
    if (turnResult.turn?.id) {
      task.handleCodexEvent({
        method: "turn/started",
        params: { turn: { id: turnResult.turn.id } },
      });
    }

    await turnCompleted;

    await this.#threadStore.saveThread({
      openId,
      cwd,
      threadId,
      lastTurnId: task.snapshot().turnId,
    });
    await this.#cardController.sync(task);

    return task;
  }

  #waitForTurnCompletion(task) {
    let unsubscribe = () => {};
    let timeoutId;

    const completed = new Promise((resolve, reject) => {
      unsubscribe = this.#session.onEvent((event) => {
        task.handleCodexEvent(event);
        if (event.method === "turn/completed") {
          resolve();
        }
      });

      timeoutId = setTimeout(() => {
        reject(new Error("Timed out waiting for Codex turn completion"));
      }, this.turnTimeoutMs);
    });

    return completed.finally(() => {
      clearTimeout(timeoutId);
      unsubscribe();
    });
  }
}
