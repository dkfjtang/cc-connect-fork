import { AccessPolicy } from "../policy/access-policy.js";
import { BridgeRuntime } from "../runtime/bridge-runtime.js";
import { CodexAppServerProcess } from "../codex/app-server-process.js";
import { FeishuEventHandler } from "../feishu/event-handler.js";
import { FeishuMessageClient } from "../feishu/message-client.js";
import { FileThreadStore, SqliteThreadStore } from "../store/thread-store.js";
import { FileMessageDedupStore } from "../store/message-dedup-store.js";
import { TaskCardController } from "../feishu/task-card-controller.js";
import { loadConfig } from "../config/app-config.js";

export function createBridgeApp({
  env = process.env,
  botOpenId = null,
  codexAppServerFactory = (options) => new CodexAppServerProcess(options),
  feishuTransport,
  logger = null,
  threadStoreFactory = createThreadStore,
  messageDedupStoreFactory = (config) =>
    new FileMessageDedupStore({
      filePath: config.messageDedupStorePath,
      ttlMs: config.messageDedupTtlSeconds * 1000,
    }),
} = {}) {
  const config = loadConfig(env);
  const policy = new AccessPolicy({
    allowedOpenIds: config.allowedOpenIds,
    allowedWorkdirs: config.allowedWorkdirs,
    defaultWorkdir: config.defaultWorkdir,
  });
  const threadStore = threadStoreFactory(config);
  const messageDedupStore = messageDedupStoreFactory(config);
  const feishuMessageClient = new FeishuMessageClient({
    transport: feishuTransport,
    cardChannel: config.cardChannel,
  });
  const cardController = new TaskCardController({
    sendAction: (action) => feishuMessageClient.sendAction(action),
    footerFields: config.cardFooterFields,
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
        logger,
        model: config.codexModel,
        appVersion: config.appVersion,
        groupDeveloperInstructions: config.groupDeveloperInstructions,
        turnTimeoutMs: config.turnTimeoutSeconds * 1000,
        approvalTimeoutMs: config.approvalTimeoutSeconds * 1000,
      });
      eventHandler = new FeishuEventHandler({
        runtime,
        expectedAppId: config.feishuAppId,
        botOpenId,
        allowedGroupChatIds: config.allowedGroupChatIds,
        groupSenderOpenIds: config.groupSenderOpenIds,
        messageDedupStore,
        unsupportedMessageClient: feishuMessageClient,
        logger,
      });
      return eventHandler;
    },
    async stop() {
      if (typeof appServer.stop === "function") {
        await appServer.stop();
      }
      session = null;
      runtime = null;
      eventHandler = null;
    },
  };
}

export function createThreadStore(config) {
  if (config.threadStoreDriver === "sqlite") {
    return new SqliteThreadStore({ filePath: config.threadStorePath });
  }

  return new FileThreadStore({ filePath: config.threadStorePath });
}
