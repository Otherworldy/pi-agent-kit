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
  },
): unknown | undefined {
  const { config, model } = options;
  if (!supportsClaudeCodeCompat(model, config) || !isRecord(payload)) return undefined;

  let nextPayload: Record<string, unknown> = payload;
  let changed = false;

  const withMetadata = withMetadataUserId(nextPayload, config.metadataUserId.trim());
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

function isOpenAIResponsesPayload(payload: Record<string, unknown>, model: ProviderCompatModelLike | null | undefined): boolean {
  return model?.api === "openai-responses"
    || model?.api === "openai-codex-responses"
    || hasOwn(payload, "input")
    || hasOwn(payload, "instructions");
}

function stableCompatId(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return [
    hash.toString(16).padStart(8, "0"),
    "0000",
    "4000",
    "8000",
    "000000000000",
  ].join("-");
}

function getCodexSessionId(config: CodexCompatConfig): string {
  return config.metadataUserId.trim() || config.promptCacheKey.trim() || "pi-agent";
}

function getCodexPromptCacheKey(config: CodexCompatConfig, sessionId: string): string {
  return config.promptCacheKey.trim() || sessionId;
}

function withCodexHeaders(
  headers: Record<string, string>,
  sessionId: string,
  promptCacheKey: string,
  model: ProviderCompatModelLike | null | undefined,
): Record<string, string> {
  const nextHeaders = { ...headers };
  if (!nextHeaders.Session_id) nextHeaders.Session_id = promptCacheKey;
  if (!nextHeaders["X-Codex-Turn-Metadata"]) {
    const metadata: Record<string, unknown> = {
      session_id: sessionId,
      thread_id: promptCacheKey,
      turn_id: randomUUID(),
      request_kind: "turn",
      window_id: stableCompatId(`${promptCacheKey}:0`),
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
  model?: ProviderCompatModelLike | null | undefined,
): Record<string, string> {
  const sessionId = getCodexSessionId(config);
  const promptCacheKey = getCodexPromptCacheKey(config, sessionId);
  return withCodexHeaders(config.headers, sessionId, promptCacheKey, model);
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

function withCodexPayloadDefaults(
  payload: Record<string, unknown>,
  config: CodexCompatConfig,
): Record<string, unknown> | undefined {
  const sessionId = getCodexSessionId(config);
  const promptCacheKey = getCodexPromptCacheKey(config, sessionId);
  const clientMetadata = isRecord(payload.client_metadata) ? payload.client_metadata : {};

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

  if (clientMetadata["x-codex-installation-id"] !== sessionId) {
    nextPayload = {
      ...nextPayload,
      client_metadata: {
        ...clientMetadata,
        "x-codex-installation-id": sessionId,
      },
    };
    changed = true;
  }

  if (!hasOwn(nextPayload, "instructions")) {
    nextPayload = { ...nextPayload, instructions: "" };
    changed = true;
  }

  return changed ? nextPayload : undefined;
}

export function patchCodexCompatPayload(
  payload: unknown,
  options: {
    config: CodexCompatConfig;
    model: ProviderCompatModelLike | null | undefined;
  },
): unknown | undefined {
  const { config, model } = options;
  if (!supportsCodexCompat(model, config) || !isRecord(payload) || !isOpenAIResponsesPayload(payload, model)) {
    return undefined;
  }

  let nextPayload: Record<string, unknown> = payload;
  let changed = false;

  const defaultsPayload = withCodexPayloadDefaults(nextPayload, config);
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
