import { TurnOutputBuffer } from "../codex/turn-output-buffer.js";

export class RuntimeTask {
  #taskId;
  #feishuMessageId;
  #feishuOpenId;
  #feishuChatId;
  #feishuChatType;
  #cardMessageId = null;
  #cardChannel = null;
  #cardId = null;
  #cardSequence = null;
  #threadId = null;
  #turnId = null;
  #cwd;
  #model;
  #appVersion;
  #now;
  #startedAt;
  #completedAt = null;
  #status = "queued";
  #errorSummary = null;
  #errorType = null;
  #tokenUsage = null;
  #currentStage = null;
  #lastStage = null;
  #approval = null;
  #output;

  constructor({
    taskId,
    feishuMessageId = null,
    feishuOpenId = null,
    feishuChatId = null,
    feishuChatType = null,
    cwd = null,
    model = null,
    appVersion = null,
    now = () => Date.now(),
    summaryLimit,
  }) {
    this.#taskId = taskId;
    this.#feishuMessageId = feishuMessageId;
    this.#feishuOpenId = feishuOpenId;
    this.#feishuChatId = feishuChatId;
    this.#feishuChatType = feishuChatType;
    this.#cwd = cwd;
    this.#model = model;
    this.#appVersion = appVersion;
    this.#now = now;
    this.#startedAt = this.#now();
    this.#output = new TurnOutputBuffer({ summaryLimit });
  }

  attachThread(threadId) {
    this.#threadId = threadId;
  }

  attachCard(cardMessageId, metadata = {}) {
    this.#cardMessageId = cardMessageId ?? this.#cardMessageId;
    this.#cardChannel = hasOwn(metadata, "cardChannel")
      ? metadata.cardChannel
      : this.#cardChannel ?? "im";
    this.#cardId = hasOwn(metadata, "cardId") ? metadata.cardId : this.#cardId;
    this.#cardSequence = hasOwn(metadata, "cardSequence")
      ? metadata.cardSequence
      : this.#cardSequence;
  }

  cancel(reason = "任务已取消") {
    this.#status = "cancelled";
    this.#errorSummary = reason;
    this.#errorType = "cancelled";
    this.#completedAt = this.#now();
  }

  fail(reason = "任务失败", type = "failed") {
    if (this.#status === "completed" || this.#status === "cancelled") {
      return;
    }

    this.#status = "failed";
    this.#errorSummary = reason;
    this.#errorType = type;
    this.#completedAt = this.#now();
  }

  resolveApproval(decision) {
    if (!this.#approval || this.#approval.status !== "pending") {
      return;
    }

    this.#approval = {
      ...this.#approval,
      status: approvalDecisionStatus(decision),
      summary: approvalDecisionSummary(decision),
    };

