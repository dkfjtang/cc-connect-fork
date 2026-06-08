import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadConfig } from "../../src/config/app-config.js";

test("loadConfig parses comma separated open ids and semicolon separated workdirs", () => {
  const config = loadConfig({
    FCA_ALLOWED_OPEN_IDS: "ou_1, ou_2",
    FCA_ALLOWED_GROUP_CHAT_IDS: "oc_1, oc_2",
    FCA_GROUP_SENDER_OPEN_IDS: "oc_1=ou_1,ou_2; oc_2=ou_2",
    FCA_GROUP_DEVELOPER_INSTRUCTIONS: "oc_1=只处理 A 项目; oc_2=只处理 B 项目",
    FCA_THREAD_STORE_DRIVER: "sqlite",
    FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex;F:\\development\\IDSS",
    FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    FEISHU_APP_ID: "cli_123",
    FCA_CODEX_BIN: "codex",
    FCA_CODEX_MODEL: "gpt-5.1-codex",
    FCA_VERSION: "0.2.0-test",
    FCA_THREAD_STORE_PATH: "data\\threads.json",
    FCA_MESSAGE_DEDUP_STORE_PATH: "data\\message-dedup.json",
    FCA_MESSAGE_DEDUP_TTL_SECONDS: "3600",
    FCA_TURN_TIMEOUT_SECONDS: "120",
    FCA_APPROVAL_TIMEOUT_SECONDS: "30",
    FCA_CARD_CHANNEL: "cardkit",
    FCA_CARD_FOOTER_FIELDS: "status,elapsed,tokens,model",
  });

  assert.deepEqual(config.allowedOpenIds, ["ou_1", "ou_2"]);
  assert.deepEqual(config.allowedGroupChatIds, ["oc_1", "oc_2"]);
  assert.deepEqual(config.groupSenderOpenIds, {
    oc_1: ["ou_1", "ou_2"],
    oc_2: ["ou_2"],
  });
  assert.deepEqual(config.groupDeveloperInstructions, {
    oc_1: "只处理 A 项目",
    oc_2: "只处理 B 项目",
  });
  assert.deepEqual(config.allowedWorkdirs, [
    "F:\\development\\f-codex",
    "F:\\development\\IDSS",
  ]);
  assert.equal(config.threadStoreDriver, "sqlite");
  assert.equal(config.feishuAppId, "cli_123");
  assert.equal(config.defaultWorkdir, "F:\\development\\f-codex");
  assert.equal(config.codexBin, "codex");
  assert.equal(config.codexModel, "gpt-5.1-codex");
  assert.equal(config.appVersion, "0.2.0-test");
  assert.equal(config.threadStorePath, "data\\threads.json");
  assert.equal(config.messageDedupStorePath, "data\\message-dedup.json");
  assert.equal(config.messageDedupTtlSeconds, 3600);
  assert.equal(config.turnTimeoutSeconds, 120);
  assert.equal(config.approvalTimeoutSeconds, 30);
  assert.equal(config.cardChannel, "cardkit");
  assert.deepEqual(config.cardFooterFields, ["status", "elapsed", "tokens", "model"]);
});

test("loadConfig merges group configuration file with env group settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "fca-config-"));
  const groupConfigPath = join(dir, "groups.json");
  writeFileSync(
    groupConfigPath,
    JSON.stringify({
      groups: [
        {
          chatId: "oc_file",
          allowedSenderOpenIds: ["ou_file_1", "ou_file_2"],
          developerInstructions: "只处理文件配置项目",
        },
        {
          chatId: "oc_open",
        },
      ],
    }),
    "utf8",
  );

  const config = loadConfig({
    FCA_ALLOWED_GROUP_CHAT_IDS: "oc_env",
    FCA_GROUP_SENDER_OPEN_IDS: "oc_env=ou_env;oc_file=ou_env_file",
    FCA_GROUP_DEVELOPER_INSTRUCTIONS: "oc_env=只处理环境变量项目",
    FCA_GROUP_CONFIG_PATH: groupConfigPath,
  });

  assert.equal(config.groupConfigPath, groupConfigPath);
  assert.deepEqual(config.allowedGroupChatIds, ["oc_env", "oc_file", "oc_open"]);
  assert.deepEqual(config.groupSenderOpenIds, {
    oc_env: ["ou_env"],
    oc_file: ["ou_env_file", "ou_file_1", "ou_file_2"],
  });
  assert.deepEqual(config.groupDeveloperInstructions, {
    oc_env: "只处理环境变量项目",
    oc_file: "只处理文件配置项目",
  });
});

