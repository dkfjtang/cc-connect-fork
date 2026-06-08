import assert from "node:assert/strict";
import { test } from "node:test";

import { AppServerSession } from "../../src/codex/app-server-session.js";

test("initialize sends client metadata and initialized notification", async () => {
  const written = [];
  const session = new AppServerSession({
    write: (message) => written.push(message),
  });

  const initPromise = session.initialize();

  assert.deepEqual(written, [
    {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "feishu_codex_bridge",
          title: "Feishu Codex Bridge",
          version: "0.1.0",
        },
      },
    },
  ]);

  session.handleMessage({
    id: 1,
    result: { userAgent: "codex-test", platformFamily: "windows" },
  });

  await assert.deepEqual(await initPromise, {
    userAgent: "codex-test",
    platformFamily: "windows",
  });

  assert.deepEqual(written[1], { method: "initialized", params: {} });
});

test("startThread requests a new Codex thread", async () => {
  const written = [];
  const session = new AppServerSession({
    write: (message) => written.push(message),
  });

  const threadPromise = session.startThread({ model: "gpt-5.4" });
  assert.deepEqual(written[0], {
    id: 1,
    method: "thread/start",
    params: { model: "gpt-5.4" },
  });

  session.handleMessage({ id: 1, result: { thread: { id: "thr_123" } } });

  await assert.deepEqual(await threadPromise, { thread: { id: "thr_123" } });
});

test("startTurn converts Feishu text into Codex turn input", async () => {
  const written = [];
  const session = new AppServerSession({
    write: (message) => written.push(message),
  });

  const turnPromise = session.startTurn({
    threadId: "thr_123",
    text: "帮我看一下项目状态",
    cwd: "F:\\development\\f-codex",
  });

  assert.deepEqual(written[0], {
    id: 1,
    method: "turn/start",
    params: {
      threadId: "thr_123",
      input: [{ type: "text", text: "帮我看一下项目状态" }],
      cwd: "F:\\development\\f-codex",
    },
  });

  session.handleMessage({ id: 1, result: { turn: { id: "turn_123" } } });

  await assert.deepEqual(await turnPromise, { turn: { id: "turn_123" } });
});

test("notifications are forwarded to the session event handler", () => {
  const events = [];
  const session = new AppServerSession({
    write: () => {},
    onEvent: (event) => events.push(event),
  });

  session.handleMessage({
    method: "item/agentMessage/delta",
    params: { delta: "hello" },
  });

  assert.deepEqual(events, [
    { method: "item/agentMessage/delta", params: { delta: "hello" } },
  ]);
});
