import { randomUUID } from "node:crypto";

import type { CodexCompatConfig, ProviderCompatConfig } from "./config.ts";

export interface ProviderCompatModelLike {
  id?: string;
  provider?: string;
  api?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeSelector(selector: string): string {
  return selector.trim();
}

export function getCompatModelKey(model: ProviderCompatModelLike | null | undefined): string | null {
  if (!model?.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

function normalizedModelText(model: ProviderCompatModelLike | null | undefined): string {
  return [model?.provider, model?.id, model?.api]
    .filter((value): value is string => typeof value === "string")
    .join("/")
    .toLowerCase();
}

function isClaudeLikeModel(model: ProviderCompatModelLike | null | undefined): boolean {
  const text = normalizedModelText(model);
  return model?.api === "anthropic-messages" || text.includes("claude") || text.includes("anthropic");
}

function isCodexLikeModel(model: ProviderCompatModelLike | null | undefined): boolean {
  if (isClaudeLikeModel(model)) return false;
  if (model?.api === "openai-codex-responses" || model?.api === "openai-completions") return true;
  const text = normalizedModelText(model);
  if (text.includes("codex")) return true;
  if (model?.api === "openai-responses") return true;
  return /(^|\/)gpt[-_]/.test(text) || /(^|\/)o[1-9]($|[-_])/.test(text);
}

export function matchesCompatModelSelector(
  model: ProviderCompatModelLike | null | undefined,
  selector: string,
): boolean {
  const normalized = normalizeSelector(selector);
  if (!normalized) return false;
  if (normalized === "*") return true;

  const key = getCompatModelKey(model);
  if (!model?.id || !key) return false;
  if (normalized === key || normalized === model.id) return true;

  const slashIndex = normalized.indexOf("/");
  if (slashIndex === -1) return false;

  const providerPattern = normalized.slice(0, slashIndex);
  const modelPattern = normalized.slice(slashIndex + 1);
  const providerMatches = providerPattern === "*" || providerPattern === model.provider;
  const modelMatches = modelPattern === "*" || modelPattern === model.id;
  return providerMatches && modelMatches;
}

export function supportsProviderCompat(
  model: ProviderCompatModelLike | null | undefined,
  config: ProviderCompatConfig,
): boolean {
  if (!config.enabled || !model?.id) return false;
  if (config.supportedModels.length > 0) {
    return config.supportedModels.some((selector) => matchesCompatModelSelector(model, selector));
  }
  if (config.providers.length > 0) {
    return !!model.provider && config.providers.includes(model.provider);
  }
  return true;
}

export function supportsClaudeCodeCompat(
  model: ProviderCompatModelLike | null | undefined,
  config: ProviderCompatConfig,
): boolean {
  return supportsProviderCompat(model, config) && isClaudeLikeModel(model);
}

export function supportsCodexCompat(
  model: ProviderCompatModelLike | null | undefined,
  config: CodexCompatConfig,
): boolean {
  return supportsProviderCompat(model, config) && isCodexLikeModel(model);
}

export function getProviderCompatProviderNames<TConfig extends ProviderCompatConfig>(
  config: TConfig,
  model: ProviderCompatModelLike | null | undefined,
  supportsCompat: (model: ProviderCompatModelLike | null | undefined, config: TConfig) => boolean = supportsProviderCompat,
): string[] {
  if (!config.enabled) return [];

  const providers = new Set<string>();
  for (const provider of config.providers) {
    const trimmed = provider.trim();
    if (trimmed) providers.add(trimmed);
  }

  for (const selector of config.supportedModels) {
    const normalized = normalizeSelector(selector);
    const slashIndex = normalized.indexOf("/");
    if (slashIndex > 0) {
      const provider = normalized.slice(0, slashIndex);
      if (provider && provider !== "*") providers.add(provider);
    }
  }

  if (supportsCompat(model, config) && model?.provider) {
    providers.add(model.provider);
  }

  return [...providers];
}

export function getClaudeCodeCompatProviderNames(
  config: ProviderCompatConfig,
  model: ProviderCompatModelLike | null | undefined,
): string[] {
  return getProviderCompatProviderNames(config, model, supportsClaudeCodeCompat);
}

export function getCodexCompatProviderNames(
  config: CodexCompatConfig,
  model: ProviderCompatModelLike | null | undefined,
): string[] {
  return getProviderCompatProviderNames(config, model, supportsCodexCompat);
}

function textContentIncludes(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (typeof entry === "string") return entry.includes(needle);
    if (!isRecord(entry)) return false;
    return typeof entry.text === "string" && entry.text.includes(needle);
  });
}

function systemIncludesIdentity(system: unknown, systemText: string): boolean {
  if (typeof system === "string") return system.includes(systemText);
  if (!Array.isArray(system)) return false;
  return system.some((entry) => {
    if (typeof entry === "string") return entry.includes(systemText);
    if (!isRecord(entry)) return false;
    return typeof entry.text === "string" && entry.text.includes(systemText);
  });
}

function withNativeAnthropicSystemIdentity(
  payload: Record<string, unknown>,
  systemText: string,
): Record<string, unknown> | undefined {
  if (systemIncludesIdentity(payload.system, systemText)) return undefined;

  const identityBlock = { type: "text", text: systemText };
  const existingSystem = payload.system;
  if (Array.isArray(existingSystem)) {
    return { ...payload, system: [identityBlock, ...existingSystem] };
  }
  if (typeof existingSystem === "string" && existingSystem.length > 0) {
    return { ...payload, system: [identityBlock, { type: "text", text: existingSystem }] };
  }
  return { ...payload, system: [identityBlock] };
}

function withOpenAIMessagesSystemIdentity(
  payload: Record<string, unknown>,
  key: "messages" | "input",
  systemText: string,
): Record<string, unknown> | undefined {
  const messages = payload[key];
  if (!Array.isArray(messages)) return undefined;

  const alreadyPresent = messages.some((message) => {
    if (!isRecord(message)) return false;
    const role = message.role;
    if (role !== "system" && role !== "developer") return false;
    return textContentIncludes(message.content, systemText);
  });
  if (alreadyPresent) return undefined;

  return {
    ...payload,
    [key]: [{ role: "system", content: systemText }, ...messages],
  };
}

/** Simulated device_id (64-hex) for Claude Code metadata.user_id JSON format. */
const DEFAULT_CLAUDE_DEVICE_ID = "b7e2f1a94c0d8e5f6a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef";

/** Build metadata.user_id accepted by sub2api ParseMetadataUserID (JSON format for modern CLI). */
export function buildClaudeMetadataUserId(sessionId: string, override = ""): string {
  const trimmed = override.trim();
  if (trimmed) return trimmed;
  const deviceId = process.env.PI_CLAUDE_CODE_COMPAT_DEVICE_ID || DEFAULT_CLAUDE_DEVICE_ID;
  return JSON.stringify({
    device_id: deviceId,
    account_uuid: "",
    session_id: sessionId || randomUUID(),
  });
}

function withMetadataUserId(
  payload: Record<string, unknown>,
  metadataUserId: string,
): Record<string, unknown> | undefined {
  if (!metadataUserId) return undefined;
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  if (metadata.user_id === metadataUserId) return undefined;
  return {
    ...payload,
    metadata: {
      ...metadata,
      user_id: metadataUserId,
    },
  };
}

export function patchClaudeCodeCompatPayload(
  payload: unknown,
  options: {
    config: ProviderCompatConfig;
    model: ProviderCompatModelLike | null | undefined;
    sessionId?: string;
  },
): unknown | undefined {
  const { config, model } = options;
  if (!supportsClaudeCodeCompat(model, config) || !isRecord(payload)) return undefined;

  let nextPayload: Record<string, unknown> = payload;
  let changed = false;

  const metadataUserId = buildClaudeMetadataUserId(
    options.sessionId || "",
    config.metadataUserId,
  );
  const withMetadata = withMetadataUserId(nextPayload, metadataUserId);
  if (withMetadata) {
    nextPayload = withMetadata;
    changed = true;
  }

  if (config.systemIdentity) {
    const systemText = config.systemText.trim();
    if (systemText) {
      const withSystem = model?.api === "anthropic-messages" || hasOwn(nextPayload, "system")
        ? withNativeAnthropicSystemIdentity(nextPayload, systemText)
        : hasOwn(nextPayload, "messages")
          ? withOpenAIMessagesSystemIdentity(nextPayload, "messages", systemText)
          : withOpenAIMessagesSystemIdentity(nextPayload, "input", systemText);
      if (withSystem) {
        nextPayload = withSystem;
        changed = true;
      }
    }
  }

  return changed ? nextPayload : undefined;
}

/**
 * Build Claude Code CLI request headers the way client.ts + Anthropic SDK do.
 * Fills `X-Claude-Code-Session-Id` from Pi's session when not overridden.
 */
function withClaudeCodeHeaders(
  headers: Record<string, string>,
  sessionId: string,
): Record<string, string> {
  const nextHeaders = { ...headers };
  if (!hasHeader(nextHeaders, "X-Claude-Code-Session-Id", "x-claude-code-session-id")) {
    setHeaderAliases(nextHeaders, sessionId, "X-Claude-Code-Session-Id", "x-claude-code-session-id");
  }
  return nextHeaders;
}

export function getClaudeCodeCompatHeaders(
  config: ProviderCompatConfig,
  sessionId: string,
): Record<string, string> {
  return withClaudeCodeHeaders(config.headers, sessionId);
}

function isOpenAIResponsesPayload(payload: Record<string, unknown>, model: ProviderCompatModelLike | null | undefined): boolean {
  return model?.api === "openai-responses"
    || model?.api === "openai-codex-responses"
    || hasOwn(payload, "input")
    || hasOwn(payload, "instructions");
}

function getCodexPromptCacheKey(
  payload: Record<string, unknown> | undefined,
  sessionId: string,
): string {
  const existing = payload?.prompt_cache_key;
  return (typeof existing === "string" ? existing.trim() : "") || sessionId;
}

function hasHeader(headers: Record<string, string>, ...names: string[]): boolean {
  return names.some((name) => {
    const value = headers[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function setHeaderAliases(headers: Record<string, string>, value: string, ...names: string[]): void {
  for (const name of names) headers[name] = value;
}

/**
 * Build Codex CLI request headers the way openai/codex does:
 * - default client: originator + User-Agent
 * - responses session: session-id, thread-id, x-client-request-id
 * - compatibility: x-codex-window-id, x-codex-turn-metadata, x-codex-beta-features
 * Also keeps Session_id / Thread_id aliases for older new-api pass_headers templates.
 */
function withCodexHeaders(
  headers: Record<string, string>,
  sessionId: string,
  model: ProviderCompatModelLike | null | undefined,
): Record<string, string> {
  const nextHeaders = { ...headers };
  const windowId = `${sessionId}:0`;

  if (!hasHeader(nextHeaders, "session-id", "Session-Id", "Session_id")) {
    setHeaderAliases(nextHeaders, sessionId, "session-id", "Session-Id", "Session_id");
  }
  if (!hasHeader(nextHeaders, "thread-id", "Thread-Id", "Thread_id")) {
    setHeaderAliases(nextHeaders, sessionId, "thread-id", "Thread-Id", "Thread_id");
  }
  if (!hasHeader(nextHeaders, "x-client-request-id", "X-Client-Request-Id")) {
    setHeaderAliases(nextHeaders, sessionId, "x-client-request-id", "X-Client-Request-Id");
  }
  if (!hasHeader(nextHeaders, "x-codex-window-id", "X-Codex-Window-Id")) {
    setHeaderAliases(nextHeaders, windowId, "x-codex-window-id", "X-Codex-Window-Id");
  }

  // Official client only sends beta features when non-empty.
  if (!nextHeaders["X-Codex-Beta-Features"]?.trim()) {
    delete nextHeaders["X-Codex-Beta-Features"];
  }

  if (!hasHeader(nextHeaders, "X-Codex-Turn-Metadata", "x-codex-turn-metadata")) {
    const metadata: Record<string, unknown> = {
      installation_id: getCodexInstallationId(),
      session_id: sessionId,
      thread_id: sessionId,
      turn_id: randomUUID(),
      request_kind: "turn",
      window_id: windowId,
      sandbox: "none",
      turn_started_at_unix_ms: Date.now(),
    };
    if (model?.id) metadata.model = model.id;
    nextHeaders["X-Codex-Turn-Metadata"] = JSON.stringify(metadata);
  }
  return nextHeaders;
}

export function getCodexCompatHeaders(
  config: CodexCompatConfig,
  sessionId: string,
  model?: ProviderCompatModelLike | null | undefined,
): Record<string, string> {
  return withCodexHeaders(config.headers, sessionId, model);
}

function withCodexInstructions(
  payload: Record<string, unknown>,
  systemText: string,
): Record<string, unknown> | undefined {
  if (!systemText) return undefined;

  const instructions = payload.instructions;
  if (typeof instructions === "string") {
    if (instructions.includes(systemText)) return undefined;
    return { ...payload, instructions: instructions ? `${systemText}\n${instructions}` : systemText };
  }
  if (instructions === undefined || instructions === null) {
    return { ...payload, instructions: systemText };
  }
  return undefined;
}

/** Simulated installation id for body client_metadata (gateway gate). */
const DEFAULT_CODEX_INSTALLATION_ID = "95b11878-7eed-49b6-b70f-064be99a0603";

function getCodexInstallationId(): string {
  return process.env.PI_CODEX_COMPAT_INSTALLATION_ID?.trim() || DEFAULT_CODEX_INSTALLATION_ID;
}

/**
 * Official Codex sends client_metadata on ResponsesAPI bodies.
 * Some gateways only require non-empty x-codex-installation-id.
 */
function withCodexClientMetadata(
  payload: Record<string, unknown>,
  sessionId: string,
): Record<string, unknown> | undefined {
  const existing = isRecord(payload.client_metadata) ? payload.client_metadata : {};
  const next: Record<string, unknown> = { ...existing };
  let changed = !isRecord(payload.client_metadata);
  const windowId = `${sessionId}:0`;

  const setIfEmpty = (key: string, value: string) => {
    const current = next[key];
    if (typeof current === "string" && current.trim()) return;
    next[key] = value;
    changed = true;
  };

  setIfEmpty("x-codex-installation-id", getCodexInstallationId());
  setIfEmpty("session_id", sessionId);
  setIfEmpty("thread_id", sessionId);
  setIfEmpty("x-codex-window-id", windowId);
  setIfEmpty("turn_id", randomUUID());

  return changed ? { ...payload, client_metadata: next } : undefined;
}

function withCodexPayloadDefaults(
  payload: Record<string, unknown>,
  config: CodexCompatConfig,
  sessionId: string,
): Record<string, unknown> | undefined {
  const promptCacheKey = getCodexPromptCacheKey(payload, sessionId);

  let nextPayload: Record<string, unknown> = payload;
  let changed = false;

  if (payload.prompt_cache_key !== promptCacheKey) {
    nextPayload = { ...nextPayload, prompt_cache_key: promptCacheKey };
    changed = true;
  }

  if (payload.store !== config.store) {
    nextPayload = { ...nextPayload, store: config.store };
    changed = true;
  }

  if (!hasOwn(nextPayload, "instructions")) {
    nextPayload = { ...nextPayload, instructions: "" };
    changed = true;
  }

  const withMetadata = withCodexClientMetadata(nextPayload, sessionId);
  if (withMetadata) {
    nextPayload = withMetadata;
    changed = true;
  }

  return changed ? nextPayload : undefined;
}

export function patchCodexCompatPayload(
  payload: unknown,
  options: {
    config: CodexCompatConfig;
    model: ProviderCompatModelLike | null | undefined;
    sessionId: string;
  },
): unknown | undefined {
  const { config, model, sessionId } = options;
  if (!supportsCodexCompat(model, config) || !isRecord(payload) || !isOpenAIResponsesPayload(payload, model)) {
    return undefined;
  }

  let nextPayload: Record<string, unknown> = payload;
  let changed = false;

  const defaultsPayload = withCodexPayloadDefaults(nextPayload, config, sessionId);
  if (defaultsPayload) {
    nextPayload = defaultsPayload;
    changed = true;
  }

  if (config.systemIdentity) {
    const withInstructions = withCodexInstructions(nextPayload, config.systemText.trim());
    if (withInstructions) {
      nextPayload = withInstructions;
      changed = true;
    }
  }

  return changed ? nextPayload : undefined;
}
