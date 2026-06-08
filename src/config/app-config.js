import { readFileSync } from "node:fs";

const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CODEX_LISTEN = "stdio://";
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_TURN_TIMEOUT_SECONDS = 900;
const DEFAULT_APPROVAL_TIMEOUT_SECONDS = 300;
const DEFAULT_MESSAGE_DEDUP_TTL_SECONDS = 86400;
const DEFAULT_THREAD_STORE_PATH = "data/threads.json";
const DEFAULT_SQLITE_THREAD_STORE_PATH = "data/threads.sqlite";
const DEFAULT_THREAD_STORE_DRIVER = "json";
const DEFAULT_MESSAGE_DEDUP_STORE_PATH = "data/message-dedup.json";
const DEFAULT_APP_VERSION = "0.1.0";

export function loadConfig(env = process.env) {
  const allowedWorkdirs = splitList(env.FCA_ALLOWED_WORKDIRS, ";");
  const groupConfigPath = env.FCA_GROUP_CONFIG_PATH?.trim() || null;
  const groupConfig = parseGroupConfigFile(groupConfigPath);
  const groupSenderOpenIds = mergeGroupSenderOpenIds(
    parseGroupSenderOpenIds(env.FCA_GROUP_SENDER_OPEN_IDS),
    groupConfig.groupSenderOpenIds,
  );
  const groupDeveloperInstructions = {
    ...parseGroupDeveloperInstructions(env.FCA_GROUP_DEVELOPER_INSTRUCTIONS),
    ...groupConfig.groupDeveloperInstructions,
  };
  const turnTimeoutSeconds = parsePositiveInteger(
    env.FCA_TURN_TIMEOUT_SECONDS,
    DEFAULT_TURN_TIMEOUT_SECONDS,
    "FCA_TURN_TIMEOUT_SECONDS",
  );
  const approvalTimeoutSeconds = parsePositiveInteger(
    env.FCA_APPROVAL_TIMEOUT_SECONDS,
    DEFAULT_APPROVAL_TIMEOUT_SECONDS,
    "FCA_APPROVAL_TIMEOUT_SECONDS",
  );
  const messageDedupTtlSeconds = parsePositiveInteger(
    env.FCA_MESSAGE_DEDUP_TTL_SECONDS,
    DEFAULT_MESSAGE_DEDUP_TTL_SECONDS,
    "FCA_MESSAGE_DEDUP_TTL_SECONDS",
  );
  const threadStoreDriver = parseThreadStoreDriver(env.FCA_THREAD_STORE_DRIVER);

  return {
    feishuAppId: env.FEISHU_APP_ID?.trim() || null,
    allowedOpenIds: splitList(env.FCA_ALLOWED_OPEN_IDS, ","),
    allowedGroupChatIds: unique([
      ...splitList(env.FCA_ALLOWED_GROUP_CHAT_IDS, ","),
      ...groupConfig.allowedGroupChatIds,
    ]),
    groupSenderOpenIds,
    groupDeveloperInstructions,
    groupConfigPath,
    groupConfigCount: groupConfig.allowedGroupChatIds.length,
    allowedWorkdirs,
    defaultWorkdir: env.FCA_DEFAULT_WORKDIR?.trim() || null,
    codexBin: env.FCA_CODEX_BIN?.trim() || DEFAULT_CODEX_BIN,
    codexListen: env.FCA_CODEX_LISTEN?.trim() || DEFAULT_CODEX_LISTEN,
    codexModel: env.FCA_CODEX_MODEL?.trim() || null,
    appVersion: env.FCA_VERSION?.trim() || DEFAULT_APP_VERSION,
    logLevel: env.FCA_LOG_LEVEL?.trim() || DEFAULT_LOG_LEVEL,
    threadStoreDriver,
    threadStorePath:
      env.FCA_THREAD_STORE_PATH?.trim() || defaultThreadStorePath(threadStoreDriver),
    messageDedupStorePath:
      env.FCA_MESSAGE_DEDUP_STORE_PATH?.trim() || DEFAULT_MESSAGE_DEDUP_STORE_PATH,
    messageDedupTtlSeconds,
    turnTimeoutSeconds,
    approvalTimeoutSeconds,
  };
}

