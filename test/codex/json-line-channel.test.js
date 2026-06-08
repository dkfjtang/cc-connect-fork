import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";

import { JsonLineChannel } from "../../src/codex/json-line-channel.js";

test("write serializes a message as one JSON line", () => {
  const written = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk.toString("utf8"));
      callback();
    },
  });

  const channel = new JsonLineChannel({
    input: new PassThrough(),
    output,
    onMessage: () => {},
  });

  channel.write({ id: 1, method: "initialize", params: {} });

  assert.deepEqual(written, ['{"id":1,"method":"initialize","params":{}}\n']);
});

test("input chunks are reassembled into JSON messages", () => {
  const input = new PassThrough();
  const messages = [];

  new JsonLineChannel({
    input,
    output: new PassThrough(),
    onMessage: (message) => messages.push(message),
  });

  input.write('{"id":1,"result":');
  input.write('{"ok":true}}\n{"method":"turn/started","params":{}}\n');

  assert.deepEqual(messages, [
    { id: 1, result: { ok: true } },
    { method: "turn/started", params: {} },
  ]);
});

test("invalid JSON lines are reported without stopping later messages", () => {
  const input = new PassThrough();
  const messages = [];
  const errors = [];

  new JsonLineChannel({
    input,
    output: new PassThrough(),
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error),
  });

  input.write("not-json\n");
  input.write('{"id":2,"result":{"ok":true}}\n');

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Invalid JSON line from app-server/);
  assert.deepEqual(messages, [{ id: 2, result: { ok: true } }]);
});