    if (decision === "accept" || decision === "acceptForSession") {
      this.#status = "running";
    }
  }

  showApprovalDetails() {
    if (!this.#approval || this.#approval.status !== "pending") {
      return false;
    }

    this.#approval = {
      ...this.#approval,
      detailExpanded: true,
    };
    return true;
  }

  handleCodexEvent(event) {
    if (this.#status === "cancelled") {
      return;
    }

    switch (event.method) {
      case "turn/started":
        this.#turnId = event.params?.turn?.id ?? this.#turnId;
        if (this.#status === "queued") {
          this.#status = "running";
        }
        break;
      case "item/started":
        this.#handleItemStarted(event.params);
        break;
      case "item/agentMessage/delta":
        this.#output.appendDelta(event.params?.delta);
        break;
      case "item/completed":
        this.#handleItemCompleted(event.params);
        break;
      case "turn/completed":
        this.#handleTurnCompleted(event.params);
        break;
      case "thread/tokenUsage/updated":
        this.#handleTokenUsageUpdated(event.params);
        break;
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      case "item/permissions/requestApproval":
      case "applyPatchApproval":
      case "execCommandApproval":
        this.#handleApprovalRequest(event);
        break;
      default:
        break;
    }
  }

  snapshot() {
    return {
      taskId: this.#taskId,
      feishuMessageId: this.#feishuMessageId,
      feishuOpenId: this.#feishuOpenId,
      feishuChatId: this.#feishuChatId,
      feishuChatType: this.#feishuChatType,
      cardMessageId: this.#cardMessageId,
      cardChannel: this.#cardChannel,
      cardId: this.#cardId,
      cardSequence: this.#cardSequence,
      threadId: this.#threadId,
      turnId: this.#turnId,
      cwd: this.#cwd,
      model: this.#model,
      appVersion: this.#appVersion,
      status: this.#status,
      startedAt: this.#startedAt,
      completedAt: this.#completedAt,
      elapsedMs: this.#elapsedMs(),
      summaryText: this.#output.summaryText(),
      finalText: this.#output.finalText(),
      errorSummary: this.#errorSummary,
      errorType: this.#errorType,
      tokenUsage: this.#tokenUsage,
      currentStage: this.#currentStage,
      lastStage: this.#lastStage,
      approval: this.#approval,
    };
  }

  #handleApprovalRequest(event) {
    const params = event.params ?? {};
    this.#status = "waiting_approval";
    if (params.threadId || params.conversationId) {
      this.#threadId = params.threadId ?? params.conversationId;
    }
    if (params.turnId) {
      this.#turnId = params.turnId;
    }

    const risk = approvalRisk(event.method, params);
    const riskReasons = approvalRiskReasons(event.method, params);

    this.#approval = {
      requestId: event.requestId ?? null,
      method: event.method,
      approvalId: params.approvalId ?? params.callId ?? params.itemId ?? null,
      itemId: params.itemId ?? params.callId ?? null,
      type: approvalType(event.method),
      status: "pending",
      summary: approvalSummary(event.method),
      risk,
      riskReasons,
      details: approvalDetails(event.method, params, risk, riskReasons),
    };
  }

  #handleItemStarted(params = {}) {
    if (params.threadId) {
      this.#threadId = params.threadId;
    }
    if (params.turnId) {
      this.#turnId = params.turnId;
    }
    if (this.#status === "queued") {
      this.#status = "running";
    }

    this.#currentStage = stageFromItem(params.item, "running");
  }

  #handleItemCompleted(params = {}) {
    if (params.threadId) {
      this.#threadId = params.threadId;
    }
    if (params.turnId) {
      this.#turnId = params.turnId;
    }

    const completedStage = stageFromItem(params.item, "completed");
    this.#lastStage = completedStage;
    if (!this.#currentStage || this.#currentStage.id === completedStage.id) {
      this.#currentStage = null;
    }
  }

  #handleTokenUsageUpdated(params = {}) {
    if (params.threadId) {
      this.#threadId = params.threadId;
    }
    if (params.turnId) {
      this.#turnId = params.turnId;
    }
    if (params.tokenUsage) {
      this.#tokenUsage = params.tokenUsage;
    }
  }

  #handleTurnCompleted(params = {}) {
    this.#completedAt = this.#now();
    if (params.status === "failed" || params.error) {
      this.#status = "failed";
      this.#errorSummary = params.error?.message ?? "Codex turn failed";
      this.#errorType = params.error?.type ?? params.status ?? "failed";
      return;
    }

    this.#status = "completed";
  }

  #elapsedMs() {
    return (this.#completedAt ?? this.#now()) - this.#startedAt;
  }
}

function stageFromItem(item = {}, status) {
  return {
    id: item.id ?? null,
    type: item.type ?? "unknown",
    status: item.status ?? status,
    label: stageLabel(item),
  };
}

function approvalType(method) {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return "command";
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return "file_change";
    case "item/permissions/requestApproval":
      return "permissions";
    default:
      return "approval";
  }
}

function approvalSummary(method) {
  switch (approvalType(method)) {
    case "command":
      return "Codex 请求执行命令，需要审批。";
    case "file_change":
      return "Codex 请求修改文件，需要审批。";
    case "permissions":
      return "Codex 请求额外权限，需要审批。";
    default:
      return "Codex 请求审批。";
  }
}

