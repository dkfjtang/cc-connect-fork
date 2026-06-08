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
  });

  const task = await runtime.handleTextMessage({
    messageId: "msg_123",
    openId: "ou_allowed",
    chatId: "oc_123",
    text: "hello",
  });

  assert.equal(task.snapshot().threadId, "thr_new");
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
  assert.deepEqual(
    sessionCalls.map((call) => call.method),
    ["startThread", "startTurn"],
  );
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

function allowDefaultPolicy() {
  return new AccessPolicy({
    allowedOpenIds: ["ou_allowed"],
    allowedWorkdirs: ["F:\\development\\f-codex"],
    defaultWorkdir: "F:\\development\\f-codex",
  });
}

function fakeSession({ calls = [], onEvent, startTurnHook } = {}) {
  let eventHandler = () => {};
  return {
    onEvent: (handler) => {
      eventHandler = handler;
      return onEvent ? onEvent(handler) : () => {};
    },
    startThread: async () => {
      calls.push({ method: "startThread" });
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
  };
}

function fakeCardController() {
  return {
    sync: async (task) => {
      task.attachCard("om_123");
    },
  };
}
