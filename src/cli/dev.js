import { createBridgeApp } from "../app/create-bridge-app.js";

export async function runDev({ output = process.stdout, errorOutput = process.stderr } = {}) {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    errorOutput.write(
      "Feishu credentials are not configured. Set FEISHU_APP_ID and FEISHU_APP_SECRET before starting the real bridge.\n",
    );
    return 1;
  }

  const app = createBridgeApp({
    feishuTransport: {
      sendMessage: async () => {
        throw new Error("Real Feishu transport is not implemented yet");
      },
      patchMessageCard: async () => {
        throw new Error("Real Feishu transport is not implemented yet");
      },
    },
  });

  output.write(`Starting fca for cwd ${app.config.defaultWorkdir}\n`);
  await app.start();
  output.write("fca bridge app started. Feishu long-connection transport is pending.\n");
  return 0;
}
