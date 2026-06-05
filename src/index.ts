import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";

import {
  parseFooterFixedConfig,
  readSettings,
  type FooterFixedBooleanSettingKey,
  type FooterFixedConfig,
  writeFooterFixedSetting,
} from "./config.ts";
import {
  formatFastHelp,
  formatFastStatusMessage,
  parseFastCommand,
  patchFastPayload,
} from "./fast-mode.ts";
import {
  patchClaudeCodeCompatPayload,
  patchCodexCompatPayload,
} from "./provider-compat.ts";
import { getTaskCompletionNotificationStatus, notifyTaskCompleteWindows, shouldNotifyTaskCompletion } from "./notify.ts";
import { showFooterFixedSettingsPanel } from "./settings-panel.ts";
import { createPluginState, resetPluginState, cleanupPluginState } from "./plugin-state.ts";
import type { PluginState } from "./plugin-state.ts";
import { notify, activeModel } from "./utils.ts";
import { updateProviderStatuses } from "./status-updater.ts";
import {
  registerProviderCompatProviders,
  getRegisteredClaudeCodeCompatProviders,
  getRegisteredCodexCompatProviders,
  writeProviderRequestConfig,
} from "./provider-registry.ts";
import { ensureEditorFactoryInstalled } from "./editor-factory.ts";
import {
  teardownFixedEditorCompositor,
  installFallbackWidgets,
  clearFallbackWidgets,
  queueInstallRetry,
  queueInstallStabilization,
  clearInstallTimers,
  installWhenTuiReady,
  reinstallFixedEditor,
  setupEditor,
} from "./compositor-installer.ts";

/**
 * Pi Agent固定编辑器插件
 * 将编辑器固定在终端底部，同时提供快速模式、提供商兼容性等功能
 */
