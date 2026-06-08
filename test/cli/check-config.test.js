import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkConfig,
  runCheckConfig,
} from "../../src/cli/check-config.js";

test("checkConfig reports missing required Feishu credentials", () => {
  const result = checkConfig({});

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "FEISHU_APP_ID is required",
    "FEISHU_APP_SECRET is required",
    "FCA_ALLOWED_OPEN_IDS must include at least one open_id",
    "FCA_ALLOWED_WORKDIRS must include at least one workdir",
    "FCA_DEFAULT_WORKDIR is required",
  ]);
});

test("checkConfig reports default workdir outside allowlist", () => {
  const result = checkConfig({
    FEISHU_APP_ID: "cli_123",
    FEISHU_APP_SECRET: "secret",
    FCA_ALLOWED_OPEN_IDS: "ou_123",
    FCA_ALLOWED_WORKDIRS: "F:\\development\\IDSS",
    FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "FCA_DEFAULT_WORKDIR must be included in FCA_ALLOWED_WORKDIRS",
  ]);
});

test("checkConfig accepts a complete MVP configuration", () => {
  const result = checkConfig({
    FEISHU_APP_ID: "cli_123",
    FEISHU_APP_SECRET: "secret",
    FCA_ALLOWED_OPEN_IDS: "ou_123",
    FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
    FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
  });

  assert.deepEqual(result, {
    ok: true,
    errors: [],
    warnings: [],
    summary: {
      allowedOpenIdCount: 1,
      allowedWorkdirCount: 1,
      appVersion: "0.1.0",
      codexBin: "codex",
      codexModel: null,
      defaultWorkdir: "F:\\development\\f-codex",
      messageDedupStorePath: "data/message-dedup.json",
      messageDedupTtlSeconds: 86400,
      threadStorePath: "data/threads.json",
      turnTimeoutSeconds: 900,
    },
  });
});

test("runCheckConfig prints errors and returns non-zero on invalid config", async () => {
  let stdout = "";
  let stderr = "";

  const exitCode = await runCheckConfig({
    env: {},
    output: { write: (text) => (stdout += text) },
    errorOutput: { write: (text) => (stderr += text) },
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /Configuration check failed/);
  assert.match(stderr, /FEISHU_APP_ID is required/);
});

test("runCheckConfig prints summary and returns zero on valid config", async () => {
  let stdout = "";

  const exitCode = await runCheckConfig({
    env: {
      FEISHU_APP_ID: "cli_123",
      FEISHU_APP_SECRET: "secret",
      FCA_ALLOWED_OPEN_IDS: "ou_123",
      FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex",
      FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    },
    output: { write: (text) => (stdout += text) },
    errorOutput: { write: () => {} },
  });

  assert.equal(exitCode, 0);
  assert.match(stdout, /Configuration check passed/);
  assert.match(stdout, /allowedOpenIds: 1/);
  assert.match(stdout, /codexModel: default/);
  assert.match(stdout, /appVersion: 0.1.0/);
  assert.match(stdout, /messageDedupStorePath: data\/message-dedup.json/);
});
