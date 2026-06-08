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

  async getThread({ openId, cwd }) {
    return this.#records.get(mappingKey({ openId, cwd })) ?? null;
  }

  async saveThread({ openId, cwd, threadId, lastTurnId = null }) {
    const record = {
      openId,
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

function mappingKey({ openId, cwd }) {
  return `${openId}\u0000${cwd}`;
}
