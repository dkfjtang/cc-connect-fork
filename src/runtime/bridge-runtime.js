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
  #groupDeveloperInstructions;
  #activeTasks = new Map();
  #pendingApprovals = new Map();
  #approvalTimeoutMs;

  constructor({
    policy,
    threadStore,
    session,
    cardController,
    turnTimeoutMs = 900_000,
    runningUpdateThrottleMs = 3000,
    approvalTimeoutMs = 300_000,
    now = () => Date.now(),
    setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
    clearTimeoutFn = (timer) => clearTimeout(timer),
    logger = null,
    model = null,
    appVersion = null,
    groupDeveloperInstructions = {},
  }) {
    this.#policy = policy;
    this.#threadStore = threadStore;
    this.#session = session;
    this.#cardController = cardController;
    this.turnTimeoutMs = turnTimeoutMs;
    this.#runningUpdateThrottleMs = runningUpdateThrottleMs;
    this.#approvalTimeoutMs = approvalTimeoutMs;
    this.#now = now;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
    this.#model = model;
    this.#appVersion = appVersion;
    this.#groupDeveloperInstructions = new Map(Object.entries(groupDeveloperInstructions));
    this.#logger = logger ?? {
      info: () => {},
      error: () => {},
    };

    if (typeof this.#session.onRequest === "function") {
      this.#session.onRequest((request) => this.#handleServerRequest(request));
    }
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
          const turnResult = await this.#session.startTurn({
            threadId,
            text,
            cwd,
            developerInstructions: this.#developerInstructionsFor({ chatId, chatType }),
          });
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
    this.#finishApproval(this.#findPendingApproval({ taskId: snapshot.taskId }), "cancel");
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

  async resolveApproval({ openId = null, decision, taskId = null, requestId = null, approvalId = null, itemId = null }) {
    if (!openId) {
      return { status: "skipped", reason: "Feishu operator open_id is required" };
    }
    if (!this.#policy.canUseOpenId(openId)) {
      return { status: "skipped", reason: "Feishu user is not allowed" };
    }
    if (!isApprovalDecision(decision)) {
      return { status: "skipped", reason: "Unsupported approval decision" };
    }

    const pending = this.#findPendingApproval({ taskId, requestId, approvalId, itemId });
    if (!pending) {
      return { status: "skipped", reason: "No pending approval" };
    }

    this.#finishApproval(pending, decision);
    await this.#cardController.sync(pending.task);

    return {
      status: "handled",
      decision,
      taskStatus: pending.task.snapshot().status,
    };
  }

  #handleServerRequest(request) {
    if (!isApprovalRequest(request.method)) {
      throw new Error(`Unsupported server request: ${request.method}`);
    }

    const activeTask = this.#findActiveTaskForApproval(request);
    if (!activeTask) {
      return { decision: "decline" };
    }

    return this.#waitForApproval(activeTask.task, request);
  }

  #waitForApproval(task, request) {
    let pending;
    const result = new Promise((resolve) => {
      pending = {
        task,
        request,
        resolve,
        keys: approvalKeys({ taskId: task.snapshot().taskId, request }),
        timer: null,
      };
      pending.timer = this.#setTimeout(() => {
        this.#finishApproval(pending, "decline");
      }, this.#approvalTimeoutMs);

      for (const key of pending.keys) {
        this.#pendingApprovals.set(key, pending);
      }
    });

    return result;
  }

  #finishApproval(pending, decision) {
    if (!pending || pending.resolved) {
      return;
    }

    pending.resolved = true;
    if (pending.timer) {
      this.#clearTimeout(pending.timer);
    }
    for (const key of pending.keys) {
      if (this.#pendingApprovals.get(key) === pending) {
        this.#pendingApprovals.delete(key);
      }
    }

    pending.task.resolveApproval(decision);
    pending.resolve({ decision });
  }

  #findPendingApproval({ taskId = null, requestId = null, approvalId = null, itemId = null }) {
    const keys = [
      requestId !== null && requestId !== undefined ? `request:${requestId}` : null,
      approvalId ? `approval:${approvalId}` : null,
      itemId ? `item:${itemId}` : null,
      taskId ? `task:${taskId}` : null,
    ].filter(Boolean);

    for (const key of keys) {
      const pending = this.#pendingApprovals.get(key);
      if (pending) {
        return pending;
      }
    }

    return null;
  }

  #findActiveTaskForApproval(request) {
    const params = request.params ?? {};
    for (const activeTask of this.#activeTasks.values()) {
      const snapshot = activeTask.task.snapshot();
      if (params.threadId && snapshot.threadId && params.threadId !== snapshot.threadId) {
        continue;
      }
      if (params.turnId && snapshot.turnId && params.turnId !== snapshot.turnId) {
        continue;
      }
      return activeTask;
    }

    return null;
  }

  #waitForTurnCompletion(task, runningUpdates, cancellation) {
    let unsubscribe = () => {};
    let timeoutId;

    const completed = new Promise((resolve, reject) => {
      unsubscribe = this.#session.onEvent((event) => {
        task.handleCodexEvent(event);
        if (shouldScheduleRunningUpdate(event.method)) {
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
      if (["running", "waiting_approval"].includes(task.snapshot().status)) {
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
      ...stageLogFields(snapshot),
      ...tokenUsageLogFields(snapshot.tokenUsage),
      ...extraFields,
    };
    if (snapshot.feishuChatType) {
      fields.chatType = snapshot.feishuChatType;
    }

    const write = this.#logger[level] ?? this.#logger.info ?? (() => {});
    write(event, fields);
  }

  #developerInstructionsFor({ chatId, chatType }) {
    if (chatType !== "group") {
      return null;
    }

    return this.#groupDeveloperInstructions.get(chatId) ?? null;
  }
}