function approvalRisk(method, params = {}) {
  if (approvalType(method) === "permissions") {
    return "高";
  }
  if (approvalType(method) === "file_change") {
    return "高";
  }
  if (params.networkApprovalContext || params.proposedNetworkPolicyAmendments?.length > 0) {
    return "高";
  }
  return "中";
}

function approvalRiskReasons(method, params = {}) {
  const type = approvalType(method);
  const reasons = [];

  if (type === "command") {
    reasons.push("命令审批");
  }

  if (type === "file_change") {
    reasons.push("文件变更");
    if (fileChangesIncludeDelete(params.fileChanges)) {
      reasons.push("删除文件");
    }
  }

  if (type === "permissions") {
    reasons.push("权限变更");
    const fileSystem = params.permissions?.fileSystem ?? {};
    if (Array.isArray(fileSystem.write) && fileSystem.write.length > 0) {
      reasons.push("文件写入");
    }
    if (params.permissions?.network?.enabled === true) {
      reasons.push("网络开启");
    }
  }

  if (params.networkApprovalContext || params.proposedNetworkPolicyAmendments?.length > 0) {
    reasons.push("网络访问");
  }

  if (params.reason) {
    reasons.push("包含说明");
  }

  return unique(reasons);
}

function approvalDetails(method, params = {}, risk = approvalRisk(method, params), riskReasons = approvalRiskReasons(method, params)) {
  return [
    riskDetail(risk),
    riskReasonDetail(riskReasons),
    projectDetail(params.cwd ?? params.grantRoot),
    commandActionDetail(params.commandActions ?? params.parsedCmd),
    fileChangeDetail(params.fileChanges),
    permissionDetail(params.permissions),
    networkDetail(params),
    params.reason ? "包含说明: 是" : null,
  ].filter(Boolean);
}

function riskDetail(risk) {
  return `风险: ${risk}`;
}

function riskReasonDetail(reasons) {
  return Array.isArray(reasons) && reasons.length > 0 ? `风险因素: ${reasons.join(" / ")}` : null;
}

function projectDetail(path) {
  const name = safeBasename(path);
  return name ? `目录: ${name}` : null;
}

function commandActionDetail(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return null;
  }

  const counts = countBy(
    actions.map((action) => normalizeActionType(action?.type)).filter(Boolean),
  );
  const parts = Object.entries(counts).map(([type, count]) => `${type} ${count}`);
  return parts.length > 0 ? `命令动作: ${parts.join(" / ")}` : `命令动作: ${actions.length} 个`;
}

function normalizeActionType(type) {
  switch (type) {
    case "read":
      return "读取";
    case "listFiles":
    case "list_files":
      return "列目录";
    case "search":
      return "搜索";
    case "unknown":
      return "未知";
    default:
      return null;
  }
}

function fileChangeDetail(fileChanges) {
  if (!fileChanges || typeof fileChanges !== "object") {
    return null;
  }

  const entries = Object.entries(fileChanges);
  if (entries.length === 0) {
    return null;
  }

  const typeCounts = countBy(entries.map(([, change]) => change?.type ?? "unknown"));
  const typeText = Object.entries(typeCounts)
    .map(([type, count]) => `${fileChangeTypeLabel(type)} ${count}`)
    .join(" / ");
  const extensions = unique(
    entries.map(([path]) => safeExtension(path)).filter(Boolean),
  ).slice(0, 4);
  const extensionText = extensions.length > 0 ? `, 扩展名: ${extensions.join(", ")}` : "";
  return `文件变更: ${entries.length} 个 (${typeText})${extensionText}`;
}

function fileChangeTypeLabel(type) {
  switch (type) {
    case "add":
      return "新增";
    case "update":
      return "修改";
    case "delete":
      return "删除";
    default:
      return "未知";
  }
}

function fileChangesIncludeDelete(fileChanges) {
  if (!fileChanges || typeof fileChanges !== "object") {
    return false;
  }

  return Object.values(fileChanges).some((change) => change?.type === "delete");
}

