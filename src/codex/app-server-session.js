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
  #requestHandler;

  constructor({ write, onEvent = () => {}, onRequest = null, clientInfo = DEFAULT_CLIENT_INFO }) {
    this.#clientInfo = clientInfo;
    this.#eventHandlers.add(onEvent);
    this.#requestHandler = onRequest ?? defaultServerRequestHandler;
    this.#client = new JsonRpcClient({
      write,
      onNotification: (event) => this.#emitEvent(event),
      onRequest: (request) => this.#handleServerRequest(request),
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

  onRequest(handler) {
    this.#requestHandler = handler;
    return () => {
      if (this.#requestHandler === handler) {
        this.#requestHandler = defaultServerRequestHandler;
      }
    };
  }

  async #handleServerRequest(request) {
    this.#emitEvent({
      method: request.method,
      params: request.params,
      requestId: request.id,
      serverRequest: true,
    });

    return this.#requestHandler(request);
  }

  #emitEvent(event) {
    for (const handler of this.#eventHandlers) {
      handler(event);
    }
  }
}

function defaultServerRequestHandler(request) {
  if (isApprovalRequest(request.method)) {
    return { decision: "decline" };
  }

  throw new Error(`Unsupported server request: ${request.method}`);
}

function isApprovalRequest(method) {
  return [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "applyPatchApproval",
    "execCommandApproval",
  ].includes(method);
}
