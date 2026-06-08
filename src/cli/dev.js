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

  const feishuTransport = transportFactory({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    verificationToken: env.FEISHU_VERIFICATION_TOKEN ?? "",
    encryptKey: env.FEISHU_ENCRYPT_KEY ?? "",
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
    logger: createJsonLogger({
      level: env.FCA_LOG_LEVEL?.trim() || "info",
      output: errorOutput,
    }),
  });

  output.write(`Starting fca for cwd ${app.config.defaultWorkdir}\n`);
  if (probe.botOpenId) {
    output.write(`Feishu bot ${probe.botName ?? "unknown"} (${probe.botOpenId}) detected.\n`);
  }
  await app.start();
  output.write("fca bridge app started. Listening for Feishu message events.\n");
  await feishuTransport.startMessageListener({
    onMessageReceive: (payload) => app.eventHandler.handleMessageReceive(payload),
  });
  return 0;
}
