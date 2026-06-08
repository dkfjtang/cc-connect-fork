const BODY_LIMIT = 1000;

const STATUS_META = {
  queued: { title: "任务已接收", template: "blue" },
  running: { title: "Codex 执行中", template: "wathet" },
  waiting_approval: { title: "需要确认", template: "orange" },
  completed: { title: "已完成", template: "green" },
  failed: { title: "执行失败", template: "red" },
  cancelled: { title: "已取消", template: "grey" },
};

export function renderTaskCard(snapshot) {
  const meta = STATUS_META[snapshot.status] ?? STATUS_META.running;

  return {
    config: {
      update_multi: true,
    },
    header: {
      template: meta.template,
      title: {
        tag: "plain_text",
        content: meta.title,
      },
    },
    elements: [
      {
        tag: "markdown",
        text: {
          tag: "lark_md",
          content: cardBody(snapshot),
        },
      },
      {
        tag: "hr",
      },
      {
        tag: "note",
        elements: [
          {
            tag: "lark_md",
            content: footerText(snapshot),
          },
        ],
      },
    ],
  };
}

function cardBody(snapshot) {
  if (snapshot.status === "failed") {
    return truncate(snapshot.errorSummary || "Codex turn failed", BODY_LIMIT);
  }

  if (snapshot.status === "completed") {
    return truncate(snapshot.finalText || snapshot.summaryText, BODY_LIMIT);
  }

  return truncate(snapshot.summaryText, BODY_LIMIT);
}

function footerText(snapshot) {
  return [
    `状态: ${snapshot.status}`,
    snapshot.threadId ? `thread: ${shortId(snapshot.threadId)}` : null,
    snapshot.turnId ? `turn: ${shortId(snapshot.turnId)}` : null,
    typeof snapshot.elapsedMs === "number" ? `耗时: ${formatElapsed(snapshot.elapsedMs)}` : null,
    snapshot.model ? `model: ${snapshot.model}` : null,
    snapshot.appVersion ? `fca: ${snapshot.appVersion}` : null,
    snapshot.errorType ? `错误: ${snapshot.errorType}` : null,
    snapshot.cwd ? `cwd: ${snapshot.cwd}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function shortId(value) {
  return value.slice(0, 8);
}

function formatElapsed(elapsedMs) {
  const seconds = Math.max(elapsedMs, 0) / 1000;
  if (seconds < 60) {
    return `${Number(seconds.toFixed(1))}s`;
  }

  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function truncate(value, limit) {
  const text = value || "";
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}...`;
}
