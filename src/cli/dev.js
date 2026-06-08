import { createBridgeApp } from "../app/create-bridge-app.js";
import { checkConfig } from "./check-config.js";
import { FeishuSdkTransport } from "../feishu/sdk-transport.js";
import { createJsonLogger } from "../logging/json-logger.js";

export async function runDev({
  env = process.env,
  output = process.stdout,
  errorOutput = process.stderr,
  transportFactory = (options) => new FeishuSdkTransport(options),
  appFactory = createBridgeApp,
  signalRegistrar = process,
} = {}) {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    errorOutput.write(
      "Feishu credentials are not configured. Set FEISHU_APP_ID and FEISHU_APP_SECRET before starting the real bridge.\n",
    );
    return 1;
  }
  const configCheck = checkConfig(env);
  if (!configCheck.ok) {
    errorOutput.write(
      `Configuration check failed:\n${configCheck.errors.map((error) => `- ${error}`).join("\n")}\n`,
    );
    return 1;
  }

  const logger = createJsonLogger({
    level: env.FCA_LOG_LEVEL?.trim() || "info",
    output: errorOutput,
  });
  const feishuTransport = transportFactory({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    verificationToken: env.FEISHU_VERIFICATION_TOKEN ?? "",
    encryptKey: env.FEISHU_ENCRYPT_KEY ?? "",
    autoReconnect: configCheck.summary.feishuWsAutoReconnect,
    logger,
  });
  const probe = await feishuTransport.probeBot();
  if (!probe.ok) {
    errorOutput.write(`Feishu bot probe failed: ${probe.error}\n`);
    return 1;
  }

  const app = appFactory({
    env,
    feishuTransport,
    botOpenId: probe.botOpenId ?? null,
    logger,
  });

  output.write(`Starting fca for cwd ${app.config.defaultWorkdir}\n`);
  if (probe.botOpenId) {
    output.write(`Feishu bot ${probe.botName ?? "unknown"} (${probe.botOpenId}) detected.\n`);
  }
  await app.start();
  output.write("fca bridge app started. Listening for Feishu message events.\n");
  await feishuTransport.startMessageListener({
    onMessageReceive: (payload) => app.eventHandler.handleMessageReceive(payload),
    onCardAction: (payload) => app.eventHandler.handleCardAction(payload),
  });
  logger.info("bridge.diagnostics", sanitizeBridgeDiagnostics(app.getDiagnostics?.()));
  registerShutdownHandlers({
    signalRegistrar,
    logger,
    app,
    feishuTransport,
  });
  return 0;
}

function registerShutdownHandlers({ signalRegistrar, logger, app, feishuTransport }) {
  if (!signalRegistrar || typeof signalRegistrar.on !== "function") {
    return;
  }

  let shutdownPromise = null;
  const shutdown = async (signal) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      logger.info("bridge.shutdown_requested", { signal });
      const failures = [];
      await stopShutdownResource("app", app, failures);
      await stopShutdownResource("transport", feishuTransport, failures);
      if (failures.length > 0) {
        const error = failures[0].error;
        logger.error("bridge.shutdown_failed", {
          signal,
          failedResources: failures.map((failure) => failure.resource),
          ...errorLogFields(error),
        });
        throw error;
      }
      logger.info("bridge.stopped", { signal });
    })();

    return shutdownPromise;
  };

  signalRegistrar.on("SIGINT", () => shutdown("SIGINT"));
  signalRegistrar.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function stopShutdownResource(resource, target, failures) {
  if (typeof target.stop !== "function") {
    return;
  }

  try {
    await target.stop();
  } catch (error) {
    failures.push({ resource, error });
  }
}

function errorLogFields(error) {
  const fields = {
    errorSummary: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof Error && error.name) {
    fields.errorName = error.name;
  }
  return fields;
}

function sanitizeBridgeDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") {
    return {
      appServer: { active: null },
      runtime: { active: null },
      eventHandler: { active: null },
      feishu: { messageListener: null },
    };
  }

  return {
    appServer: {
      active: booleanOrNull(diagnostics.appServer?.active),
    },
    runtime: {
      active: booleanOrNull(diagnostics.runtime?.active),
    },
    eventHandler: {
      active: booleanOrNull(diagnostics.eventHandler?.active),
    },
    feishu: {
      messageListener: sanitizeMessageListenerStatus(diagnostics.feishu?.messageListener),
    },
  };
}

function sanitizeMessageListenerStatus(status) {
  if (!status || typeof status !== "object") {
    return null;
  }

  return {
    active: booleanOrNull(status.active),
    autoReconnect: booleanOrNull(status.autoReconnect),
    state: typeof status.state === "string" ? status.state : "unknown",
    lastConnectTime: Number.isFinite(status.lastConnectTime) ? status.lastConnectTime : null,
    nextConnectTime: Number.isFinite(status.nextConnectTime) ? status.nextConnectTime : null,
    reconnectAttempts: Number.isFinite(status.reconnectAttempts)
      ? status.reconnectAttempts
      : null,
  };
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}
