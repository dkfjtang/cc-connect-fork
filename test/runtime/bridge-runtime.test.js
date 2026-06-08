import assert from "node:assert/strict";
import { test } from "node:test";

import { AccessPolicy } from "../../src/policy/access-policy.js";
import { BridgeRuntime } from "../../src/runtime/bridge-runtime.js";
import { MemoryThreadStore } from "../../src/store/thread-store.js";

test("handleTextMessage denies non-whitelisted users", async () => {
  const runtime = new BridgeRuntime({
    policy: new AccessPolicy({
      allowedOpenIds: ["ou_allowed"],
      allowedWorkdirs: ["F:\\development\\f-codex"],
      defaultWorkdir: "F:\\development\\f-codex",
    }),
    threadStore: new MemoryThreadStore(),
    session: fakeSession(),
    cardController: fakeCardController(),
  });

  await assert.rejects(
    () =>
      runtime.handleTextMessage({
        messageId: "msg_123",
        openId: "ou_denied",
        chatId: "oc_123",
        text: "hello",
      }),
    /Feishu user is not allowed/,
  );
});

test("handleTextMessage reuses existing thread mapping", async () => {
  const threadStore = new MemoryThreadStore({ now: () => "test-now" });
  await threadStore.saveThread({
    openId: "ou_allowed",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_existing",
  });
  const sessionCalls = [];
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore,
    session: fakeSession({ calls: sessionCalls }),
    cardController: fakeCardController(),
  });

  const task = await runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });

  assert.equal(task.snapshot().threadId, "thr_existing");
  assert.deepEqual(
    sessionCalls.map((call) => call.method),
    ["startTurn"],
  );
});

test("handleTextMessage creates and stores a thread when mapping is missing", async () => {
  const threadStore = new MemoryThreadStore({ now: () => "test-now" });
  const sessionCalls = [];
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore,
    session: fakeSession({ calls: sessionCalls }),
    cardController: fakeCardController(),
    model: "gpt-5.1-codex",
    appVersion: "0.2.0-test",
  });

  const task = await runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    chatType: "group",
    text: "hello",
  });

  assert.equal(task.snapshot().threadId, "thr_new");
  assert.equal(task.snapshot().feishuChatType, "group");
  assert.equal(task.snapshot().model, "gpt-5.1-codex");
  assert.equal(task.snapshot().appVersion, "0.2.0-test");
  assert.deepEqual(
    await threadStore.getThread({
      openId: "ou_allowed",
      cwd: "F:\\development\\f-codex",
    }),
    {
      openId: "ou_allowed",
      cwd: "F:\\development\\f-codex",
      threadId: "thr_new",
      lastTurnId: "turn_new",
      lastSeenAt: "test-now",
    },
  );
  assert.deepEqual(sessionCalls, [
    { method: "startThread", options: { model: "gpt-5.1-codex" } },
    {
      method: "startTurn",
      threadId: "thr_new",
      text: "hello",
      cwd: "F:\\development\\f-codex",
    },
  ]);
});

test("handleTextMessage syncs task card before and after turn", async () => {
  const syncStatuses = [];
  let emitEvent;
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      onEvent: (handler) => {
        emitEvent = handler;
        return () => {};
      },
      startTurnHook: () => {
        queueMicrotask(() => {
          emitEvent({
            method: "item/agentMessage/delta",
            params: { delta: "done" },
          });
          emitEvent({
            method: "turn/completed",
            params: { status: "success" },
          });
        });
      },
    }),
    cardController: {
      sync: async (task) => {
        syncStatuses.push(task.snapshot().status);
        task.attachCard("om_123");
      },
    },
  });

  await runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });

  assert.deepEqual(syncStatuses, ["queued", "completed"]);
});

test("handleTextMessage throttles running card updates while streaming deltas", async () => {
  const syncStatuses = [];
  let emitEvent;
  let markEventReady;
  const eventReady = new Promise((resolve) => {
    markEventReady = resolve;
  });
  let now = 0;
  let timeoutCallback;
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      onEvent: (handler) => {
        emitEvent = handler;
        markEventReady();
        return () => {};
      },
      startTurnHook: () => {},
    }),
    cardController: {
      sync: async (task) => {
        syncStatuses.push(`${task.snapshot().status}:${task.snapshot().summaryText}`);
        task.attachCard("om_123");
      },
    },
    runningUpdateThrottleMs: 1000,
    now: () => now,
    setTimeoutFn: (callback, delay) => {
      timeoutCallback = { callback, delay };
      return "timer";
    },
    clearTimeoutFn: () => {},
  });

  const pending = runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });
  await eventReady;
  await Promise.resolve();

  emitEvent({ method: "item/agentMessage/delta", params: { delta: "a" } });
  await Promise.resolve();
  emitEvent({ method: "item/agentMessage/delta", params: { delta: "b" } });
  await Promise.resolve();

  try {
    assert.equal(timeoutCallback.delay, 1000);
    assert.deepEqual(syncStatuses, ["queued:Codex 正在处理..."]);

    now = 1000;
    await timeoutCallback.callback();

    assert.deepEqual(syncStatuses, ["queued:Codex 正在处理...", "running:ab"]);

    emitEvent({ method: "turn/completed", params: { status: "success" } });
    await pending;

    assert.deepEqual(syncStatuses, ["queued:Codex 正在处理...", "running:ab", "completed:ab"]);
  } finally {
    emitEvent({ method: "turn/completed", params: { status: "success" } });
    await pending.catch(() => {});
  }
});

