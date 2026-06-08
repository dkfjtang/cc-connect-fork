const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CODEX_LISTEN = "stdio://";
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_TURN_TIMEOUT_SECONDS = 900;
const DEFAULT_THREAD_STORE_PATH = "data/threads.json";

export function loadConfig(env = process.env) {
  const allowedWorkdirs = splitList(env.FCA_ALLOWED_WORKDIRS, ";");
  const turnTimeoutSeconds = parsePositiveInteger(
    env.FCA_TURN_TIMEOUT_SECONDS,
    DEFAULT_TURN_TIMEOUT_SECONDS,
    "FCA_TURN_TIMEOUT_SECONDS",
  );

  return {
    allowedOpenIds: splitList(env.FCA_ALLOWED_OPEN_IDS, ","),
    allowedWorkdirs,
    defaultWorkdir: env.FCA_DEFAULT_WORKDIR?.trim() || null,
    codexBin: env.FCA_CODEX_BIN?.trim() || DEFAULT_CODEX_BIN,
    codexListen: env.FCA_CODEX_LISTEN?.trim() || DEFAULT_CODEX_LISTEN,
    codexModel: env.FCA_CODEX_MODEL?.trim() || null,
    logLevel: env.FCA_LOG_LEVEL?.trim() || DEFAULT_LOG_LEVEL,
    threadStorePath: env.FCA_THREAD_STORE_PATH?.trim() || DEFAULT_THREAD_STORE_PATH,
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
