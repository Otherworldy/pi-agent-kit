import type { FooterFixedConfig } from "./config.ts";
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
export function updateFastStatus(
  ctx: any,
  currentModelRef: any,
  fastDesired: boolean,
  supportedModels: readonly string[],
): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;

  const label = getFastChromeLabel(ctx, currentModelRef, fastDesired, supportedModels);
  if (!label) {
    ctx.ui.setStatus("footer-fixed-fast", undefined);
    return;
  }

  const color = supportsFast(activeModel(ctx, currentModelRef), supportedModels) ? "accent" : "warning";
  ctx.ui.setStatus("footer-fixed-fast", ctx.ui.theme?.fg?.(color, label) ?? label);
}

/**
 * 更新Claude Code兼容性状态
 */
export function updateClaudeCodeCompatStatus(
  ctx: any,
  currentModelRef: any,
  config: FooterFixedConfig,
): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;

  if (!config.claudeCodeCompat.enabled) {
    ctx.ui.setStatus("footer-fixed-claude-code", undefined);
    return;
  }

  const active = supportsClaudeCodeCompat(activeModel(ctx, currentModelRef), config.claudeCodeCompat);
  const label = active ? "CC compat" : "CC compat*";
  const color = active ? "accent" : "warning";
  ctx.ui.setStatus("footer-fixed-claude-code", ctx.ui.theme?.fg?.(color, label) ?? label);
}

/**
 * 更新Codex兼容性状态
 */
export function updateCodexCompatStatus(
  ctx: any,
  currentModelRef: any,
  config: FooterFixedConfig,
): void {
  if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;

  if (!config.codexCompat.enabled) {
    ctx.ui.setStatus("footer-fixed-codex", undefined);
    return;
  }

  const active = supportsCodexCompat(activeModel(ctx, currentModelRef), config.codexCompat);
  const label = active ? "Codex compat" : "Codex compat*";
  const color = active ? "accent" : "warning";
  ctx.ui.setStatus("footer-fixed-codex", ctx.ui.theme?.fg?.(color, label) ?? label);
}

/**
 * 更新所有提供商状态
 */
export function updateProviderStatuses(
  ctx: any,
  currentModelRef: any,
  fastDesired: boolean,
  config: FooterFixedConfig,
): void {
  updateFastStatus(ctx, currentModelRef, fastDesired, config.fast.supportedModels);
  updateClaudeCodeCompatStatus(ctx, currentModelRef, config);
  updateCodexCompatStatus(ctx, currentModelRef, config);
}
