import { JsonRpcClient } from "./json-rpc-client.js";

const DEFAULT_CLIENT_INFO = {
  name: "feishu_codex_bridge",
  title: "Feishu Codex Bridge",
  version: "0.1.0",
};

export class AppServerSession {
  #client;
  #clientInfo;
  #eventHandlers = new Set();

  constructor({ write, onEvent = () => {}, clientInfo = DEFAULT_CLIENT_INFO }) {
    this.#clientInfo = clientInfo;
    this.#eventHandlers.add(onEvent);
    this.#client = new JsonRpcClient({
      write,
      onNotification: (event) => this.#emitEvent(event),
    });
  }

  async initialize() {
    const result = await this.#client.request("initialize", {
      clientInfo: this.#clientInfo,
    });
    this.#client.notify("initialized", {});
    return result;
  }

  startThread({ model } = {}) {
    const params = {};
    if (model) {
      params.model = model;
    }

    return this.#client.request("thread/start", params);
  }

  startTurn({ threadId, text, cwd, developerInstructions = null }) {
    const params = {
      threadId,
      input: [{ type: "text", text }],
    };

    if (cwd) {
      params.cwd = cwd;
    }
    if (developerInstructions) {
      params.developer_instructions = developerInstructions;
    }

    return this.#client.request("turn/start", params);
  }

  interruptTurn({ threadId, turnId }) {
    return this.#client.request("turn/interrupt", { threadId, turnId });
  }

  handleMessage(message) {
    this.#client.handleMessage(message);
  }

  onEvent(handler) {
    this.#eventHandlers.add(handler);
    return () => {
      this.#eventHandlers.delete(handler);
    };
  }

  #emitEvent(event) {
    for (const handler of this.#eventHandlers) {
      handler(event);
    }
  }
}
