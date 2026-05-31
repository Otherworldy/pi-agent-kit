import type { PluginState } from "./plugin-state.ts";
import type { FooterFixedConfig } from "./config.ts";
import { TerminalSplitCompositor, emergencyTerminalModeReset } from "./fixed-editor/terminal-split.ts";
import { renderFixedEditorCluster } from "./fixed-editor/cluster.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  findContainerWithChild,
  isEditorShellActive,
  hasVisibleOverlay,
  copyTextToClipboard,
  renderFooterDataLines,
  notify,
} from "./utils.ts";
import { ensureEditorFactoryInstalled } from "./editor-factory.ts";

export const STATUS_WIDGET_ID = "footer-fixed-status";
export const SECONDARY_WIDGET_ID = "footer-fixed-secondary";
export const DEFAULT_SCROLL_UP_SHORTCUT = "super+up";
export const DEFAULT_SCROLL_DOWN_SHORTCUT = "super+down";
export const MAX_INSTALL_RETRY_ATTEMPTS = 5;
export const INSTALL_RETRY_DELAYS_MS = [0, 16, 50, 100, 250] as const;

/**
 * 拆卸固定编辑器Compositor
 */
export function teardownFixedEditorCompositor(
  state: PluginState,
  options?: { resetExtendedKeyboardModes?: boolean },
): void {
  const hadCompositor = state.fixedEditorCompositor !== null;
  state.fixedEditorCompositor?.dispose(options);
  if (!hadCompositor && options?.resetExtendedKeyboardModes) {
    try {
      process.stdout.write(emergencyTerminalModeReset());
    } catch {
      // Shutdown cleanup cannot surface useful terminal write failures.
    }
  }

  state.fixedEditorCompositor = null;
  state.fixedStatusContainer = null;
  state.fixedEditorContainer = null;
  state.fixedWidgetContainerAbove = null;
  state.fixedWidgetContainerBelow = null;
}

/**
 * 安装固定编辑器Compositor
 */