function stageLogFields(snapshot) {
  const fields = {};
  if (snapshot.currentStage) {
    fields.currentStage = snapshot.currentStage.label;
    fields.currentStageType = snapshot.currentStage.type;
  }
  if (snapshot.lastStage) {
    fields.lastStage = snapshot.lastStage.label;
    fields.lastStageType = snapshot.lastStage.type;
  }

  return fields;
}

function shouldScheduleRunningUpdate(method) {
  return [
    "item/started",
    "item/agentMessage/delta",
    "item/completed",
    "thread/tokenUsage/updated",
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "applyPatchApproval",
    "execCommandApproval",
  ].includes(method);
}

function isApprovalRequest(method) {
  return [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "applyPatchApproval",
    "execCommandApproval",
  ].includes(method);
}

function isApprovalDecision(decision) {
  return ["accept", "acceptForSession", "decline", "cancel"].includes(decision);
}

function approvalKeys({ taskId, request }) {
  const params = request.params ?? {};
  return [
    request.id !== null && request.id !== undefined ? `request:${request.id}` : null,
    params.approvalId ? `approval:${params.approvalId}` : null,
    params.callId ? `approval:${params.callId}` : null,
    params.itemId ? `approval:${params.itemId}` : null,
    params.itemId ? `item:${params.itemId}` : null,
    params.callId ? `item:${params.callId}` : null,
    taskId ? `task:${taskId}` : null,
  ].filter(Boolean);
}

function tokenUsageLogFields(tokenUsage) {
  if (!tokenUsage?.total) {
    return {};
  }

  return {
    tokenTotal: tokenUsage.total.totalTokens,
    tokenCachedInput: tokenUsage.total.cachedInputTokens,
    tokenInput: tokenUsage.total.inputTokens,
    tokenOutput: tokenUsage.total.outputTokens,
    tokenReasoningOutput: tokenUsage.total.reasoningOutputTokens,
    modelContextWindow: tokenUsage.modelContextWindow,
  };
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
