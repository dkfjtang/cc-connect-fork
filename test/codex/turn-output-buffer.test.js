import assert from "node:assert/strict";
import { test } from "node:test";

import { TurnOutputBuffer } from "../../src/codex/turn-output-buffer.js";

test("appends agent message deltas into final output", () => {
  const buffer = new TurnOutputBuffer();

  buffer.appendDelta("Hello");
  buffer.appendDelta(", Codex");
  buffer.appendDelta("!");

  assert.equal(buffer.finalText(), "Hello, Codex!");
});

test("summary truncates long output without changing final output", () => {
  const buffer = new TurnOutputBuffer({ summaryLimit: 12 });

  buffer.appendDelta("1234567890abcdef");

  assert.equal(buffer.summaryText(), "1234567890ab...");
  assert.equal(buffer.finalText(), "1234567890abcdef");
});

test("empty output summary is a readable placeholder", () => {
  const buffer = new TurnOutputBuffer();

  assert.equal(buffer.summaryText(), "Codex 正在处理...");
});
