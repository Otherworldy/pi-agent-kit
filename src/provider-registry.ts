import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentKitConfig } from "./config.ts";
import type { ProviderRequestConfig } from "./plugin-state.ts";
import { getClaudeCodeCompatProviderNames, getCodexCompatHeaders, getCodexCompatProviderNames } from "./provider-compat.ts";
import { notify, activeModel } from "./utils.ts";

/**
 * 读取提供商请求配置
 */
export function readProviderRequestConfig(ctx: any, provider: string): ProviderRequestConfig | null {
  const providerRequestConfigs = ctx?.modelRegistry?.providerRequestConfigs;
  if (!(providerRequestConfigs instanceof Map)) return null;

  const existing = providerRequestConfigs.get(provider);
  if (!existing || typeof existing !== "object") return null;

  return {
    ...(typeof existing.apiKey === "string" ? { apiKey: existing.apiKey } : {}),
    ...(typeof existing.authHeader === "boolean" ? { authHeader: existing.authHeader } : {}),
    ...(existing.headers && typeof existing.headers === "object" ? { headers: { ...existing.headers } } : {}),
  };
}

/**
 * 写入提供商请求配置
 */
export function writeProviderRequestConfig(
  pi: ExtensionAPI,
  ctx: any,
  provider: string,
  requestConfig: ProviderRequestConfig | null,
): void {
  try {
    pi.registerProvider?.(provider, {
      ...(requestConfig?.apiKey !== undefined ? { apiKey: requestConfig.apiKey } : {}),
      ...(requestConfig?.authHeader !== undefined ? { authHeader: requestConfig.authHeader } : {}),
      headers: requestConfig?.headers ?? {},
    });
  } catch (error) {
    console.debug(`[pi-agent-kit] Failed to update provider compat config for ${provider}:`, error);
    notify(ctx, `Provider compatibility update failed for ${provider}`, "warning");
  }
}

/**
 * 恢复未使用的兼容性提供商配置
 */
export function restoreUnusedCompatProviders(
  pi: ExtensionAPI,
  ctx: any,
  nextProviders: Set<string>,
  previousCompatProviderConfigs: Map<string, ProviderRequestConfig | null>,
): void {
  for (const provider of [...previousCompatProviderConfigs.keys()]) {
    if (!nextProviders.has(provider)) {
      writeProviderRequestConfig(pi, ctx, provider, previousCompatProviderConfigs.get(provider) ?? null);
      previousCompatProviderConfigs.delete(provider);
    }
  }
}

/**
 * 注册提供商兼容性提供商
 */
export function registerProviderCompatProviders(
  pi: ExtensionAPI,
  ctx: any | undefined,
  currentModelRef: any,
  config: AgentKitConfig,
  previousCompatProviderConfigs: Map<string, ProviderRequestConfig | null>,
): {
  claudeProviders: Set<string>;
  codexProviders: Set<string>;
} {
  const model = activeModel(ctx, currentModelRef);
  const sessionId = ctx.sessionManager.getSessionId();
  const claudeProviders = new Set(getClaudeCodeCompatProviderNames(config.claudeCodeCompat, model));
  const codexProviders = new Set(getCodexCompatProviderNames(config.codexCompat, model));
  const providers = new Set([...claudeProviders, ...codexProviders]);

  restoreUnusedCompatProviders(pi, ctx, providers, previousCompatProviderConfigs);

  for (const provider of providers) {
    if (!previousCompatProviderConfigs.has(provider)) {
      previousCompatProviderConfigs.set(provider, readProviderRequestConfig(ctx, provider));
    }
    const previousConfig = previousCompatProviderConfigs.get(provider);
    writeProviderRequestConfig(pi, ctx, provider, {
      ...previousConfig,
      headers: {
        ...previousConfig?.headers,
        ...(claudeProviders.has(provider) ? config.claudeCodeCompat.headers : {}),
        ...(codexProviders.has(provider) ? getCodexCompatHeaders(config.codexCompat, sessionId, model) : {}),
      },
    });
  }

  return { claudeProviders, codexProviders };
}

/**
 * 获取已注册的Claude Code兼容性提供商
 */
export function getRegisteredClaudeCodeCompatProviders(registeredProviders: Set<string>): string[] {
  return [...registeredProviders].sort();
}

/**
 * 获取已注册的Codex兼容性提供商
 */
export function getRegisteredCodexCompatProviders(registeredProviders: Set<string>): string[] {
  return [...registeredProviders].sort();
}