test("loadConfig uses safe local defaults when optional values are missing", () => {
  const config = loadConfig({});

  assert.deepEqual(config.allowedOpenIds, []);
  assert.deepEqual(config.allowedGroupChatIds, []);
  assert.deepEqual(config.groupSenderOpenIds, {});
  assert.deepEqual(config.groupDeveloperInstructions, {});
  assert.equal(config.threadStoreDriver, "json");
  assert.deepEqual(config.allowedWorkdirs, []);
  assert.equal(config.defaultWorkdir, null);
  assert.equal(config.feishuAppId, null);
  assert.equal(config.codexBin, "codex");
  assert.equal(config.codexListen, "stdio://");
  assert.equal(config.codexModel, null);
  assert.equal(config.appVersion, "0.1.0");
  assert.equal(config.logLevel, "info");
  assert.equal(config.threadStorePath, "data/threads.json");
  assert.equal(config.messageDedupStorePath, "data/message-dedup.json");
  assert.equal(config.messageDedupTtlSeconds, 86400);
  assert.equal(config.turnTimeoutSeconds, 900);
  assert.equal(config.approvalTimeoutSeconds, 300);
  assert.equal(config.cardChannel, "im");
  assert.deepEqual(config.cardFooterFields, [
    "status",
    "thread",
    "turn",
    "elapsed",
    "tokens",
    "model",
    "version",
    "error",
    "cwd",
  ]);
});

test("loadConfig uses sqlite default thread store path when sqlite driver is selected", () => {
  const config = loadConfig({ FCA_THREAD_STORE_DRIVER: "sqlite" });

  assert.equal(config.threadStoreDriver, "sqlite");
  assert.equal(config.threadStorePath, "data/threads.sqlite");
});

test("loadConfig rejects non-positive turn timeout", () => {
  assert.throws(
    () => loadConfig({ FCA_TURN_TIMEOUT_SECONDS: "0" }),
    /FCA_TURN_TIMEOUT_SECONDS must be a positive integer/,
  );
});

test("loadConfig rejects non-positive approval timeout", () => {
  assert.throws(
    () => loadConfig({ FCA_APPROVAL_TIMEOUT_SECONDS: "0" }),
    /FCA_APPROVAL_TIMEOUT_SECONDS must be a positive integer/,
  );
});

test("loadConfig rejects non-positive message dedup ttl", () => {
  assert.throws(
    () => loadConfig({ FCA_MESSAGE_DEDUP_TTL_SECONDS: "0" }),
    /FCA_MESSAGE_DEDUP_TTL_SECONDS must be a positive integer/,
  );
});

test("loadConfig rejects malformed group sender policy", () => {
  assert.throws(
    () => loadConfig({ FCA_GROUP_SENDER_OPEN_IDS: "oc_1" }),
    /FCA_GROUP_SENDER_OPEN_IDS entries must use chat_id=open_id/,
  );
});

test("loadConfig rejects malformed group developer instructions", () => {
  assert.throws(
    () => loadConfig({ FCA_GROUP_DEVELOPER_INSTRUCTIONS: "oc_1" }),
    /FCA_GROUP_DEVELOPER_INSTRUCTIONS entries must use chat_id=instructions/,
  );
});

test("loadConfig rejects malformed group configuration file", () => {
  const dir = mkdtempSync(join(tmpdir(), "fca-config-"));
  const groupConfigPath = join(dir, "groups.json");
  writeFileSync(groupConfigPath, JSON.stringify({ groups: [{ allowedSenderOpenIds: ["ou_1"] }] }), "utf8");

  assert.throws(
    () => loadConfig({ FCA_GROUP_CONFIG_PATH: groupConfigPath }),
    /FCA_GROUP_CONFIG_PATH groups entries must include chatId/,
  );
});

test("loadConfig rejects unsupported thread store driver", () => {
  assert.throws(
    () => loadConfig({ FCA_THREAD_STORE_DRIVER: "mysql" }),
    /FCA_THREAD_STORE_DRIVER must be json or sqlite/,
  );
});

test("loadConfig rejects unsupported card footer fields", () => {
  assert.throws(
    () => loadConfig({ FCA_CARD_FOOTER_FIELDS: "status,secret" }),
    /FCA_CARD_FOOTER_FIELDS contains unsupported field: secret/,
  );
});

test("loadConfig rejects unsupported card channel", () => {
  assert.throws(
    () => loadConfig({ FCA_CARD_CHANNEL: "legacy" }),
    /FCA_CARD_CHANNEL must be im or cardkit/,
  );
});
