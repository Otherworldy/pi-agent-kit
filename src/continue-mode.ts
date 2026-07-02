export const CONTINUE_TRIGGER_CUSTOM_TYPE = "pi-agent-kit.continue";
export const CONTINUE_TRIGGER_CONTENT = "pi-agent-kit internal continue trigger";

export interface ContinueTriggerDetails {
  requestId: string;
  failureFingerprint: string;
}

export interface ContinueFailureSnapshot {
  fingerprint: string;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  recordedAt: number;
}

export interface ContinueContextFilterResult {
  messages: unknown[];
  removedFailure: boolean;
  removedTrigger: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function messageRole(message: unknown): string | undefined {
  return isRecord(message) ? stringValue(message.role) : undefined;
}

function messageStopReason(message: unknown): string | undefined {
  return isRecord(message) ? stringValue(message.stopReason) : undefined;
}

function messageError(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const errorMessage = stringValue(message.errorMessage)?.trim();
  return errorMessage || undefined;
}

function messageTimestamp(message: unknown): number | undefined {
  return isRecord(message) ? numberValue(message.timestamp) : undefined;
}

function contentSignature(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentSignature).join("|");
  if (!isRecord(content)) return "";
  const type = stringValue(content.type) ?? "";
  const text = stringValue(content.text) ?? "";
  const name = stringValue(content.name) ?? stringValue(content.toolName) ?? "";
  const id = stringValue(content.id) ?? stringValue(content.toolCallId) ?? "";
  const nested = content.content === content ? "" : contentSignature(content.content);
  return [type, name, id, text, nested].filter(Boolean).join(":");
}

export function isContinuableAssistantError(message: unknown): boolean {
  if (messageRole(message) !== "assistant") return false;

  const stopReason = messageStopReason(message);
  if (stopReason === "aborted") return false;
  if (stopReason === "error") return true;
  if (messageError(message)) return true;
  return Boolean(stopReason && stopReason !== "stop" && stopReason !== "toolUse");
}

export function assistantErrorFingerprint(message: unknown): string {
  const content = isRecord(message) ? message.content : undefined;
  return [
    messageTimestamp(message) ?? "",
    messageStopReason(message) ?? "",
    messageError(message) ?? "",
    contentSignature(content).slice(0, 500),
  ].join("\u001f");
}

export function findLastContinuableAssistantError(messages: readonly unknown[] | undefined): unknown | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (messageRole(message) === "assistant") {
      return isContinuableAssistantError(message) ? message : undefined;
    }
  }
  return undefined;
}

export function createContinueFailureSnapshot(message: unknown, now = Date.now()): ContinueFailureSnapshot | undefined {
  if (!isContinuableAssistantError(message)) return undefined;
  return {
    fingerprint: assistantErrorFingerprint(message),
    stopReason: messageStopReason(message),
    errorMessage: messageError(message),
    timestamp: messageTimestamp(message),
    recordedAt: now,
  };
}

export function createContinueRequestId(now = Date.now(), random = Math.random()): string {
  return `${now.toString(36)}-${random.toString(36).slice(2, 8)}`;
}

export function createContinueTriggerMessage(requestId: string, failureFingerprint: string) {
  return {
    customType: CONTINUE_TRIGGER_CUSTOM_TYPE,
    content: CONTINUE_TRIGGER_CONTENT,
    display: false,
    details: { requestId, failureFingerprint } satisfies ContinueTriggerDetails,
  };
}

export function isContinueTriggerMessage(message: unknown, requestId?: string): boolean {
  if (!isRecord(message)) return false;
  if (messageRole(message) !== "custom") return false;
  if (message.customType !== CONTINUE_TRIGGER_CUSTOM_TYPE) return false;
  if (!requestId) return true;
  const details = message.details;
  return isRecord(details) && details.requestId === requestId;
}

export function filterContinueContext(
  messages: readonly unknown[],
  request: { requestId: string; failureFingerprint: string },
): ContinueContextFilterResult {
  let failureIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (isContinuableAssistantError(message) && assistantErrorFingerprint(message) === request.failureFingerprint) {
      failureIndex = index;
      break;
    }
  }

  let removedTrigger = false;
  const filtered = messages.filter((message, index) => {
    if (index === failureIndex) return false;
    if (isContinueTriggerMessage(message, request.requestId)) {
      removedTrigger = true;
      return false;
    }
    return true;
  });

  return {
    messages: filtered,
    removedFailure: failureIndex !== -1,
    removedTrigger,
  };
}
