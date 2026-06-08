const DEFAULT_SUMMARY_LIMIT = 500;
const EMPTY_SUMMARY = "Codex 正在处理...";

export class TurnOutputBuffer {
  #chunks = [];
  #summaryLimit;

  constructor({ summaryLimit = DEFAULT_SUMMARY_LIMIT } = {}) {
    this.#summaryLimit = summaryLimit;
  }

  appendDelta(delta) {
    if (typeof delta !== "string" || delta.length === 0) {
      return;
    }

    this.#chunks.push(delta);
  }

  finalText() {
    return this.#chunks.join("");
  }

  summaryText() {
    const text = this.finalText();
    if (!text) {
      return EMPTY_SUMMARY;
    }

    if (text.length <= this.#summaryLimit) {
      return text;
    }

    return `${text.slice(0, this.#summaryLimit)}...`;
  }
}
