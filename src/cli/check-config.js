import { loadConfig } from "../config/app-config.js";

export function checkConfig(env = process.env) {
  const config = loadConfig(env);
  const errors = [];
  const warnings = [];

  if (!config.feishuAppId) {
    errors.push("FEISHU_APP_ID is required");
  }
  if (!env.FEISHU_APP_SECRET?.trim()) {
    errors.push("FEISHU_APP_SECRET is required");
  }
  if (config.allowedOpenIds.length === 0) {
    errors.push("FCA_ALLOWED_OPEN_IDS must include at least one open_id");
  }
  if (config.allowedWorkdirs.length === 0) {
    errors.push("FCA_ALLOWED_WORKDIRS must include at least one workdir");
  }
  if (!config.defaultWorkdir) {
    errors.push("FCA_DEFAULT_WORKDIR is required");
  } else if (!config.allowedWorkdirs.includes(config.defaultWorkdir)) {
    errors.push("FCA_DEFAULT_WORKDIR must be included in FCA_ALLOWED_WORKDIRS");
  }

  if (config.codexListen !== "stdio://") {
    warnings.push("FCA_CODEX_LISTEN is not stdio://; MVP only validates stdio://");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      allowedOpenIdCount: config.allowedOpenIds.length,
      allowedGroupChatIdCount: config.allowedGroupChatIds.length,
      groupConfigPath: config.groupConfigPath,
      groupConfigCount: config.groupConfigCount,
      groupSenderPolicyCount: Object.keys(config.groupSenderOpenIds).length,
      groupDeveloperInstructionCount: Object.keys(config.groupDeveloperInstructions).length,
      allowedWorkdirCount: config.allowedWorkdirs.length,
      appVersion: config.appVersion,
      codexBin: config.codexBin,
      codexModel: config.codexModel,
      defaultWorkdir: config.defaultWorkdir,
      messageDedupStorePath: config.messageDedupStorePath,
      messageDedupTtlSeconds: config.messageDedupTtlSeconds,
      threadStoreDriver: config.threadStoreDriver,
      threadStorePath: config.threadStorePath,
      turnTimeoutSeconds: config.turnTimeoutSeconds,
      approvalTimeoutSeconds: config.approvalTimeoutSeconds,
    },
  };
}

export async function runCheckConfig({
  env = process.env,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  let result;
  try {
    result = checkConfig(env);
  } catch (error) {
    errorOutput.write(`Configuration check failed:\n- ${error.message}\n`);
    return 1;
  }

  if (!result.ok) {
    errorOutput.write(`Configuration check failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`);
    if (result.warnings.length > 0) {
      errorOutput.write(`${result.warnings.map((warning) => `! ${warning}`).join("\n")}\n`);
    }
    return 1;
  }

  output.write("Configuration check passed.\n");
  output.write(`allowedOpenIds: ${result.summary.allowedOpenIdCount}\n`);
  output.write(`allowedGroupChatIds: ${result.summary.allowedGroupChatIdCount}\n`);
  output.write(`groupConfigPath: ${result.summary.groupConfigPath ?? "none"}\n`);
  output.write(`groupConfigGroups: ${result.summary.groupConfigCount}\n`);
  output.write(`groupSenderPolicies: ${result.summary.groupSenderPolicyCount}\n`);
  output.write(`groupDeveloperInstructions: ${result.summary.groupDeveloperInstructionCount}\n`);
  output.write(`allowedWorkdirs: ${result.summary.allowedWorkdirCount}\n`);
  output.write(`defaultWorkdir: ${result.summary.defaultWorkdir}\n`);
  output.write(`codexBin: ${result.summary.codexBin}\n`);
  output.write(`codexModel: ${result.summary.codexModel ?? "default"}\n`);
  output.write(`appVersion: ${result.summary.appVersion}\n`);
  output.write(`threadStoreDriver: ${result.summary.threadStoreDriver}\n`);
  output.write(`threadStorePath: ${result.summary.threadStorePath}\n`);
  output.write(`messageDedupStorePath: ${result.summary.messageDedupStorePath}\n`);
  output.write(`messageDedupTtlSeconds: ${result.summary.messageDedupTtlSeconds}\n`);
  output.write(`turnTimeoutSeconds: ${result.summary.turnTimeoutSeconds}\n`);
  output.write(`approvalTimeoutSeconds: ${result.summary.approvalTimeoutSeconds}\n`);
  if (result.warnings.length > 0) {
    output.write(`${result.warnings.map((warning) => `! ${warning}`).join("\n")}\n`);
  }

  return 0;
}
