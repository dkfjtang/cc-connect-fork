import assert from "node:assert/strict";
import { test } from "node:test";

import { runDev } from "../../src/cli/dev.js";

test("runDev returns a clear error when Feishu credentials are missing", async () => {
  let errorText = "";
  const exitCode = await runDev({
    env: {},
    output: { write: () => {} },
    errorOutput: { write: (text) => (errorText += text) },
  });

  assert.equal(exitCode, 1);
  assert.match(errorText, /FEISHU_APP_ID and FEISHU_APP_SECRET/);
});

test("runDev validates full bridge config before creating SDK transport", async () => {
  let errorText = "";
  const calls = [];

  const exitCode = await runDev({
    env: {
      FEISHU_APP_ID: "cli_123",
      FEISHU_APP_SECRET: "secret",
    },
    output: { write: () => {} },
    errorOutput: { write: (text) => (errorText += text) },
    transportFactory: () => {
      calls.push("transport");
      return {};
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  assert.match(errorText, /Configuration check failed/);
  assert.match(errorText, /FCA_ALLOWED_OPEN_IDS must include at least one open_id/);
});

test("runDev creates sdk transport, probes bot identity, and starts bridge app", async () => {
  const calls = [];
  let outputText = "";
  const transport = {
    probeBot: async () => ({
      ok: true,
      botOpenId: "ou_bot",
      botName: "Codex",
    }),
    startMessageListener: async ({ onMessageReceive, onCardAction }) => {
      calls.push({ type: "listen", onMessageReceive, onCardAction });
    },
  };

  const exitCode = await runDev({
    env: {
      FEISHU_APP_ID: "cli_123",
      FEISHU_APP_SECRET: "secret",
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    output: { write: (text) => (outputText += text) },
    errorOutput: { write: () => {} },
    transportFactory: (options) => {
      calls.push({ type: "transport", options });
      return transport;
    },
    appFactory: (options) => {
      calls.push({ type: "app", options });
      return {
        config: { defaultWorkdir: "F:\\development\\f-codex" },
        start: async () => {
          calls.push({ type: "start" });
        },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].type, "transport");
  assert.deepEqual(calls[0].options, {
    appId: "cli_123",
    appSecret: "secret",
    verificationToken: "",
    encryptKey: "",
  });
  assert.equal(calls[1].type, "app");
  assert.deepEqual(calls[1].options.env, {
    FEISHU_APP_ID: "cli_123",
    FEISHU_APP_SECRET: "secret",
    FCA_ALLOWED_OPEN_IDS: "ou_123",
    FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
    FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
  });
  assert.equal(calls[1].options.feishuTransport, transport);
  assert.equal(calls[1].options.botOpenId, "ou_bot");
  assert.deepEqual(calls[2], { type: "start" });
  assert.equal(calls[3].type, "listen");
  assert.equal(typeof calls[3].onMessageReceive, "function");
  assert.equal(typeof calls[3].onCardAction, "function");
  assert.match(outputText, /bot Codex \(ou_bot\)/);
});

test("runDev creates JSON logger from configured log level", async () => {
  let logText = "";
  const calls = [];
  const transport = {
    probeBot: async () => ({ ok: true, botOpenId: "ou_bot", botName: "Codex" }),
    startMessageListener: async () => {},
  };

  const exitCode = await runDev({
    env: {
      FEISHU_APP_ID: "cli_123",
      FEISHU_APP_SECRET: "secret",
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
      FCA_LOG_LEVEL: "warn",
    },
    output: { write: () => {} },
    errorOutput: { write: (text) => (logText += text) },
    transportFactory: () => transport,
    appFactory: (options) => {
      calls.push(options);
      options.logger.info("task.completed", { messageId: "msg_123" });
      options.logger.warn("feishu.retry", { messageId: "msg_123" });
      return {
        config: { defaultWorkdir: "F:\\development\\f-codex" },
        start: async () => {},
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(logText), {
    timestamp: JSON.parse(logText).timestamp,
    level: "warn",
    event: "feishu.retry",
    messageId: "msg_123",
  });
});
