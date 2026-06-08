import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const STORE_VERSION = 1;

export class MemoryThreadStore {
  #records = new Map();
  #now;

  constructor({ records = [], now = () => new Date().toISOString() } = {}) {
    this.#now = now;
    for (const record of records) {
      this.#records.set(mappingKey(record), { ...record });
    }
  }

  async getThread(query) {
    return this.#records.get(mappingKey(query)) ?? null;
  }

  async saveThread({
    openId,
    chatId = null,
    chatType = null,
    conversationId = null,
    cwd,
    threadId,
    lastTurnId = null,
  }) {
    const record = {
      openId,
      ...(chatId ? { chatId } : {}),
      ...(chatType ? { chatType } : {}),
      ...(conversationId ? { conversationId } : {}),
      cwd,
      threadId,
      lastTurnId,
      lastSeenAt: this.#now(),
    };
    this.#records.set(mappingKey(record), record);
    await this.afterSave();
    return record;
  }

  records() {
    return [...this.#records.values()].map((record) => ({ ...record }));
  }

  replaceRecords(records) {
    this.#records.clear();
    for (const record of records) {
      this.#records.set(mappingKey(record), { ...record });
    }
  }

  async afterSave() {}
}

export class FileThreadStore extends MemoryThreadStore {
  #filePath;

  constructor({ filePath, now = () => new Date().toISOString() }) {
    super({ records: [], now });
    this.#filePath = filePath;
  }

  async getThread(query) {
    await this.#load();
    return super.getThread(query);
  }

  async saveThread(record) {
    await this.#load();
    return super.saveThread(record);
  }

  async afterSave() {
    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(
      this.#filePath,
      JSON.stringify({ version: STORE_VERSION, records: this.records() }, null, 2),
      "utf8",
    );
  }

  async #load() {
    const data = await readStoreFile(this.#filePath);
    this.replaceRecords(data.records ?? []);
  }
}

export class SqliteThreadStore {
  #filePath;
  #now;
  #db = null;

  constructor({ filePath, now = () => new Date().toISOString() }) {
    this.#filePath = filePath;
    this.#now = now;
  }

  async getThread(query) {
    const db = await this.#open();
    const row = db
      .prepare(
        `SELECT open_id, chat_id, chat_type, conversation_id, cwd, thread_id, last_turn_id, last_seen_at
         FROM thread_mappings
         WHERE conversation_key = ? AND cwd = ?`,
      )
      .get(mappingConversationKey(query), query.cwd);

    return row ? rowToRecord(row) : null;
  }

  async saveThread({
    openId,
    chatId = null,
    chatType = null,
    conversationId = null,
    cwd,
    threadId,
    lastTurnId = null,
  }) {
    const db = await this.#open();
    const record = {
      openId,
      ...(chatId ? { chatId } : {}),
      ...(chatType ? { chatType } : {}),
      ...(conversationId ? { conversationId } : {}),
      cwd,
      threadId,
      lastTurnId,
      lastSeenAt: this.#now(),
    };

    db.prepare(
      `INSERT INTO thread_mappings (
         conversation_key,
         open_id,
         chat_id,
         chat_type,
         conversation_id,
         cwd,
         thread_id,
         last_turn_id,
         last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_key, cwd) DO UPDATE SET
         open_id = excluded.open_id,
         chat_id = excluded.chat_id,
         chat_type = excluded.chat_type,
         conversation_id = excluded.conversation_id,
         thread_id = excluded.thread_id,
         last_turn_id = excluded.last_turn_id,
         last_seen_at = excluded.last_seen_at`,
    ).run(
      mappingConversationKey(record),
      openId,
      chatId,
      chatType,
      conversationId,
      cwd,
      threadId,
      lastTurnId,
      record.lastSeenAt,
    );

    return record;
  }

  close() {
    this.#db?.close();
    this.#db = null;
  }

  async #open() {
    if (this.#db) {
      return this.#db;
    }

    await mkdir(dirname(this.#filePath), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    this.#db = new DatabaseSync(this.#filePath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS thread_mappings (
        conversation_key TEXT NOT NULL,
        open_id TEXT NOT NULL,
        chat_id TEXT,
        chat_type TEXT,
        conversation_id TEXT,
        cwd TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        last_turn_id TEXT,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (conversation_key, cwd)
      )
    `);
    return this.#db;
  }
}

async function readStoreFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: STORE_VERSION, records: [] };
    }
    throw error;
  }
}

function mappingKey({ cwd, ...rest }) {
  return `${mappingConversationKey(rest)}\u0000${cwd}`;
}

function mappingConversationKey({ conversationId = null, openId }) {
  return conversationId ?? openId;
}

function rowToRecord(row) {
  const record = {
    openId: row.open_id,
    cwd: row.cwd,
    threadId: row.thread_id,
    lastTurnId: row.last_turn_id,
    lastSeenAt: row.last_seen_at,
  };

  if (row.chat_id) {
    record.chatId = row.chat_id;
  }
  if (row.chat_type) {
    record.chatType = row.chat_type;
  }
  if (row.conversation_id) {
    record.conversationId = row.conversation_id;
  }

  return record;
}