export default function footerFixedPlugin(pi: ExtensionAPI) {
  // 插件配置
  let config: FooterFixedConfig = parseFooterFixedConfig({});

  // 插件状态
  const state: PluginState = createPluginState();

  // 创建绑定到当前状态的函数
  const queueInstallRetryBound = (ctx: any) => queueInstallRetry(ctx, state, reinstallFixedEditorBound);
  const queueInstallStabilizationBound = (ctx: any) => queueInstallStabilization(ctx, state, reinstallFixedEditorBound);
  const installWhenTuiReadyBound = (ctx: any, tui: any) => installWhenTuiReady(ctx, tui, state, config, queueInstallRetryBound);
  const ensureEditorFactoryInstalledBound = (ctx: any) => ensureEditorFactoryInstalled(ctx, state, config, installWhenTuiReadyBound);
  const reinstallFixedEditorBound = (ctx: any, options?: { force?: boolean }) => reinstallFixedEditor(
    ctx,
    state,
    config,
    installWhenTuiReadyBound,
    ensureEditorFactoryInstalledBound,
    queueInstallRetryBound,
    options,
  );
  const setupEditorBound = (ctx: any) => setupEditor(ctx, state, config, ensureEditorFactoryInstalledBound, reinstallFixedEditorBound);

  /**
   * 安装页脚捕获
   */
  function installFooterCapture(ctx: any) {
    ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      state.tuiRef = tui;
      state.footerDataRef = footerData;
      const unsubscribe = footerData.onBranchChange(() => {
        state.fixedEditorCompositor?.requestRepaint();
        tui.requestRender();
      });

      if (config.fixedEditor) {
        reinstallFixedEditorBound(ctx);
      }

      return {
        dispose() {
          unsubscribe();
        },
        invalidate() {
          state.fixedEditorCompositor?.requestRepaint();
        },
        render() {
          return [];
        },
      };
    });
  }

  function refreshProviderCompatProviders(ctx: any): void {
    const { claudeProviders, codexProviders } = registerProviderCompatProviders(
      pi,
      ctx,
      state.currentModelRef,
      config,
      state.previousCompatProviderConfigs,
    );
    state.registeredClaudeCodeCompatProviders = claudeProviders;
    state.registeredCodexCompatProviders = codexProviders;
  }

  /**
   * 应用设置
   */
  function applySetting(ctx: any, key: FooterFixedBooleanSettingKey, value: boolean): void {
    if (key === "fast.enabled") {
      if (config.fast.enabled === value) return;
      config.fast.enabled = value;
      state.fastDesired = value;
      updateProviderStatuses(ctx, state.currentModelRef, state.fastDesired, config);
      const persisted = writeFooterFixedSetting(ctx.cwd, { fast: { enabled: value } });
      if (!persisted) notify(ctx, "pi-footer-fixed setting changed but was not persisted; check settings.json", "warning");
      return;
    }

    if (key === "providerCompat") {
      if (config.providerCompat.enabled === value) return;
      config.providerCompat.enabled = value;
      config.claudeCodeCompat.enabled = value;
      config.codexCompat.enabled = value;
      refreshProviderCompatProviders(ctx);
      updateProviderStatuses(ctx, state.currentModelRef, state.fastDesired, config);
      return;
    }

    if (config[key] === value) return;

    config[key] = value;
    if (key === "fixedEditor") {
      setupEditorBound(ctx);
    } else if (key === "mouseScroll") {
      reinstallFixedEditorBound(ctx, { force: true });
    } else if (key === "showExtensionStatus" || key === "editorChrome") {
      state.fixedEditorCompositor?.requestRepaint();
      state.tuiRef?.requestRender?.();
    }

    const persisted = writeFooterFixedSetting(ctx.cwd, { [key]: value });
    if (!persisted) {
      notify(ctx, "pi-footer-fixed setting changed but was not persisted; check settings.json", "warning");
    }
  }

  /**
   * 打开设置面板
   */
  async function openSettings(ctx: any): Promise<void> {
    if (!ctx.hasUI) {
      notify(ctx, "pi-footer-fixed settings require interactive UI", "warning");
      return;
    }

    await showFooterFixedSettingsPanel(ctx, config, (key, value) => applySetting(ctx, key, value));

    if (state.needsFixedEditorReinstall) {
      reinstallFixedEditorBound(ctx);
    }
  }

  /**
   * 重新加载运行时配置
   */
  function reloadRuntimeConfig(ctx: any): void {
    const providerCompatDesired = config.providerCompat.enabled;
    config = parseFooterFixedConfig(readSettings(ctx.cwd));
    config.providerCompat.enabled = providerCompatDesired;
    config.claudeCodeCompat.enabled = providerCompatDesired;
    config.codexCompat.enabled = providerCompatDesired;
    state.fastDesired = config.fast.enabled || pi.getFlag?.("fast") === true;
    config.fast.enabled = state.fastDesired;
    refreshProviderCompatProviders(ctx);
    updateProviderStatuses(ctx, state.currentModelRef, state.fastDesired, config);
  }

  /**
   * 处理快速模式命令
   */
  async function handleFastCommand(args: string | string[], ctx: any): Promise<void> {
    const { action } = parseFastCommand(args);
    if (action === "help") {
      notify(ctx, formatFastHelp(), "info");
      return;
    }
    if (action === "reload") {
      reloadRuntimeConfig(ctx);
      notify(ctx, "Fast mode and provider compatibility settings reloaded", "info");
      return;
    }
    if (action === "status") {
      const fastStatus = formatFastStatusMessage(
        state.fastDesired,
        activeModel(ctx, state.currentModelRef),
        config.fast.supportedModels,
        config.fast.serviceTier,
      );
      const claudeProviders = getRegisteredClaudeCodeCompatProviders(state.registeredClaudeCodeCompatProviders);
      const codexProviders = getRegisteredCodexCompatProviders(state.registeredCodexCompatProviders);
      const compatProviders = [...claudeProviders, ...codexProviders].sort();
      const compatMode = claudeProviders.length > 0 ? "Claude Code" : codexProviders.length > 0 ? "Codex" : "no compatible active model";
      const compatStatus = config.providerCompat.enabled
        ? `Provider compat is on (${compatMode}) for providers: ${compatProviders.join(", ") || "active model only"}.`
        : "Provider compat is off.";
      notify(ctx, `${fastStatus}\n${compatStatus}`, "info");
      return;
    }

    state.fastDesired = action === "toggle" ? !state.fastDesired : action === "on";
    config.fast.enabled = state.fastDesired;
    updateProviderStatuses(ctx, state.currentModelRef, state.fastDesired, config);
    if (config.fast.persistState) {
      const persisted = writeFooterFixedSetting(ctx.cwd, { fast: { enabled: state.fastDesired } });
      if (!persisted) notify(ctx, "Fast mode changed but was not persisted; check settings.json", "warning");
    }
    notify(ctx, formatFastStatusMessage(state.fastDesired, activeModel(ctx, state.currentModelRef), config.fast.supportedModels, config.fast.serviceTier), "info");
  }

  // 注册标志
  pi.registerFlag?.("fast", {
    description: "Start with fast mode enabled for allow-listed OpenAI-compatible models",
    type: "boolean",
    default: false,
  });

  // 注册事件处理器
  pi.on("before_provider_request", (event, ctx) => {
    state.currentModelRef = activeModel(ctx, state.currentModelRef);
    const fastPayload = patchFastPayload(event.payload, {
      enabled: state.fastDesired,
      model: state.currentModelRef,
      supportedModels: config.fast.supportedModels,
      serviceTier: config.fast.serviceTier,
    });

    const claudeCodePayload = patchClaudeCodeCompatPayload(fastPayload ?? event.payload, {
      config: config.claudeCodeCompat,
      model: state.currentModelRef,
    });

    const codexPayload = patchCodexCompatPayload(claudeCodePayload ?? fastPayload ?? event.payload, {
      config: config.codexCompat,
      model: state.currentModelRef,
    });

    return codexPayload ?? claudeCodePayload ?? fastPayload;
  });

  pi.on("turn_start", async (_event, ctx) => {
    state.activeCtxRef = ctx;
    state.currentModelRef = activeModel(ctx, state.currentModelRef);
    refreshProviderCompatProviders(ctx);
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    config = parseFooterFixedConfig(readSettings(ctx.cwd));
    resetPluginState(state);
    clearInstallTimers(state);
    state.activeCtxRef = ctx;
    state.activeThinkingLevel = typeof pi.getThinkingLevel === "function" ? pi.getThinkingLevel() : "off";
    state.currentModelRef = ctx.model;
    state.fastDesired = config.fast.enabled || pi.getFlag?.("fast") === true;
    config.fast.enabled = state.fastDesired;
    refreshProviderCompatProviders(ctx);
    updateProviderStatuses(ctx, state.currentModelRef, state.fastDesired, config);

    if (!ctx.hasUI) return;

    installFooterCapture(ctx);
    setupEditorBound(ctx);
    reinstallFixedEditorBound(ctx);
    queueInstallStabilizationBound(ctx);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    state.activeThinkingLevel = event.level;
    if (ctx.hasUI) {
      state.fixedEditorCompositor?.requestRepaint();
      state.tuiRef?.requestRender?.();
    }
  });

  pi.on("model_select", async (event, ctx) => {
    state.activeCtxRef = ctx;
    state.currentModelRef = event.model ?? ctx.model;
    refreshProviderCompatProviders(ctx);
    updateProviderStatuses(ctx, state.currentModelRef, state.fastDesired, config);
    if (ctx.hasUI) {
      state.fixedEditorCompositor?.requestRepaint();
      state.tuiRef?.requestRender?.();
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    if (config.taskCompletionNotification && shouldNotifyTaskCompletion(ctx)) {
      notifyTaskCompleteWindows(getTaskCompletionNotificationStatus(event.messages));
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearInstallTimers(state);
    teardownFixedEditorCompositor(state, { resetExtendedKeyboardModes: true });
    ctx?.ui?.setStatus?.("footer-fixed-fast", undefined);
    ctx?.ui?.setStatus?.("footer-fixed-claude-code", undefined);
    ctx?.ui?.setStatus?.("footer-fixed-codex", undefined);
    for (const [provider, previousConfig] of state.previousCompatProviderConfigs.entries()) {
      writeProviderRequestConfig(pi, ctx, provider, previousConfig);
    }
    cleanupPluginState(state);
  });

  // 注册命令
  pi.registerCommand("footer-fixed", {
    description: "Open pi-footer-fixed settings",
    handler: async (_args, ctx) => {
      await openSettings(ctx);
    },
  });

  pi.registerCommand("fast", {
    description: "Toggle OpenAI priority fast mode for allow-listed custom provider models",
    handler: async (args, ctx) => {
      await handleFastCommand(args, ctx);
    },
  });
}
