export class JsonRpcClient {
  #nextId = 1;
  #pending = new Map();
  #write;
  #onNotification;

  constructor({ write, onNotification = () => {} }) {
    if (typeof write !== "function") {
      throw new TypeError("JsonRpcClient requires a write function");
    }

    this.#write = write;
    this.#onNotification = onNotification;
  }

  request(method, params = {}) {
    const id = this.#nextId++;
    const message = { id, method, params };

    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });

    this.#write(message);
    return promise;
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  handleMessage(message) {
    if (Object.hasOwn(message, "id")) {
      this.#handleResponse(message);
      return;
    }

    if (typeof message.method === "string") {
      this.#onNotification(message);
    }
  }

  #handleResponse(message) {
    const pending = this.#pending.get(message.id);
    if (!pending) {
      return;
    }

    this.#pending.delete(message.id);

    if (message.error) {
      pending.reject(new JsonRpcError(message.error));
      return;
    }

    pending.resolve(message.result);
  }
}

export class JsonRpcError extends Error {
  constructor(error) {
    super(error?.message ?? "JSON-RPC request failed");
    this.name = "JsonRpcError";
    this.code = error?.code;
    this.data = error?.data;
  }
}
