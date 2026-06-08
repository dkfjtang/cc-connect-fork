import { JsonRpcClient } from "./json-rpc-client.js";

const DEFAULT_CLIENT_INFO = {
  name: "feishu_codex_bridge",
  title: "Feishu Codex Bridge",
  version: "0.1.0",
};

export class AppServerSession {
  #client;
  #clientInfo;

  constructor({ write, onEvent = () => {}, clientInfo = DEFAULT_CLIENT_INFO }) {
    this.#clientInfo = clientInfo;
    this.#client = new JsonRpcClient({
      write,
      onNotification: onEvent,
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

  startTurn({ threadId, text, cwd }) {
    const params = {
      threadId,
      input: [{ type: "text", text }],
    };

    if (cwd) {
      params.cwd = cwd;
    }

    return this.#client.request("turn/start", params);
  }

  handleMessage(message) {
    this.#client.handleMessage(message);
  }
}