function permissionDetail(permissions) {
  if (!permissions || typeof permissions !== "object") {
    return null;
  }

  const fileSystem = permissions.fileSystem ?? {};
  const readCount = Array.isArray(fileSystem.read) ? fileSystem.read.length : 0;
  const writeCount = Array.isArray(fileSystem.write) ? fileSystem.write.length : 0;
  const entryCount = Array.isArray(fileSystem.entries) ? fileSystem.entries.length : 0;
  const networkEnabled = permissions.network?.enabled === true;
  const parts = [];
  if (readCount > 0) {
    parts.push(`读 ${readCount}`);
  }
  if (writeCount > 0) {
    parts.push(`写 ${writeCount}`);
  }
  if (entryCount > 0) {
    parts.push(`规则 ${entryCount}`);
  }
  if (networkEnabled) {
    parts.push("网络开启");
  }

  return parts.length > 0 ? `权限: ${parts.join(" / ")}` : "权限: 请求变更";
}

function networkDetail(params = {}) {
  const hosts = [];
  if (params.networkApprovalContext?.host) {
    hosts.push(params.networkApprovalContext.host);
  }
  for (const amendment of params.proposedNetworkPolicyAmendments ?? []) {
    if (amendment?.host) {
      hosts.push(amendment.host);
    }
  }

  const safeHosts = unique(hosts.map(safeHost).filter(Boolean)).slice(0, 3);
  if (safeHosts.length === 0) {
    return null;
  }

  return `网络目标: ${safeHosts.join(", ")}`;
}

function safeHost(host) {
  if (typeof host !== "string") {
    return null;
  }
  const trimmed = host.trim();
  if (!/^[a-z0-9.-]+$/i.test(trimmed)) {
    return null;
  }
  return trimmed.slice(0, 80);
}

function safeBasename(path) {
  if (typeof path !== "string" || !path.trim()) {
    return null;
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const value = parts.at(-1);
  return safeToken(value);
}

function safeExtension(path) {
  const basename = safeBasename(path);
  if (!basename) {
    return null;
  }
  const index = basename.lastIndexOf(".");
  if (index <= 0 || index === basename.length - 1) {
    return null;
  }
  return safeToken(basename.slice(index));
}

function safeToken(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[\w.-]{1,40}$/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function unique(values) {
  return [...new Set(values)];
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function approvalDecisionStatus(decision) {
  switch (decision) {
    case "accept":
      return "accepted";
    case "acceptForSession":
      return "accepted_for_session";
    case "decline":
      return "declined";
    case "cancel":
      return "cancelled";
    default:
      return "resolved";
  }
}

function approvalDecisionSummary(decision) {
  switch (decision) {
    case "accept":
      return "已允许本次操作，等待 Codex 继续执行。";
    case "acceptForSession":
      return "已允许本会话同类操作，等待 Codex 继续执行。";
    case "decline":
      return "已拒绝本次操作，等待 Codex 收尾。";
    case "cancel":
      return "已停止本次操作，等待 Codex 收尾。";
    default:
      return "审批已处理，等待 Codex 继续。";
  }
}

function stageLabel(item = {}) {
  switch (item.type) {
    case "agentMessage":
      return "生成回复";
    case "plan":
      return "更新计划";
    case "reasoning":
      return "推理分析";
    case "commandExecution":
      return "执行命令";
    case "fileChange":
      return "处理文件变更";
    case "mcpToolCall":
      return item.tool ? `调用 MCP 工具 ${item.tool}` : "调用 MCP 工具";
    case "dynamicToolCall":
      return item.tool ? `调用工具 ${item.tool}` : "调用工具";
    case "webSearch":
      return "检索网页";
    case "imageView":
      return "查看图片";
    case "imageGeneration":
      return "生成图片";
    case "contextCompaction":
      return "压缩上下文";
    case "collabAgentToolCall":
      return "协作智能体任务";
    case "userMessage":
    case "hookPrompt":
      return "读取输入";
    default:
      return "处理阶段";
  }
}