export function installFixedEditorCompositor(
  ctx: any,
  tui: any,
  state: PluginState,
  config: FooterFixedConfig,
  queueInstallRetry: (ctx: any) => void,
): boolean {
  if (!ctx?.hasUI || !config.fixedEditor) return false;
  if (!tui?.terminal || typeof tui.terminal.write !== "function") {
    teardownFixedEditorCompositor(state);
    throw new Error("[pi-footer-fixed] Fixed editor compositor could not find tui.terminal.write()");
  }
  if (!state.currentEditor) return false;

  const editorContainerMatch = findContainerWithChild(tui, state.currentEditor);
  if (!editorContainerMatch) {
    state.needsFixedEditorReinstall = true;
    if (hasVisibleOverlay(tui)) return false;

    teardownFixedEditorCompositor(state);
    return false;
  }

  teardownFixedEditorCompositor(state);

  const tuiChildren = Array.isArray(tui.children) ? tui.children : [];
  state.needsFixedEditorReinstall = false;
  state.installRetryAttempts = 0;
  state.fixedEditorContainer = editorContainerMatch.container;
  const statusContainerCandidate = tuiChildren[editorContainerMatch.index - 2] ?? null;
  state.fixedStatusContainer = statusContainerCandidate && typeof statusContainerCandidate.render === "function"
    ? statusContainerCandidate
    : null;
  state.fixedWidgetContainerAbove = tuiChildren[editorContainerMatch.index - 1] ?? null;
  state.fixedWidgetContainerBelow = tuiChildren[editorContainerMatch.index + 1] ?? null;

  let compositor: TerminalSplitCompositor;
  compositor = new TerminalSplitCompositor({
    tui,
    terminal: tui.terminal,
    mouseScroll: config.mouseScroll,
    keyboardScrollShortcuts: {
      up: DEFAULT_SCROLL_UP_SHORTCUT,
      down: DEFAULT_SCROLL_DOWN_SHORTCUT,
    },
    onCopySelection: (text) => copyTextToClipboard(ctx, text),
    getShowHardwareCursor: () => typeof tui.getShowHardwareCursor === "function" && tui.getShowHardwareCursor(),
    shouldBypassFixedCluster: () => {
      const bypass = !isEditorShellActive(state.fixedEditorContainer, state.currentEditor);
      if (bypass && ctx.ui.getEditorComponent?.() !== state.wrappedEditorFactory) {
        state.needsFixedEditorReinstall = true;
        queueInstallRetry(ctx);
      }
      return bypass;
    },
    renderCluster: (width, terminalRows) => {
      const statusContainerLines = state.fixedStatusContainer
        ? compositor.renderHidden(state.fixedStatusContainer, width).filter((line) => visibleWidth(line) > 0)
        : [];
      const aboveWidgetLines = state.fixedWidgetContainerAbove ? compositor.renderHidden(state.fixedWidgetContainerAbove, width) : [];
      const belowWidgetLines = state.fixedWidgetContainerBelow ? compositor.renderHidden(state.fixedWidgetContainerBelow, width) : [];

      return renderFixedEditorCluster({
        width,
        terminalRows,
        statusLines: [...aboveWidgetLines, ...renderFooterDataLines(width, state.footerDataRef, config.showExtensionStatus), ...statusContainerLines],
        editorLines: state.fixedEditorContainer ? compositor.renderHidden(state.fixedEditorContainer, width) : [],
        secondaryLines: belowWidgetLines,
      });
    },
  });

  state.fixedEditorCompositor = compositor;
  if (state.fixedStatusContainer?.render) compositor.hideRenderable(state.fixedStatusContainer);
  if (state.fixedWidgetContainerAbove?.render) compositor.hideRenderable(state.fixedWidgetContainerAbove);
  compositor.hideRenderable(state.fixedEditorContainer, () => isEditorShellActive(state.fixedEditorContainer, state.currentEditor));
  if (state.fixedWidgetContainerBelow?.render) compositor.hideRenderable(state.fixedWidgetContainerBelow);
  compositor.install();
  tui.requestRender(true);
  return true;
}

/**
 * 安装回退小部件（当固定编辑器不可用时）
 */
export function installFallbackWidgets(ctx: any, state: PluginState, config: FooterFixedConfig): void {
  ctx.ui.setWidget(STATUS_WIDGET_ID, () => ({
    dispose() {},
    invalidate() {},
    render(width: number): string[] {
      return renderFooterDataLines(width, state.footerDataRef, config.showExtensionStatus);
    },
  }), { placement: "aboveEditor" });

  ctx.ui.setWidget(SECONDARY_WIDGET_ID, () => ({
    dispose() {},
    invalidate() {},
    render(): string[] {
      return [];
    },
  }), { placement: "belowEditor" });
}

/**
 * 清除回退小部件
 */
export function clearFallbackWidgets(ctx: any): void {
  ctx.ui.setWidget(STATUS_WIDGET_ID, undefined);
  ctx.ui.setWidget(SECONDARY_WIDGET_ID, undefined);
}

/**
 * 队列安装重试
 */
export function queueInstallRetry(ctx: any, state: PluginState, reinstallFixedEditor: (ctx: any, options?: { force?: boolean }) => void): void {
  if (state.installRetryQueued || state.installRetryAttempts >= MAX_INSTALL_RETRY_ATTEMPTS) return;
  state.installRetryQueued = true;
  const delay = INSTALL_RETRY_DELAYS_MS[Math.min(state.installRetryAttempts, INSTALL_RETRY_DELAYS_MS.length - 1)] ?? 0;
  state.installRetryAttempts += 1;
  state.installRetryTimer = setTimeout(() => {
    state.installRetryQueued = false;
    state.installRetryTimer = null;
    reinstallFixedEditor(ctx);
  }, delay);
}

/**
 * 队列安装稳定化
 */
