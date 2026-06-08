import { RuntimeTask } from "./runtime-task.js";

export class BridgeRuntime {
  #policy;
  #threadStore;
  #session;
  #cardController;
  #now;
  #setTimeout;
  #clearTimeout;
  #runningUpdateThrottleMs;
  #logger;
  #model;
  #appVersion;
  #activeTasks = new Map();

  constructor({
    policy,
    threadStore,
    session,
    cardController,
    turnTimeoutMs = 900_000,
    runningUpdateThrottleMs = 3000,
    now = () => Date.now(),
    setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
    clearTimeoutFn = (timer) => clearTimeout(timer),
    logger = null,
    model = null,
    appVersion = null,
  }) {
    this.#policy = policy;
    this.#threadStore = threadStore;
    this.#session = session;
    this.#cardController = cardController;
    this.turnTimeoutMs = turnTimeoutMs;
    this.#runningUpdateThrottleMs = runningUpdateThrottleMs;
    this.#now = now;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
    this.#model = model;
    this.#appVersion = appVersion;
    this.#logger = logger ?? {
      info: () => {},
      error: () => {},
    };
  }

  async handleTextMessage({ messageId, openId, chatId, chatType = null, text }) {
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
      feishuChatType: chatType,
      cwd,
      model: this.#model,
      appVersion: this.#appVersion,
    });
    const activeKey = chatId || "unknown";
    const activeTask = {
      task,
      runningUpdates: null,
      resolveCancellation: null,
      cancelled: false,
    };
    this.#activeTasks.set(activeKey, activeTask);
    this.#logTask("info", "task.received", task);

    try {
      await this.#cardController.sync(task);

      const threadMapping = threadMappingFields({ openId, chatId, chatType, cwd });
      const mapping = await this.#threadStore.getThread(threadMapping);
      let threadId = mapping?.threadId;

      if (!threadId) {
        const threadResult = await this.#session.startThread(
          this.#model ? { model: this.#model } : {},
        );
        threadId = threadResult.thread.id;
        task.attachThread(threadId);
        this.#logTask("info", "task.thread_created", task);
      } else {
        task.attachThread(threadId);
        this.#logTask("info", "task.thread_reused", task);
      }

      const runningUpdates = this.#createRunningUpdateScheduler(task);
      activeTask.runningUpdates = runningUpdates;
      const cancellation = new Promise((resolve) => {
        activeTask.resolveCancellation = resolve;
      });
      const turnCompleted = this.#waitForTurnCompletion(task, runningUpdates, cancellation);
      if (activeTask.cancelled) {
        activeTask.resolveCancellation();
      } else {
        try {
          const turnResult = await this.#session.startTurn({ threadId, text, cwd });
          if (turnResult.turn?.id) {
            task.handleCodexEvent({
              method: "turn/started",
              params: { turn: { id: turnResult.turn.id } },
            });
            this.#logTask("info", "task.turn_started", task);
          }
        } catch (error) {
          activeTask.resolveCancellation();
          await turnCompleted.catch(() => {});
          throw error;
        }
      }

      try {
        await turnCompleted;
      } finally {
        runningUpdates.cancel();
      }

      await this.#threadStore.saveThread({
        ...threadMapping,
        openId,
        chatId,
        chatType,
        cwd,
        threadId,
        lastTurnId: task.snapshot().turnId,
      });
      await this.#cardController.sync(task);
      const finalStatus = task.snapshot().status;
      this.#logTask(finalStatus === "failed" ? "error" : "info", `task.${finalStatus}`, task);

      return task;
    } catch (error) {
      this.#logTask("error", "task.error", task, errorLogFields(error));
      throw error;
    } finally {
      if (this.#activeTasks.get(activeKey) === activeTask) {
        this.#activeTasks.delete(activeKey);
      }
    }
  }

  async cancelActiveTask({ chatId, reason = "任务已取消" }) {
    const activeTask = this.#activeTasks.get(chatId || "unknown");
    if (!activeTask) {
      return { status: "skipped", reason: "No active task for chat" };
    }

    const snapshot = activeTask.task.snapshot();
    activeTask.cancelled = true;
    activeTask.task.cancel(reason);
    activeTask.runningUpdates?.cancel();

    if (snapshot.threadId && snapshot.turnId && typeof this.#session.interruptTurn === "function") {
      try {
        await this.#session.interruptTurn({
          threadId: snapshot.threadId,
          turnId: snapshot.turnId,
        });
      } catch {
        // The Feishu-side cancellation state is still useful if app-server interrupt fails.
      }
    }

    await this.#cardController.sync(activeTask.task);
    activeTask.resolveCancellation?.();

    return { status: "cancelled", taskStatus: "cancelled" };
  }

  #waitForTurnCompletion(task, runningUpdates, cancellation) {
    let unsubscribe = () => {};
    let timeoutId;

    const completed = new Promise((resolve, reject) => {
      unsubscribe = this.#session.onEvent((event) => {
        task.handleCodexEvent(event);
        if (event.method === "item/agentMessage/delta") {
          runningUpdates.schedule();
        }
        if (event.method === "turn/completed") {
          resolve();
        }
      });

      timeoutId = setTimeout(() => {
        reject(new Error("Timed out waiting for Codex turn completion"));
      }, this.turnTimeoutMs);

      cancellation.then(resolve);
    });

    return completed.finally(() => {
      clearTimeout(timeoutId);
      unsubscribe();
    });
  }

  #createRunningUpdateScheduler(task) {
    let timer = null;
    let lastSyncAt = this.#now();

    const syncRunning = async () => {
      timer = null;
      lastSyncAt = this.#now();
      if (task.snapshot().status === "running") {
        try {
          await this.#cardController.sync(task);
        } catch {
          // Running updates are best-effort; final sync still reports terminal state.
        }
      }
    };

    return {
      schedule: () => {
        if (timer) {
          return;
        }

        const elapsed = this.#now() - lastSyncAt;
        const delay = Math.max(this.#runningUpdateThrottleMs - elapsed, 0);
        timer = this.#setTimeout(syncRunning, delay);
      },
      cancel: () => {
        if (timer) {
          this.#clearTimeout(timer);
          timer = null;
        }
      },
    };
  }

  #logTask(level, event, task, extraFields = {}) {
    const snapshot = task.snapshot();
    const fields = {
      messageId: snapshot.feishuMessageId,
      openId: snapshot.feishuOpenId,
      chatId: snapshot.feishuChatId,
      cwd: snapshot.cwd,
      threadId: snapshot.threadId,
      turnId: snapshot.turnId,
      status: snapshot.status,
      elapsedMs: snapshot.elapsedMs,
      errorSummary: snapshot.errorSummary,
      errorType: snapshot.errorType,
      ...extraFields,
    };
    if (snapshot.feishuChatType) {
      fields.chatType = snapshot.feishuChatType;
    }

    const write = this.#logger[level] ?? this.#logger.info ?? (() => {});
    write(event, fields);
  }
}

function threadMappingFields({ openId, chatId, chatType, cwd }) {
  if (chatType === "group") {
    return {
      conversationId: chatId,
      cwd,
    };
  }

  return {
    openId,
    cwd,
  };
}

function errorLogFields(error) {
  const fields = {
    errorSummary: error instanceof Error ? error.message : String(error),
  };

  if (error instanceof Error && error.name) {
    fields.errorName = error.name;
  }
  if (error?.code) {
    fields.errorCode = error.code;
  }
  if (error?.actionType) {
    fields.errorActionType = error.actionType;
  }

  return fields;
}