function parseGroupConfigFile(filePath) {
  if (!filePath) {
    return {
      allowedGroupChatIds: [],
      groupSenderOpenIds: {},
      groupDeveloperInstructions: {},
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`FCA_GROUP_CONFIG_PATH could not be read as JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.groups)) {
    throw new Error("FCA_GROUP_CONFIG_PATH must contain a JSON object with a groups array");
  }

  const allowedGroupChatIds = [];
  const groupSenderOpenIds = {};
  const groupDeveloperInstructions = {};

  for (const group of parsed.groups) {
    if (group?.enabled === false) {
      continue;
    }

    const chatId = typeof group?.chatId === "string" ? group.chatId.trim() : "";
    if (!chatId) {
      throw new Error("FCA_GROUP_CONFIG_PATH groups entries must include chatId");
    }

    allowedGroupChatIds.push(chatId);

    if (group.allowedSenderOpenIds !== undefined) {
      if (!Array.isArray(group.allowedSenderOpenIds)) {
        throw new Error("FCA_GROUP_CONFIG_PATH allowedSenderOpenIds must be an array");
      }
      const openIds = group.allowedSenderOpenIds
        .map((openId) => (typeof openId === "string" ? openId.trim() : ""))
        .filter(Boolean);
      if (openIds.length > 0) {
        groupSenderOpenIds[chatId] = unique(openIds);
      }
    }

    if (group.developerInstructions !== undefined) {
      const instructions =
        typeof group.developerInstructions === "string"
          ? group.developerInstructions.trim()
          : "";
      if (!instructions) {
        throw new Error("FCA_GROUP_CONFIG_PATH developerInstructions must be a non-empty string");
      }
      groupDeveloperInstructions[chatId] = instructions;
    }
  }

  return {
    allowedGroupChatIds: unique(allowedGroupChatIds),
    groupSenderOpenIds,
    groupDeveloperInstructions,
  };
}

function mergeGroupSenderOpenIds(...configs) {
  const result = {};
  for (const config of configs) {
    for (const [chatId, openIds] of Object.entries(config)) {
      result[chatId] = unique([...(result[chatId] ?? []), ...openIds]);
    }
  }

  return result;
}

function unique(values) {
  return [...new Set(values)];
}

function defaultThreadStorePath(driver) {
  return driver === "sqlite" ? DEFAULT_SQLITE_THREAD_STORE_PATH : DEFAULT_THREAD_STORE_PATH;
}

function parseThreadStoreDriver(value) {
  const driver = value?.trim() || DEFAULT_THREAD_STORE_DRIVER;
  if (!["json", "sqlite"].includes(driver)) {
    throw new Error("FCA_THREAD_STORE_DRIVER must be json or sqlite");
  }

  return driver;
}

function splitList(value, separator) {
  if (!value) {
    return [];
  }

  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback, name) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseGroupSenderOpenIds(value) {
  if (!value) {
    return {};
  }

  const result = {};
  for (const rawEntry of value.split(";")) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }

    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error("FCA_GROUP_SENDER_OPEN_IDS entries must use chat_id=open_id[,open_id]");
    }

    const chatId = entry.slice(0, separatorIndex).trim();
    const openIds = splitList(entry.slice(separatorIndex + 1), ",");
    if (!chatId || openIds.length === 0) {
      throw new Error("FCA_GROUP_SENDER_OPEN_IDS entries must use chat_id=open_id[,open_id]");
    }

    result[chatId] = openIds;
  }

  return result;
}

function parseGroupDeveloperInstructions(value) {
  if (!value) {
    return {};
  }

  const result = {};
  for (const rawEntry of value.split(";")) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }

    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error("FCA_GROUP_DEVELOPER_INSTRUCTIONS entries must use chat_id=instructions");
    }

    const chatId = entry.slice(0, separatorIndex).trim();
    const instructions = entry.slice(separatorIndex + 1).trim();
    if (!chatId || !instructions) {
      throw new Error("FCA_GROUP_DEVELOPER_INSTRUCTIONS entries must use chat_id=instructions");
    }

    result[chatId] = instructions;
  }

  return result;
}
