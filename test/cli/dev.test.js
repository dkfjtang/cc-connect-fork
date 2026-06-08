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
  assert.deepEqual(withoutLogger(calls[0].options), {
    appId: "cli_123",
    appSecret: "secret",
    verificationToken: "",
    encryptKey: "",
    autoReconnect: true,
  });
  assert.equal(typeof calls[0].options.logger.info, "function");
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
  assert.equal(calls[1].options.logger, calls[0].options.logger);
  assert.deepEqual(calls[2], { type: "start" });
  assert.equal(calls[3].type, "listen");
  assert.equal(typeof calls[3].onMessageReceive, "function");
  assert.equal(typeof calls[3].onCardAction, "function");
  assert.match(outputText, /bot Codex \(ou_bot\)/);
});

test("runDev passes disabled Feishu WS reconnect option to sdk transport", async () => {
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
      FCA_FEISHU_WS_AUTO_RECONNECT: "false",
    },
    output: { write: () => {} },
    errorOutput: { write: () => {} },
    transportFactory: (options) => {
      calls.push(options);
      return transport;
    },
    appFactory: () => ({
      config: { defaultWorkdir: "F:\\development\\f-codex" },
      start: async () => {},
      eventHandler: {
        handleMessageReceive: async () => {},
        handleCardAction: async () => {},
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[0].autoReconnect, false);
});

test("runDev logs sanitized bridge diagnostics after listener starts", async () => {
  let logText = "";
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
    },
    output: { write: () => {} },
    errorOutput: { write: (text) => (logText += text) },
    transportFactory: () => transport,
    appFactory: () => ({
      config: { defaultWorkdir: "F:\\development\\f-codex" },
      start: async () => {},
      eventHandler: {
        handleMessageReceive: async () => {},
        handleCardAction: async () => {},
      },
      getDiagnostics: () => ({
        appServer: { active: true, secret: "should_not_escape" },
        runtime: { active: true },
        eventHandler: { active: true },
        feishu: {
          messageListener: {
            active: true,
            autoReconnect: true,
            state: "connected",
            lastConnectTime: 1000,
            nextConnectTime: null,
            reconnectAttempts: 0,
            appSecret: "should_not_escape",
          },
        },
      }),
    }),
  });

  assert.equal(exitCode, 0);
  const diagnostics = logText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((entry) => entry.event === "bridge.diagnostics");
  assert.deepEqual(diagnostics, {
    timestamp: diagnostics.timestamp,
    level: "info",
    event: "bridge.diagnostics",
    appServer: { active: true },
    runtime: { active: true },
    eventHandler: { active: true },
    feishu: {
      messageListener: {
        active: true,
        autoReconnect: true,
        state: "connected",
        lastConnectTime: 1000,
        nextConnectTime: null,
        reconnectAttempts: 0,
      },
    },
  });
  assert.equal(logText.includes("should_not_escape"), false);
});

function withoutLogger(options) {
  const { logger, ...rest } = options;
  return rest;
}

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

test("runDev registers shutdown signal handlers and stops resources", async () => {
  const calls = [];
  const signalHandlers = {};
  let logText = "";
  const transport = {
    probeBot: async () => ({ ok: true, botOpenId: "ou_bot", botName: "Codex" }),
    startMessageListener: async () => {
      calls.push("listen");
    },
    stop: async () => {
      calls.push("transport.stop");
    },
  };
  const app = {
    config: { defaultWorkdir: "F:\\development\\f-codex" },
    start: async () => {
      calls.push("app.start");
    },
    stop: async () => {
      calls.push("app.stop");
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
    output: { write: () => {} },
    errorOutput: { write: (text) => (logText += text) },
    transportFactory: () => transport,
    appFactory: () => app,
    signalRegistrar: {
      on: (signal, handler) => {
        signalHandlers[signal] = handler;
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(typeof signalHandlers.SIGINT, "function");
  assert.equal(typeof signalHandlers.SIGTERM, "function");

  await signalHandlers.SIGTERM();

  assert.deepEqual(calls, ["app.start", "listen", "app.stop", "transport.stop"]);
  const logs = logText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(logs.some((entry) => entry.event === "bridge.shutdown_requested" && entry.signal === "SIGTERM"), true);
  assert.equal(logs.some((entry) => entry.event === "bridge.stopped" && entry.signal === "SIGTERM"), true);
});

test("runDev logs shutdown failures and still stops transport", async () => {
  const calls = [];
  const signalHandlers = {};
  let logText = "";
  const transport = {
    probeBot: async () => ({ ok: true, botOpenId: "ou_bot", botName: "Codex" }),
    startMessageListener: async () => {
      calls.push("listen");
    },
    stop: async () => {
      calls.push("transport.stop");
    },
  };
  const app = {
    config: { defaultWorkdir: "F:\\development\\f-codex" },
    start: async () => {
      calls.push("app.start");
    },
    stop: async () => {
      calls.push("app.stop");
      throw new Error("app stop failed");
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
    output: { write: () => {} },
    errorOutput: { write: (text) => (logText += text) },
    transportFactory: () => transport,
    appFactory: () => app,
    signalRegistrar: {
      on: (signal, handler) => {
        signalHandlers[signal] = handler;
      },
    },
  });

  assert.equal(exitCode, 0);
  await assert.rejects(() => signalHandlers.SIGTERM(), /app stop failed/);

  assert.deepEqual(calls, ["app.start", "listen", "app.stop", "transport.stop"]);
  const logs = logText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(logs.some((entry) => entry.event === "bridge.shutdown_requested" && entry.signal === "SIGTERM"), true);
  assert.equal(
    logs.some(
      (entry) =>
        entry.event === "bridge.shutdown_failed" &&
        entry.signal === "SIGTERM" &&
        entry.errorSummary === "app stop failed" &&
        entry.errorName === "Error",
    ),
    true,
  );
  assert.equal(logs.some((entry) => entry.event === "bridge.stopped"), false);
});

test("runDev reports all failed shutdown resources without masking the first error", async () => {
  const calls = [];
  const signalHandlers = {};
  let logText = "";
  const transport = {
    probeBot: async () => ({ ok: true, botOpenId: "ou_bot", botName: "Codex" }),
    startMessageListener: async () => {
      calls.push("listen");
    },
    stop: async () => {
      calls.push("transport.stop");
      throw new Error("transport stop failed");
    },
  };
  const app = {
    config: { defaultWorkdir: "F:\\development\\f-codex" },
    start: async () => {
      calls.push("app.start");
    },
    stop: async () => {
      calls.push("app.stop");
      throw new Error("app stop failed");
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
    output: { write: () => {} },
    errorOutput: { write: (text) => (logText += text) },
    transportFactory: () => transport,
    appFactory: () => app,
    signalRegistrar: {
      on: (signal, handler) => {
        signalHandlers[signal] = handler;
      },
    },
  });

  assert.equal(exitCode, 0);
  await assert.rejects(() => signalHandlers.SIGTERM(), /app stop failed/);

  assert.deepEqual(calls, ["app.start", "listen", "app.stop", "transport.stop"]);
  const logs = logText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const failed = logs.find((entry) => entry.event === "bridge.shutdown_failed");
  assert.deepEqual(failed, {
    timestamp: failed.timestamp,
    level: "error",
    event: "bridge.shutdown_failed",
    signal: "SIGTERM",
    failedResources: ["app", "transport"],
    errorSummary: "app stop failed",
    errorName: "Error",
  });
});
