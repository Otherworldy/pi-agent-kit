import type { ClaudeCodeCompatConfig } from "./config.ts";

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

export function supportsClaudeCodeCompat(
  model: ProviderCompatModelLike | null | undefined,
  config: ClaudeCodeCompatConfig,
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

export function getClaudeCodeCompatProviderNames(
  config: ClaudeCodeCompatConfig,
  model: ProviderCompatModelLike | null | undefined,
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

  if (supportsClaudeCodeCompat(model, config) && model?.provider) {
    providers.add(model.provider);
  }

  return [...providers];
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
    config: ClaudeCodeCompatConfig;
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
