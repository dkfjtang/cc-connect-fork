import assert from "node:assert/strict";
import { test } from "node:test";

import { JsonRpcClient } from "../../src/codex/json-rpc-client.js";

test("request writes a JSON-RPC message and resolves matching response", async () => {
  const written = [];
  const client = new JsonRpcClient({
    write: (message) => written.push(message),
  });

  const resultPromise = client.request("thread/start", { model: "gpt-5.4" });

  assert.deepEqual(written, [
    { id: 1, method: "thread/start", params: { model: "gpt-5.4" } },
  ]);

  client.handleMessage({ id: 1, result: { thread: { id: "thr_123" } } });

  await assert.deepEqual(await resultPromise, { thread: { id: "thr_123" } });
});

test("request rejects matching error response", async () => {
  const client = new JsonRpcClient({
    write: () => {},
  });

  const resultPromise = client.request("turn/start", { threadId: "thr_123" });
  client.handleMessage({
    id: 1,
    error: { code: -32001, message: "Server overloaded; retry later." },
  });

  await assert.rejects(resultPromise, /Server overloaded; retry later\./);
});

test("notification handler receives app-server notifications", () => {
  const notifications = [];
  const client = new JsonRpcClient({
    write: () => {},
    onNotification: (message) => notifications.push(message),
  });

  client.handleMessage({
    method: "turn/started",
    params: { turn: { id: "turn_123" } },
  });

  assert.deepEqual(notifications, [
    { method: "turn/started", params: { turn: { id: "turn_123" } } },
  ]);
});

test("server request handler writes result response", async () => {
  const written = [];
  const requests = [];
  const client = new JsonRpcClient({
    write: (message) => written.push(message),
    onRequest: async (message) => {
      requests.push(message);
      return { decision: "decline" };
    },
  });

  client.handleMessage({
    id: 7,
    method: "item/commandExecution/requestApproval",
    params: { itemId: "item_123", threadId: "thr_123", turnId: "turn_123" },
  });
  await Promise.resolve();

  assert.deepEqual(requests, [
    {
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { itemId: "item_123", threadId: "thr_123", turnId: "turn_123" },
    },
  ]);
  assert.deepEqual(written, [{ id: 7, result: { decision: "decline" } }]);
});

test("unsupported server request writes method error", async () => {
  const written = [];
  const client = new JsonRpcClient({
    write: (message) => written.push(message),
  });

  client.handleMessage({ id: 7, method: "unknown/request", params: {} });
  await Promise.resolve();

  assert.deepEqual(written, [
    {
      id: 7,
      error: {
        code: -32601,
        message: "Unsupported server request: unknown/request",
      },
    },
  ]);
});