test("handleTextMessage keeps turn alive when a running card update fails", async () => {
  let emitEvent;
  let markEventReady;
  const eventReady = new Promise((resolve) => {
    markEventReady = resolve;
  });
  let syncCount = 0;
  let timeoutCallback;
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      onEvent: (handler) => {
        emitEvent = handler;
        markEventReady();
        return () => {};
      },
      startTurnHook: () => {},
    }),
    cardController: {
      sync: async (task) => {
        syncCount += 1;
        task.attachCard("om_123");
        if (task.snapshot().status === "running") {
          throw new Error("rate limited");
        }
      },
    },
    runningUpdateThrottleMs: 0,
    setTimeoutFn: (callback) => {
      timeoutCallback = callback;
      return "timer";
    },
    clearTimeoutFn: () => {},
  });

  const pending = runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });
  await eventReady;
  await Promise.resolve();

  emitEvent({ method: "item/agentMessage/delta", params: { delta: "a" } });
  await timeoutCallback();
  emitEvent({ method: "turn/completed", params: { status: "success" } });

  const task = await pending;

  assert.equal(task.snapshot().status, "completed");
  assert.equal(syncCount, 3);
});

test("cancelActiveTask interrupts active turn and resolves it as cancelled", async () => {
  let emitEvent;
  let markEventReady;
  const eventReady = new Promise((resolve) => {
    markEventReady = resolve;
  });
  const syncStatuses = [];
  const sessionCalls = [];
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      calls: sessionCalls,
      onEvent: (handler) => {
        emitEvent = handler;
        markEventReady();
        return () => {};
      },
      startTurnHook: () => {},
      interruptTurn: async ({ threadId, turnId }) => {
        sessionCalls.push({ method: "interruptTurn", threadId, turnId });
        queueMicrotask(() => {
          emitEvent({ method: "turn/completed", params: { status: "cancelled" } });
        });
        return { ok: true };
      },
    }),
    cardController: {
      sync: async (task) => {
        syncStatuses.push(task.snapshot().status);
        task.attachCard("om_123");
      },
    },
  });

  const pending = runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });
  await eventReady;
  await Promise.resolve();

  const cancelResult = await runtime.cancelActiveTask({
    chatId: "oc_123",
    reason: "用户已停止任务",
  });
  const task = await pending;

  assert.deepEqual(cancelResult, { status: "cancelled", taskStatus: "cancelled" });
  assert.equal(task.snapshot().status, "cancelled");
  assert.deepEqual(
    sessionCalls.map((call) => call.method),
    ["startThread", "startTurn", "interruptTurn"],
  );
  assert.deepEqual(syncStatuses, ["queued", "cancelled", "cancelled"]);
});

test("cancelActiveTask keeps Feishu cancellation when app-server interrupt fails", async () => {
  let markEventReady;
  const eventReady = new Promise((resolve) => {
    markEventReady = resolve;
  });
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      onEvent: (handler) => {
        markEventReady();
        return () => {};
      },
      startTurnHook: () => {},
      interruptTurn: async () => {
        throw new Error("interrupt unavailable");
      },
    }),
    cardController: fakeCardController(),
  });

  const pending = runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });
  await eventReady;
  await Promise.resolve();

  const cancelResult = await runtime.cancelActiveTask({
    chatId: "oc_123",
    reason: "用户已停止任务",
  });
  const task = await pending;

  assert.deepEqual(cancelResult, { status: "cancelled", taskStatus: "cancelled" });
  assert.equal(task.snapshot().status, "cancelled");
});

test("handleTextMessage returns failed task when streamed turn fails", async () => {
  let emitEvent;
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      onEvent: (handler) => {
        emitEvent = handler;
        return () => {};
      },
      startTurnHook: () => {
        queueMicrotask(() => {
          emitEvent({
            method: "turn/completed",
            params: { status: "failed", error: { message: "denied" } },
          });
        });
      },
    }),
    cardController: fakeCardController(),
  });

  const task = await runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });

  assert.equal(task.snapshot().status, "failed");
  assert.equal(task.snapshot().errorSummary, "denied");
});

