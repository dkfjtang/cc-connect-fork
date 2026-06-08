const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CODEX_LISTEN = "stdio://";
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_TURN_TIMEOUT_SECONDS = 900;
const DEFAULT_MESSAGE_DEDUP_TTL_SECONDS = 86400;
const DEFAULT_THREAD_STORE_PATH = "data/threads.json";
const DEFAULT_MESSAGE_DEDUP_STORE_PATH = "data/message-dedup.json";
const DEFAULT_APP_VERSION = "0.1.0";

export function loadConfig(env = process.env) {
  const allowedWorkdirs = splitList(env.FCA_ALLOWED_WORKDIRS, ";");
  const turnTimeoutSeconds = parsePositiveInteger(
    env.FCA_TURN_TIMEOUT_SECONDS,
    DEFAULT_TURN_TIMEOUT_SECONDS,
    "FCA_TURN_TIMEOUT_SECONDS",
  );
  const messageDedupTtlSeconds = parsePositiveInteger(
    env.FCA_MESSAGE_DEDUP_TTL_SECONDS,
    DEFAULT_MESSAGE_DEDUP_TTL_SECONDS,
    "FCA_MESSAGE_DEDUP_TTL_SECONDS",
  );

  return {
    feishuAppId: env.FEISHU_APP_ID?.trim() || null,
    allowedOpenIds: splitList(env.FCA_ALLOWED_OPEN_IDS, ","),
    allowedGroupChatIds: splitList(env.FCA_ALLOWED_GROUP_CHAT_IDS, ","),
    groupSenderOpenIds: parseGroupSenderOpenIds(env.FCA_GROUP_SENDER_OPEN_IDS),
    groupDeveloperInstructions: parseGroupDeveloperInstructions(
      env.FCA_GROUP_DEVELOPER_INSTRUCTIONS,
    ),
    allowedWorkdirs,
    defaultWorkdir: env.FCA_DEFAULT_WORKDIR?.trim() || null,
    codexBin: env.FCA_CODEX_BIN?.trim() || DEFAULT_CODEX_BIN,
    codexListen: env.FCA_CODEX_LISTEN?.trim() || DEFAULT_CODEX_LISTEN,
    codexModel: env.FCA_CODEX_MODEL?.trim() || null,
    appVersion: env.FCA_VERSION?.trim() || DEFAULT_APP_VERSION,
    logLevel: env.FCA_LOG_LEVEL?.trim() || DEFAULT_LOG_LEVEL,
    threadStorePath: env.FCA_THREAD_STORE_PATH?.trim() || DEFAULT_THREAD_STORE_PATH,
    messageDedupStorePath:
      env.FCA_MESSAGE_DEDUP_STORE_PATH?.trim() || DEFAULT_MESSAGE_DEDUP_STORE_PATH,
    messageDedupTtlSeconds,
    turnTimeoutSeconds,
  };
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
