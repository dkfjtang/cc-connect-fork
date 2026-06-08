import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { FileThreadStore, MemoryThreadStore } from "../../src/store/thread-store.js";

test("MemoryThreadStore returns null when mapping is missing", async () => {
  const store = new MemoryThreadStore();

  assert.equal(
    await store.getThread({ openId: "ou_1", cwd: "F:\\development\\f-codex" }),
    null,
  );
});

test("MemoryThreadStore saves and retrieves mapping by open id and cwd", async () => {
  const store = new MemoryThreadStore({ now: () => "test-now" });

  await store.saveThread({
    openId: "ou_1",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_123",
    lastTurnId: "turn_123",
  });

  assert.deepEqual(
    await store.getThread({ openId: "ou_1", cwd: "F:\\development\\f-codex" }),
    {
      openId: "ou_1",
      cwd: "F:\\development\\f-codex",
      threadId: "thr_123",
      lastTurnId: "turn_123",
      lastSeenAt: "test-now",
    },
  );
});

test("MemoryThreadStore isolates mappings by cwd", async () => {
  const store = new MemoryThreadStore({ now: () => "test-now" });

  await store.saveThread({
    openId: "ou_1",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_123",
  });

  assert.equal(await store.getThread({ openId: "ou_1", cwd: "F:\\development\\IDSS" }), null);
});

test("MemoryThreadStore can scope mappings by group chat id", async () => {
  const store = new MemoryThreadStore({ now: () => "test-now" });

  await store.saveThread({
    openId: "ou_1",
    chatId: "oc_group",
    chatType: "group",
    conversationId: "oc_group",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_group",
  });

  assert.deepEqual(
    await store.getThread({
      conversationId: "oc_group",
      cwd: "F:\\development\\f-codex",
    }),
    {
      openId: "ou_1",
      chatId: "oc_group",
      chatType: "group",
      conversationId: "oc_group",
      cwd: "F:\\development\\f-codex",
      threadId: "thr_group",
      lastTurnId: null,
      lastSeenAt: "test-now",
    },
  );
  assert.equal(
    await store.getThread({
      openId: "ou_1",
      cwd: "F:\\development\\f-codex",
    }),
    null,
  );
});

test("MemoryThreadStore reuses legacy user scoped records without conversation id", async () => {
  const store = new MemoryThreadStore({
    records: [
      {
        openId: "ou_1",
        cwd: "F:\\development\\f-codex",
        threadId: "thr_legacy",
      },
    ],
  });

  assert.deepEqual(
    await store.getThread({
      openId: "ou_1",
      cwd: "F:\\development\\f-codex",
    }),
    {
      openId: "ou_1",
      cwd: "F:\\development\\f-codex",
      threadId: "thr_legacy",
    },
  );
});

test("MemoryThreadStore isolates group mappings from different group chats", async () => {
  const store = new MemoryThreadStore({ now: () => "test-now" });

  await store.saveThread({
    openId: "ou_1",
    chatId: "oc_a",
    chatType: "group",
    conversationId: "oc_a",
    cwd: "F:\\development\\f-codex",
    threadId: "thr_a",
  });

  assert.equal(
    await store.getThread({
      conversationId: "oc_b",
      cwd: "F:\\development\\f-codex",
    }),
    null,
  );
});

test("FileThreadStore persists mappings to JSON file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fca-thread-store-"));
  const filePath = join(dir, "threads.json");

  try {
    const store = new FileThreadStore({ filePath, now: () => "test-now" });
    await store.saveThread({
      openId: "ou_1",
      cwd: "F:\\development\\f-codex",
      threadId: "thr_123",
      lastTurnId: "turn_123",
    });

    const loaded = new FileThreadStore({ filePath, now: () => "unused" });
    assert.deepEqual(
      await loaded.getThread({ openId: "ou_1", cwd: "F:\\development\\f-codex" }),
      {
        openId: "ou_1",
        cwd: "F:\\development\\f-codex",
        threadId: "thr_123",
        lastTurnId: "turn_123",
        lastSeenAt: "test-now",
      },
    );

    const raw = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(raw.version, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
