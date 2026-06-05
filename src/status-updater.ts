import type { AgentKitConfig } from "./config.ts";
import { formatFastStatusLabel, supportsFast } from "./fast-mode.ts";
import { supportsClaudeCodeCompat, supportsCodexCompat } from "./provider-compat.ts";
import { activeModel } from "./utils.ts";

/**
 * 获取快速模式的Chrome标签
 */
export function getFastChromeLabel(
  ctx: any | undefined,
  currentModelRef: any,
  fastDesired: boolean,
  supportedModels: readonly string[],
): string | undefined {
  const label = formatFastStatusLabel(fastDesired, activeModel(ctx, currentModelRef), supportedModels);
  if (!label) return undefined;
  return label.replace(/^⚡\s*/, "⚡");
}

/**
 * 更新快速模式状态
 */
export function getProviderCompatChromeLabel(
  ctx: any | undefined,
  currentModelRef: any,
  config: AgentKitConfig,
): string | undefined {
  if (!config.providerCompat.enabled) return undefined;
  const model = activeModel(ctx, currentModelRef);
  if (supportsClaudeCodeCompat(model, config.claudeCodeCompat)) return "CC";
  if (supportsCodexCompat(model, config.codexCompat)) return "Codex";
  return undefined;
}

export function updateFastStatus(
  ctx: any,
  currentModelRef: any,
  fastDesired: boolean,
  supportedModels: readonly string[],
): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;

  const label = getFastChromeLabel(ctx, currentModelRef, fastDesired, supportedModels);
  if (!label) {
    ctx.ui.setStatus("agent-kit-fast", undefined);
    return;
  }

  const color = supportsFast(activeModel(ctx, currentModelRef), supportedModels) ? "accent" : "warning";
  ctx.ui.setStatus("agent-kit-fast", ctx.ui.theme?.fg?.(color, label) ?? label);
}

/**
 * 更新Claude Code兼容性状态
 */
export function updateClaudeCodeCompatStatus(
  ctx: any,
  currentModelRef: any,
  config: AgentKitConfig,
): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;

  if (!config.claudeCodeCompat.enabled) {
    ctx.ui.setStatus("agent-kit-claude-code", undefined);
    return;
  }

  const active = supportsClaudeCodeCompat(activeModel(ctx, currentModelRef), config.claudeCodeCompat);
  if (!active) {
    ctx.ui.setStatus("agent-kit-claude-code", undefined);
    return;
  }

  ctx.ui.setStatus("agent-kit-claude-code", ctx.ui.theme?.fg?.("accent", "CC compat") ?? "CC compat");
}

/**
 * 更新Codex兼容性状态
 */
export function updateCodexCompatStatus(
  ctx: any,
  currentModelRef: any,
  config: AgentKitConfig,
): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;

  if (!config.codexCompat.enabled) {
    ctx.ui.setStatus("agent-kit-codex", undefined);
    return;
  }

  const active = supportsCodexCompat(activeModel(ctx, currentModelRef), config.codexCompat);
  if (!active) {
    ctx.ui.setStatus("agent-kit-codex", undefined);
    return;
  }

  ctx.ui.setStatus("agent-kit-codex", ctx.ui.theme?.fg?.("accent", "Codex compat") ?? "Codex compat");
}

/**
 * 更新所有提供商状态
 */
export function updateProviderStatuses(
  ctx: any,
  currentModelRef: any,
  fastDesired: boolean,
  config: AgentKitConfig,
): void {
  updateFastStatus(ctx, currentModelRef, fastDesired, config.fast.supportedModels);
  updateClaudeCodeCompatStatus(ctx, currentModelRef, config);
  updateCodexCompatStatus(ctx, currentModelRef, config);
}
