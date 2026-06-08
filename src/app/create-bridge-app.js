import { AccessPolicy } from "../policy/access-policy.js";
import { BridgeRuntime } from "../runtime/bridge-runtime.js";
import { CodexAppServerProcess } from "../codex/app-server-process.js";
import { FeishuEventHandler } from "../feishu/event-handler.js";
import { FeishuMessageClient } from "../feishu/message-client.js";
import { FileThreadStore } from "../store/thread-store.js";
import { TaskCardController } from "../feishu/task-card-controller.js";
import { loadConfig } from "../config/app-config.js";

export function createBridgeApp({
  env = process.env,
  codexAppServerFactory = (options) => new CodexAppServerProcess(options),
  feishuTransport,
  threadStoreFactory = (config) =>
    new FileThreadStore({ filePath: config.threadStorePath }),
} = {}) {
  const config = loadConfig(env);
  const policy = new AccessPolicy({
    allowedOpenIds: config.allowedOpenIds,
    allowedWorkdirs: config.allowedWorkdirs,
    defaultWorkdir: config.defaultWorkdir,
  });
  const threadStore = threadStoreFactory(config);
  const feishuMessageClient = new FeishuMessageClient({
    transport: feishuTransport,
  });
  const cardController = new TaskCardController({
    sendAction: (action) => feishuMessageClient.sendAction(action),
  });
  const appServer = codexAppServerFactory({
    codexBin: config.codexBin,
  });

  let session = null;
  let runtime = null;
  let eventHandler = null;

  return {
    config,
    get eventHandler() {
      return eventHandler;
    },
    async start() {
      session = await appServer.start();
      runtime = new BridgeRuntime({
        policy,
        threadStore,
        session,
        cardController,
        turnTimeoutMs: config.turnTimeoutSeconds * 1000,
      });
      eventHandler = new FeishuEventHandler({
        runtime,
        expectedAppId: config.feishuAppId,
      });
      return eventHandler;
    },
  };
}
