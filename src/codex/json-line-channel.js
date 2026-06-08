export class JsonLineChannel {
  #output;
  #onMessage;
  #onError;
  #buffer = "";

  constructor({ input, output, onMessage, onError = () => {} }) {
    this.#output = output;
    this.#onMessage = onMessage;
    this.#onError = onError;

    input.on("data", (chunk) => {
      this.#handleChunk(chunk.toString("utf8"));
    });
  }

  write(message) {
    this.#output.write(`${JSON.stringify(message)}\n`);
  }

  #handleChunk(chunk) {
    this.#buffer += chunk;

    while (this.#buffer.includes("\n")) {
      const newlineIndex = this.#buffer.indexOf("\n");
      const line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      this.#handleLine(line);
    }
  }

  #handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      this.#onMessage(JSON.parse(trimmed));
    } catch (cause) {
      const error = new Error("Invalid JSON line from app-server", { cause });
      error.line = trimmed;
      this.#onError(error);
    }
  }
}
