import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createBridgeApp, createThreadStore } from "../../src/app/create-bridge-app.js";
import { FileThreadStore, SqliteThreadStore } from "../../src/store/thread-store.js";

test("createBridgeApp wires config, policy, store, runtime, and handler", async () => {
  const cardActions = [];
  let emitted;
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
      FCA_THREAD_STORE_PATH: "ignored.json",
      FCA_APPROVAL_TIMEOUT_SECONDS: "42",
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
    messageDedupStoreFactory: emptyMessageDedupStore,
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
  assert.equal(app.config.approvalTimeoutSeconds, 42);
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

test("createBridgeApp stop terminates the app-server process", async () => {
  const calls = [];
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    codexAppServerFactory: () => ({
      start: async () => {
        calls.push("start");
        return { onEvent: () => () => {} };
      },
      stop: () => {
        calls.push("stop");
      },
    }),
    feishuTransport: {},
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
    messageDedupStoreFactory: emptyMessageDedupStore,
  });

  await app.start();
  await app.stop();

  assert.deepEqual(calls, ["start", "stop"]);
});

test("createThreadStore selects configured thread store driver", () => {
  assert.ok(
    createThreadStore({
      threadStoreDriver: "json",
      threadStorePath: "data/threads.json",
    }) instanceof FileThreadStore,
  );
  assert.ok(
    createThreadStore({
      threadStoreDriver: "sqlite",
      threadStorePath: "data/threads.sqlite",
    }) instanceof SqliteThreadStore,
  );
});

test("createBridgeApp passes bot open id to event handler self-echo guard", async () => {
  const app = createBridgeApp({
    env: {
      FEISHU_APP_ID: "cli_123",
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    botOpenId: "ou_bot",
    codexAppServerFactory: () => ({
      start: async () => ({
        onEvent: () => () => {},
      }),
    }),
    feishuTransport: {},
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
    messageDedupStoreFactory: emptyMessageDedupStore,
  });

  await app.start();
  const result = await app.eventHandler.handleMessageReceive({
    app_id: "cli_123",
    event: {
      sender: { sender_id: { open_id: "ou_bot" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Self-echo Feishu message" });
});

test("createBridgeApp passes logger to bridge runtime task handling", async () => {
  const logEntries = [];
  let emitted;
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
      FCA_THREAD_STORE_PATH: "ignored.json",
    },
    logger: {
      info: (event, fields) => logEntries.push({ level: "info", event, ...fields }),
      error: (event, fields) => logEntries.push({ level: "error", event, ...fields }),
    },
    codexAppServerFactory: () => ({
      start: async () => ({
        onEvent: (handler) => {
          emitted = handler;
          return () => {};
        },
        startThread: async () => ({ thread: { id: "thr_123" } }),
        startTurn: async () => {
          queueMicrotask(() => {
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
      sendMessage: async () => ({ data: { message_id: "om_card" } }),
      patchMessageCard: async () => ({ data: {} }),
    },
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
    messageDedupStoreFactory: emptyMessageDedupStore,
  });

  await app.start();
  await app.eventHandler.handleMessageReceive({
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

  assert.equal(logEntries.at(-1).event, "task.completed");
  assert.equal(logEntries.at(-1).messageId, "om_123");
  assert.equal(logEntries.at(-1).turnId, "turn_123");
});

test("createBridgeApp wires message dedup store into event handler", async () => {
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
      FCA_THREAD_STORE_PATH: "ignored-threads.json",
      FCA_MESSAGE_DEDUP_STORE_PATH: "ignored-dedup.json",
    },
    codexAppServerFactory: () => ({
      start: async () => ({
        onEvent: () => () => {},
      }),
    }),
    feishuTransport: {},
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
    messageDedupStoreFactory: (config) => ({
      has: async (messageId) =>
        config.messageDedupStorePath === "ignored-dedup.json" && messageId === "om_123",
      mark: async () => {},
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

  assert.deepEqual(result, { status: "skipped", reason: "Duplicate Feishu message" });
});

test("createBridgeApp passes allowed group chat ids to event handler", async () => {
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_GROUP_CHAT_IDS: "oc_allowed",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    botOpenId: "ou_bot",
    codexAppServerFactory: () => ({
      start: async () => ({
        onEvent: () => () => {},
      }),
    }),
    feishuTransport: {},
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
    messageDedupStoreFactory: emptyMessageDedupStore,
  });

  await app.start();
  const result = await app.eventHandler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_denied",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({
          text: "@_user_1 hello",
          mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
        }),
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Feishu group chat is not allowed" });
});

test("createBridgeApp passes group sender policy to event handler", async () => {
  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_allowed,ou_denied",
      FCA_GROUP_SENDER_OPEN_IDS: "oc_allowed=ou_allowed",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    botOpenId: "ou_bot",
    codexAppServerFactory: () => ({
      start: async () => ({
        onEvent: () => () => {},
      }),
    }),
    feishuTransport: {},
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
    messageDedupStoreFactory: emptyMessageDedupStore,
  });

  await app.start();
  const result = await app.eventHandler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_denied" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_allowed",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({
          text: "@_user_1 hello",
          mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
        }),
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Feishu group sender is not allowed" });
});

test("createBridgeApp applies group config file to event handler", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fca-group-config-"));
  const groupConfigPath = join(dir, "groups.json");
  writeFileSync(
    groupConfigPath,
    JSON.stringify({
      groups: [
        {
          chatId: "oc_allowed",
          allowedSenderOpenIds: ["ou_allowed"],
          developerInstructions: "只处理群配置文件项目",
        },
      ],
    }),
    "utf8",
  );

  const app = createBridgeApp({
    env: {
      FCA_ALLOWED_OPEN_IDS: "ou_allowed,ou_denied",
      FCA_GROUP_CONFIG_PATH: groupConfigPath,
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    botOpenId: "ou_bot",
    codexAppServerFactory: () => ({
      start: async () => ({
        onEvent: () => () => {},
      }),
    }),
    feishuTransport: {},
    threadStoreFactory: () => ({
      getThread: async () => null,
      saveThread: async () => {},
    }),
    messageDedupStoreFactory: emptyMessageDedupStore,
  });

  await app.start();
  const result = await app.eventHandler.handleMessageReceive({
    event: {
      sender: { sender_id: { open_id: "ou_denied" } },
      message: {
        message_id: "om_123",
        chat_id: "oc_allowed",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({
          text: "@_user_1 hello",
          mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }],
        }),
      },
    },
  });

  assert.deepEqual(result, { status: "skipped", reason: "Feishu group sender is not allowed" });
  assert.deepEqual(app.config.allowedGroupChatIds, ["oc_allowed"]);
  assert.deepEqual(app.config.groupDeveloperInstructions, {
    oc_allowed: "只处理群配置文件项目",
  });
});

function emptyMessageDedupStore() {
  return {
    has: async () => false,
    mark: async () => {},
  };
}