test("handleTextMessage writes traceable structured task logs", async () => {
  const logEntries = [];
  const threadStore = new MemoryThreadStore({ now: () => "test-now" });
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore,
    session: fakeSession(),
    cardController: fakeCardController(),
    logger: fakeLogger(logEntries),
  });

  await runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });

  assert.deepEqual(
    logEntries.map((entry) => entry.event),
    ["task.received", "task.thread_created", "task.turn_started", "task.completed"],
  );
  assert.deepEqual(logEntries.at(-1), {
    level: "info",
    event: "task.completed",
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_new",
    turnId: "turn_new",
    status: "completed",
    elapsedMs: logEntries.at(-1).elapsedMs,
    errorSummary: null,
    errorType: null,
  });
  assert.equal(typeof logEntries.at(-1).elapsedMs, "number");
});

test("handleTextMessage logs failed terminal state with error summary", async () => {
  let emitEvent;
  const logEntries = [];
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      onEvent: (handler) => {
        emitEvent = handler;
        return () => {};
      },
      startTurnHook: () => {
        queueMicrotask(() => {
          emitEvent({
            method: "turn/completed",
            params: { status: "failed", error: { message: "denied" } },
          });
        });
      },
    }),
    cardController: fakeCardController(),
    logger: fakeLogger(logEntries),
  });

  await runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });

  assert.deepEqual(logEntries.at(-1), {
    level: "error",
    event: "task.failed",
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_new",
    turnId: "turn_new",
    status: "failed",
    elapsedMs: logEntries.at(-1).elapsedMs,
    errorSummary: "denied",
    errorType: "failed",
  });
  assert.equal(typeof logEntries.at(-1).elapsedMs, "number");
});

test("handleTextMessage logs thrown turn errors with trace fields", async () => {
  const logEntries = [];
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession({
      startTurnHook: () => {
        throw new Error("app-server unavailable");
      },
    }),
    cardController: fakeCardController(),
    logger: fakeLogger(logEntries),
  });

  await assert.rejects(
    () =>
      runtime.handleTextMessage({
        messageId: "msg_123",
        openId: "ou_allowed",
        chatId: "oc_123",
        text: "hello",
      }),
    /app-server unavailable/,
  );

  assert.deepEqual(logEntries.at(-1), {
    level: "error",
    event: "task.error",
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_new",
    turnId: null,
    status: "queued",
    elapsedMs: logEntries.at(-1).elapsedMs,
    errorSummary: "app-server unavailable",
    errorType: null,
    errorName: "Error",
  });
  assert.equal(typeof logEntries.at(-1).elapsedMs, "number");
});

test("handleTextMessage logs Feishu API error code when card sync fails", async () => {
  const logEntries = [];
  const feishuError = new Error("Feishu update failed (99991663): frequency limited");
  feishuError.name = "FeishuApiError";
  feishuError.code = 99991663;
  feishuError.actionType = "update";
  const runtime = new BridgeRuntime({
    policy: allowDefaultPolicy(),
    threadStore: new MemoryThreadStore({ now: () => "test-now" }),
    session: fakeSession(),
    cardController: {
      sync: async () => {
        throw feishuError;
      },
    },
    logger: fakeLogger(logEntries),
  });

  await assert.rejects(
    () =>
      runtime.handleTextMessage({
        messageId: "msg_123",
        openId: "ou_allowed",
        chatId: "oc_123",
        text: "hello",
      }),
    /frequency limited/,
  );

  assert.deepEqual(logEntries.at(-1), {
    level: "error",
    event: "task.error",
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    cwd: "F:\\development\\f-codex",
    threadId: null,
    turnId: null,
    status: "queued",
    elapsedMs: logEntries.at(-1).elapsedMs,
    errorSummary: "Feishu update failed (99991663): frequency limited",
    errorType: null,
    errorName: "FeishuApiError",
    errorCode: 99991663,
    errorActionType: "update",
  });
  assert.equal(typeof logEntries.at(-1).elapsedMs, "number");
});

function allowDefaultPolicy() {
  return new AccessPolicy({
    allowedOpenIds: ["ou_allowed"],
    allowedWorkdirs: ["F:\\development\\f-codex"],
    defaultWorkdir: "F:\\development\\f-codex",
  });
}

function fakeLogger(entries) {
  return {
    info: (event, fields) => entries.push({ level: "info", event, ...fields }),
    error: (event, fields) => entries.push({ level: "error", event, ...fields }),
  };
}

function fakeSession({ calls = [], onEvent, startTurnHook, interruptTurn } = {}) {
  let eventHandler = () => {};
  return {
    onEvent: (handler) => {
      eventHandler = handler;
      return onEvent ? onEvent(handler) : () => {};
    },
    startThread: async (options = {}) => {
      calls.push({ method: "startThread", options });
      return { thread: { id: "thr_new" } };
    },
    startTurn: async ({ threadId, text, cwd }) => {
      calls.push({ method: "startTurn", threadId, text, cwd });
      if (startTurnHook) {
        startTurnHook();
      } else {
        queueMicrotask(() => {
          eventHandler({
            method: "turn/completed",
            params: { status: "success" },
          });
        });
      }
      return { turn: { id: "turn_new" } };
    },
    interruptTurn,
  };
}

function fakeCardController() {
  return {
    sync: async (task) => {
      task.attachCard("om_123");
    },
  };
}
