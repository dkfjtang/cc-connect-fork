import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../../src/config/app-config.js";

test("loadConfig parses comma separated open ids and semicolon separated workdirs", () => {
  const config = loadConfig({
    FCA_ALLOWED_OPEN_IDS: "ou_1, ou_2",
    FCA_ALLOWED_WORKDIRS: "F:\\development\\f-codex;F:\\development\\IDSS",
    FCA_DEFAULT_WORKDIR: "F:\\development\\f-codex",
    FCA_CODEX_BIN: "codex",
    FCA_THREAD_STORE_PATH: "data\\threads.json",
    FCA_TURN_TIMEOUT_SECONDS: "120",
  });

  assert.deepEqual(config.allowedOpenIds, ["ou_1", "ou_2"]);
  assert.deepEqual(config.allowedWorkdirs, [
    "F:\\development\\f-codex",
    "F:\\development\\IDSS",
  ]);
  assert.equal(config.defaultWorkdir, "F:\\development\\f-codex");
  assert.equal(config.codexBin, "codex");
  assert.equal(config.threadStorePath, "data\\threads.json");
  assert.equal(config.turnTimeoutSeconds, 120);
});

test("loadConfig uses safe local defaults when optional values are missing", () => {
  const config = loadConfig({});

  assert.deepEqual(config.allowedOpenIds, []);
  assert.deepEqual(config.allowedWorkdirs, []);
  assert.equal(config.defaultWorkdir, null);
  assert.equal(config.codexBin, "codex");
  assert.equal(config.codexListen, "stdio://");
  assert.equal(config.logLevel, "info");
  assert.equal(config.threadStorePath, "data/threads.json");
  assert.equal(config.turnTimeoutSeconds, 900);
});

test("loadConfig rejects non-positive turn timeout", () => {
  assert.throws(
    () => loadConfig({ FCA_TURN_TIMEOUT_SECONDS: "0" }),
    /FCA_TURN_TIMEOUT_SECONDS must be a positive integer/,
  );
});
