import assert from "node:assert/strict";
import { test } from "node:test";

import { createBridgeApp } from "../../src/app/create-bridge-app.js";

test("createBridgeApp wires config, policy, store, runtime, and handler", async () => {
  const cardActions = [];
  let emitted;
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
      FCA_THREAD_STORE_PATH: "ignored.json",
    },
    codexAppServerFactory: ({ onEvent }) => ({
      start: async () => ({
        onEvent: (handler) => {
          emitted = handler;
          return () => {};
        },
        startThread: async () => ({ thread: { id: "thr_123" } }),
        startTurn: async () => {
          queueMicrotask(() => {
            emitted({
              method: "item/agentMessage/delta",
              params: { delta: "done" },
            });
            emitted({
              method: "turn/completed",
              params: { status: "success" },
            });
          });
          return { turn: { id: "turn_123" } };
        },
      }),
    }),
    feishuTransport: {
      sendMessage: async (payload) => {
        cardActions.push({ type: "send", payload });
        return { data: { message_id: "om_123" } };
      },
      patchMessageCard: async (payload) => {
        cardActions.push({ type: "update", payload });
        return { data: {} };
      },
    },
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
  });

  await app.start();
  const result = await app.eventHandler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });

  assert.deepEqual(result, { status: "handled", taskStatus: "completed" });
  assert.deepEqual(
    cardActions.map((action) => action.type),
    ["send", "update"],
  );
});

test("createBridgeApp exposes config for diagnostics", () => {
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    codexAppServerFactory: () => ({ start: async () => ({}) }),
    feishuTransport: {},
  });

  assert.equal(app.config.defaultWorkdir, "F:\\development\\f-codex");
  assert.deepEqual(app.config.allowedOpenIds, ["ou_123"]);
});