export function queueInstallStabilization(ctx: any, state: PluginState, reinstallFixedEditor: (ctx: any, options?: { force?: boolean }) => void): void {
  for (const delay of INSTALL_RETRY_DELAYS_MS) {
    const timer = setTimeout(() => {
      state.installStabilizationTimers.delete(timer);
      reinstallFixedEditor(ctx);
    }, delay);
    state.installStabilizationTimers.add(timer);
  }
}

/**
 * 清除安装定时器
 */
export function clearInstallTimers(state: PluginState): void {
  if (state.installRetryTimer) {
    clearTimeout(state.installRetryTimer);
    state.installRetryTimer = null;
  }
  state.installRetryQueued = false;
  for (const timer of state.installStabilizationTimers) {
    clearTimeout(timer);
  }
  state.installStabilizationTimers.clear();
}

/**
 * 当TUI准备好时安装
 */
export function installWhenTuiReady(
  ctx: any,
  tui: any,
  state: PluginState,
  config: FooterFixedConfig,
  queueInstallRetryFn: (ctx: any) => void,
): void {
  queueMicrotask(() => {
    if (!config.fixedEditor) return;
    if (!state.currentEditor) {
      state.needsFixedEditorReinstall = true;
      queueInstallRetryFn(ctx);
      return;
    }

    try {
      const installed = installFixedEditorCompositor(ctx, tui, state, config, queueInstallRetryFn);
      if (!installed && state.needsFixedEditorReinstall && !hasVisibleOverlay(tui)) {
        queueInstallRetryFn(ctx);
      }
    } catch (error) {
      console.debug("[pi-footer-fixed] Fixed editor install failed:", error);
      notify(ctx, "pi-footer-fixed: fixed editor install failed; using normal widgets", "warning");
      teardownFixedEditorCompositor(state);
      installFallbackWidgets(ctx, state, config);
    }
  });
}

/**
 * 重新安装固定编辑器
 */
export function reinstallFixedEditor(
  ctx: any,
  state: PluginState,
  config: FooterFixedConfig,
  installWhenTuiReadyFn: (ctx: any, tui: any) => void,
  ensureEditorFactoryInstalledFn: (ctx: any) => void,
  queueInstallRetryFn: (ctx: any) => void,
  options: { force?: boolean } = {},
): void {
  if (!config.fixedEditor) return;

  if (!state.tuiRef) {
    state.needsFixedEditorReinstall = true;
    queueInstallRetryFn(ctx);
    return;
  }

  if (hasVisibleOverlay(state.tuiRef)) {
    state.needsFixedEditorReinstall = true;
    state.fixedEditorCompositor?.requestRepaint();
    state.tuiRef.requestRender?.();
    return;
  }

  ensureEditorFactoryInstalledFn(ctx);

  if (!state.currentEditor) {
    state.needsFixedEditorReinstall = true;
    queueInstallRetryFn(ctx);
    return;
  }

  if (!options.force && state.fixedEditorCompositor && state.tuiRef && state.currentEditor && findContainerWithChild(state.tuiRef, state.currentEditor) && ctx.ui.getEditorComponent?.() === state.wrappedEditorFactory) {
    state.needsFixedEditorReinstall = false;
    state.installRetryAttempts = 0;
    state.fixedEditorCompositor.requestRepaint();
    return;
  }

  state.needsFixedEditorReinstall = false;
  installWhenTuiReadyFn(ctx, state.tuiRef);
}

/**
 * 设置编辑器
 */
export function setupEditor(
  ctx: any,
  state: PluginState,
  config: FooterFixedConfig,
  ensureEditorFactoryInstalledFn: (ctx: any) => void,
  reinstallFixedEditorFn: (ctx: any, options?: { force?: boolean }) => void,
): void {
  if (!ctx?.hasUI) return;

  teardownFixedEditorCompositor(state);
  clearFallbackWidgets(ctx);

  ensureEditorFactoryInstalledFn(ctx);

  if (!config.fixedEditor) {
    installFallbackWidgets(ctx, state, config);
  } else {
    reinstallFixedEditorFn(ctx);
  }
}
