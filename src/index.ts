import {
  copyToClipboard,
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  parseFooterFixedConfig,
  readSettings,
  type FooterFixedBooleanSettingKey,
  type FooterFixedConfig,
  writeFooterFixedSetting,
} from "./config.ts";
import {
  formatFastHelp,
  formatFastStatusLabel,
  formatFastStatusMessage,
  parseFastCommand,
  patchFastPayload,
  supportsFast,
} from "./fast-mode.ts";
import { renderEditorChrome } from "./editor-chrome.ts";
import { renderFixedEditorCluster } from "./fixed-editor/cluster.ts";
import { emergencyTerminalModeReset, TerminalSplitCompositor } from "./fixed-editor/terminal-split.ts";
import { notifyTaskCompleteWindows, shouldNotifyTaskCompletion } from "./notify.ts";
import { showFooterFixedSettingsPanel } from "./settings-panel.ts";

const STATUS_WIDGET_ID = "footer-fixed-status";
const SECONDARY_WIDGET_ID = "footer-fixed-secondary";
const DEFAULT_SCROLL_UP_SHORTCUT = "super+up";
const DEFAULT_SCROLL_DOWN_SHORTCUT = "super+down";
const MAX_INSTALL_RETRY_ATTEMPTS = 5;
const INSTALL_RETRY_DELAYS_MS = [0, 16, 50, 100, 250] as const;
const FOOTER_FIXED_EDITOR_FACTORY = Symbol("pi-footer-fixed.editorFactory");

type EditorFactory = (tui: any, theme: any, keybindings: any) => any;
type FooterFixedEditorFactory = EditorFactory & { [FOOTER_FIXED_EDITOR_FACTORY]?: true };

let config: FooterFixedConfig = {
  fixedEditor: true,
  mouseScroll: true,
  showExtensionStatus: true,
  taskCompletionNotification: true,
  editorChrome: true,
  fast: {
    enabled: false,
    persistState: true,
    serviceTier: "priority",
    supportedModels: ["openai/gpt-5.4", "openai/gpt-5.5", "openai-codex/gpt-5.4", "openai-codex/gpt-5.5"],
  },
};

function notify(ctx: any, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (typeof ctx?.ui?.notify === "function") {
    ctx.ui.notify(message, type);
  }
}

function renderFooterDataLines(width: number, footerData: ReadonlyFooterDataProvider | null): string[] {
  if (!config.showExtensionStatus || !footerData || width <= 0) return [];

  const parts: string[] = [];
  const branch = footerData.getGitBranch();
  if (branch) parts.push(` ${branch}`);

  for (const value of footerData.getExtensionStatuses().values()) {
    if (value && visibleWidth(value) > 0) parts.push(value);
  }

  if (parts.length === 0) return [];
  return [truncateToWidth(` ${parts.join("  ")}`, width, "…", true)];
}

function findContainerWithChild(tui: any, child: any): { container: any; index: number } | null {
  const children = Array.isArray(tui?.children) ? tui.children : [];
  const index = children.findIndex((candidate: any) => Array.isArray(candidate?.children) && candidate.children.includes(child));
  if (index === -1) return null;

  return { container: children[index], index };
}

function getSingleContainerChild(container: any): any | null {
  const children = Array.isArray(container?.children) ? container.children : [];
  return children.length === 1 ? children[0] : null;
}

function isEditorShellActive(container: any, editor: any): boolean {
  return getSingleContainerChild(container) === editor;
}

function hasVisibleOverlay(tui: any): boolean {
  if (typeof tui?.hasOverlay === "function") {
    try {
      if (tui.hasOverlay()) return true;
    } catch {
      return false;
    }
  }

  const overlayStack = Reflect.get(tui ?? {}, "overlayStack");
  return Array.isArray(overlayStack) && overlayStack.some((entry) => entry && entry.hidden !== true);
}

function copyTextToClipboard(ctx: any, text: string): void {
  void copyToClipboard(text).then(
    () => notify(ctx, "Copied selection", "info"),
    (error) => notify(ctx, `Copy failed: ${error instanceof Error ? error.message : String(error)}`, "warning"),
  );
}

export default function footerFixedPlugin(pi: ExtensionAPI) {
  let tuiRef: any = null;
  let currentEditor: any = null;
  let activeCtxRef: ExtensionContext | null = null;
  let activeThinkingLevel = "off";
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let originalEditorFactory: EditorFactory | undefined;
  let wrappedEditorFactory: FooterFixedEditorFactory | undefined;
  let fixedEditorCompositor: TerminalSplitCompositor | null = null;
  let fixedStatusContainer: any = null;
  let fixedEditorContainer: any = null;
  let fixedWidgetContainerAbove: any = null;
  let fixedWidgetContainerBelow: any = null;
  let needsFixedEditorReinstall = false;
  let installRetryQueued = false;
  let installRetryAttempts = 0;
  let installRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const installStabilizationTimers = new Set<ReturnType<typeof setTimeout>>();
  let fastDesired = false;
  let currentModelRef: any = null;

  function teardownFixedEditorCompositor(options?: { resetExtendedKeyboardModes?: boolean }) {
    const hadCompositor = fixedEditorCompositor !== null;
    fixedEditorCompositor?.dispose(options);
    if (!hadCompositor && options?.resetExtendedKeyboardModes) {
      try {
        process.stdout.write(emergencyTerminalModeReset());
      } catch {
        // Shutdown cleanup cannot surface useful terminal write failures.
      }
    }

    fixedEditorCompositor = null;
    fixedStatusContainer = null;
    fixedEditorContainer = null;
    fixedWidgetContainerAbove = null;
    fixedWidgetContainerBelow = null;
  }

  function installFixedEditorCompositor(ctx: any, tui: any): boolean {
    if (!ctx?.hasUI || !config.fixedEditor) return false;
    if (!tui?.terminal || typeof tui.terminal.write !== "function") {
      teardownFixedEditorCompositor();
      throw new Error("[pi-footer-fixed] Fixed editor compositor could not find tui.terminal.write()");
    }
    if (!currentEditor) return false;

    const editorContainerMatch = findContainerWithChild(tui, currentEditor);
    if (!editorContainerMatch) {
      needsFixedEditorReinstall = true;
      if (hasVisibleOverlay(tui)) return false;

      teardownFixedEditorCompositor();
      return false;
    }

    teardownFixedEditorCompositor();

    const tuiChildren = Array.isArray(tui.children) ? tui.children : [];
    needsFixedEditorReinstall = false;
    installRetryAttempts = 0;
    fixedEditorContainer = editorContainerMatch.container;
    const statusContainerCandidate = tuiChildren[editorContainerMatch.index - 2] ?? null;
    fixedStatusContainer = statusContainerCandidate && typeof statusContainerCandidate.render === "function"
      ? statusContainerCandidate
      : null;
    fixedWidgetContainerAbove = tuiChildren[editorContainerMatch.index - 1] ?? null;
    fixedWidgetContainerBelow = tuiChildren[editorContainerMatch.index + 1] ?? null;

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
        const bypass = !isEditorShellActive(fixedEditorContainer, currentEditor);
        if (bypass && ctx.ui.getEditorComponent?.() !== wrappedEditorFactory) {
          needsFixedEditorReinstall = true;
          queueInstallRetry(ctx);
        }
        return bypass;
      },
      renderCluster: (width, terminalRows) => {
        const statusContainerLines = fixedStatusContainer
          ? compositor.renderHidden(fixedStatusContainer, width).filter((line) => visibleWidth(line) > 0)
          : [];
        const aboveWidgetLines = fixedWidgetContainerAbove ? compositor.renderHidden(fixedWidgetContainerAbove, width) : [];
        const belowWidgetLines = fixedWidgetContainerBelow ? compositor.renderHidden(fixedWidgetContainerBelow, width) : [];

        return renderFixedEditorCluster({
          width,
          terminalRows,
          statusLines: [...aboveWidgetLines, ...renderFooterDataLines(width, footerDataRef), ...statusContainerLines],
          editorLines: fixedEditorContainer ? compositor.renderHidden(fixedEditorContainer, width) : [],
          secondaryLines: belowWidgetLines,
        });
      },
    });

    fixedEditorCompositor = compositor;
    if (fixedStatusContainer?.render) compositor.hideRenderable(fixedStatusContainer);
    if (fixedWidgetContainerAbove?.render) compositor.hideRenderable(fixedWidgetContainerAbove);
    compositor.hideRenderable(fixedEditorContainer, () => isEditorShellActive(fixedEditorContainer, currentEditor));
    if (fixedWidgetContainerBelow?.render) compositor.hideRenderable(fixedWidgetContainerBelow);
    compositor.install();
    tui.requestRender(true);
    return true;
  }

  function installFallbackWidgets(ctx: any) {
    ctx.ui.setWidget(STATUS_WIDGET_ID, () => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        return renderFooterDataLines(width, footerDataRef);
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

  function clearFallbackWidgets(ctx: any) {
    ctx.ui.setWidget(STATUS_WIDGET_ID, undefined);
    ctx.ui.setWidget(SECONDARY_WIDGET_ID, undefined);
  }

  function wrapEditorFactory(ctx: any, factory: EditorFactory | undefined): FooterFixedEditorFactory {
    const wrapped = ((tui: any, theme: any, keybindings: any) => {
      const editor = factory
        ? factory(tui, theme, keybindings)
        : new CustomEditor(tui, theme, keybindings);

      const originalRender = editor.render?.bind(editor);
      if (originalRender) {
        editor.render = (width: number) => renderEditorChrome({
          width,
          enabled: config.editorChrome,
          context: activeCtxRef,
          thinkingLevel: activeThinkingLevel,
          fastLabel: getFastChromeLabel(activeCtxRef),
          borderColor: editor.borderColor,
          renderBase: originalRender,
        });
      }

      currentEditor = editor;

      let inheritedOnSubmit = editor.onSubmit;
      Object.defineProperty(editor, "onSubmit", {
        configurable: true,
        get: () => inheritedOnSubmit,
        set(handler: unknown) {
          inheritedOnSubmit = typeof handler === "function"
            ? (text: string) => {
              fixedEditorCompositor?.jumpToRootBottom();
              handler(text);
            }
            : handler;
        },
      });

      if (config.fixedEditor) {
        installWhenTuiReady(ctx, tui);
      }

      return editor;
    }) as FooterFixedEditorFactory;

    wrapped[FOOTER_FIXED_EDITOR_FACTORY] = true;
    return wrapped;
  }

  function isCurrentEditorMounted(): boolean {
    return Boolean(tuiRef && currentEditor && findContainerWithChild(tuiRef, currentEditor));
  }

  function ensureEditorFactoryInstalled(ctx: any): void {
    const existingFactory = ctx.ui.getEditorComponent?.() as FooterFixedEditorFactory | undefined;
    if (existingFactory !== undefined && existingFactory[FOOTER_FIXED_EDITOR_FACTORY] !== true) {
      originalEditorFactory = existingFactory;
      wrappedEditorFactory = undefined;
    }

    wrappedEditorFactory ??= wrapEditorFactory(ctx, originalEditorFactory);
    if (existingFactory !== wrappedEditorFactory || !isCurrentEditorMounted()) {
      ctx.ui.setEditorComponent(wrappedEditorFactory);
    }
  }

  function queueInstallRetry(ctx: any): void {
    if (installRetryQueued || installRetryAttempts >= MAX_INSTALL_RETRY_ATTEMPTS) return;
    installRetryQueued = true;
    const delay = INSTALL_RETRY_DELAYS_MS[Math.min(installRetryAttempts, INSTALL_RETRY_DELAYS_MS.length - 1)] ?? 0;
    installRetryAttempts += 1;
    installRetryTimer = setTimeout(() => {
      installRetryQueued = false;
      installRetryTimer = null;
      reinstallFixedEditor(ctx);
    }, delay);
  }

  function queueInstallStabilization(ctx: any): void {
    for (const delay of INSTALL_RETRY_DELAYS_MS) {
      const timer = setTimeout(() => {
        installStabilizationTimers.delete(timer);
        reinstallFixedEditor(ctx);
      }, delay);
      installStabilizationTimers.add(timer);
    }
  }

  function clearInstallTimers(): void {
    if (installRetryTimer) {
      clearTimeout(installRetryTimer);
      installRetryTimer = null;
    }
    installRetryQueued = false;
    for (const timer of installStabilizationTimers) {
      clearTimeout(timer);
    }
    installStabilizationTimers.clear();
  }

  function activeModel(ctx?: any): any {
    return ctx?.model ?? currentModelRef;
  }

  function getFastChromeLabel(ctx?: any): string | undefined {
    const label = formatFastStatusLabel(fastDesired, activeModel(ctx), config.fast.supportedModels);
    if (!label) return undefined;
    return label.replace(/^⚡\s*/, "⚡");
  }

  function updateFastStatus(ctx: any): void {
    if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;

    const label = getFastChromeLabel(ctx);
    if (!label) {
      ctx.ui.setStatus("footer-fixed-fast", undefined);
      return;
    }

    const color = supportsFast(activeModel(ctx), config.fast.supportedModels) ? "accent" : "warning";
    ctx.ui.setStatus("footer-fixed-fast", ctx.ui.theme?.fg?.(color, label) ?? label);
  }

  function installWhenTuiReady(ctx: any, tui: any) {
    queueMicrotask(() => {
      if (!config.fixedEditor) return;
      if (!currentEditor) {
        needsFixedEditorReinstall = true;
        queueInstallRetry(ctx);
        return;
      }

      try {
        const installed = installFixedEditorCompositor(ctx, tui);
        if (!installed && needsFixedEditorReinstall && !hasVisibleOverlay(tui)) {
          queueInstallRetry(ctx);
        }
      } catch (error) {
        console.debug("[pi-footer-fixed] Fixed editor install failed:", error);
        notify(ctx, "pi-footer-fixed: fixed editor install failed; using normal widgets", "warning");
        teardownFixedEditorCompositor();
        installFallbackWidgets(ctx);
      }
    });
  }

  function reinstallFixedEditor(ctx: any, options: { force?: boolean } = {}): void {
    if (!config.fixedEditor) return;

    if (!tuiRef) {
      needsFixedEditorReinstall = true;
      queueInstallRetry(ctx);
      return;
    }

    if (hasVisibleOverlay(tuiRef)) {
      needsFixedEditorReinstall = true;
      fixedEditorCompositor?.requestRepaint();
      tuiRef.requestRender?.();
      return;
    }

    ensureEditorFactoryInstalled(ctx);

    if (!currentEditor) {
      needsFixedEditorReinstall = true;
      queueInstallRetry(ctx);
      return;
    }

    if (!options.force && fixedEditorCompositor && isCurrentEditorMounted() && ctx.ui.getEditorComponent?.() === wrappedEditorFactory) {
      needsFixedEditorReinstall = false;
      installRetryAttempts = 0;
      fixedEditorCompositor.requestRepaint();
      return;
    }

    needsFixedEditorReinstall = false;
    installWhenTuiReady(ctx, tuiRef);
  }

  function setupEditor(ctx: any) {
    if (!ctx?.hasUI) return;

    teardownFixedEditorCompositor();
    clearFallbackWidgets(ctx);

    ensureEditorFactoryInstalled(ctx);

    if (!config.fixedEditor) {
      installFallbackWidgets(ctx);
    } else {
      reinstallFixedEditor(ctx);
    }
  }

  function installFooterCapture(ctx: any) {
    ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      tuiRef = tui;
      footerDataRef = footerData;
      const unsubscribe = footerData.onBranchChange(() => {
        fixedEditorCompositor?.requestRepaint();
        tui.requestRender();
      });

      if (config.fixedEditor) {
        reinstallFixedEditor(ctx);
      }

      return {
        dispose() {
          unsubscribe();
        },
        invalidate() {
          fixedEditorCompositor?.requestRepaint();
        },
        render() {
          return [];
        },
      };
    });
  }

  function applySetting(ctx: any, key: FooterFixedBooleanSettingKey, value: boolean): void {
    if (key === "fast.enabled") {
      if (config.fast.enabled === value) return;
      config.fast.enabled = value;
      fastDesired = value;
      updateFastStatus(ctx);
      const persisted = writeFooterFixedSetting(ctx.cwd, { fast: { enabled: value } });
      if (!persisted) notify(ctx, "pi-footer-fixed setting changed but was not persisted; check settings.json", "warning");
      return;
    }

    if (config[key] === value) return;

    config[key] = value;
    if (key === "fixedEditor") {
      setupEditor(ctx);
    } else if (key === "mouseScroll") {
      reinstallFixedEditor(ctx, { force: true });
    } else if (key === "showExtensionStatus" || key === "editorChrome") {
      fixedEditorCompositor?.requestRepaint();
      tuiRef?.requestRender?.();
    }

    const persisted = writeFooterFixedSetting(ctx.cwd, { [key]: value });
    if (!persisted) {
      notify(ctx, "pi-footer-fixed setting changed but was not persisted; check settings.json", "warning");
    }
  }

  async function openSettings(ctx: any): Promise<void> {
    if (!ctx.hasUI) {
      notify(ctx, "pi-footer-fixed settings require interactive UI", "warning");
      return;
    }

    await showFooterFixedSettingsPanel(ctx, config, (key, value) => applySetting(ctx, key, value));

    if (needsFixedEditorReinstall) {
      reinstallFixedEditor(ctx);
    }
  }

  function reloadRuntimeConfig(ctx: any): void {
    config = parseFooterFixedConfig(readSettings(ctx.cwd));
    fastDesired = config.fast.enabled || pi.getFlag?.("fast") === true;
    config.fast.enabled = fastDesired;
    updateFastStatus(ctx);
  }

  async function handleFastCommand(args: string | string[], ctx: any): Promise<void> {
    const { action } = parseFastCommand(args);
    if (action === "help") {
      notify(ctx, formatFastHelp(), "info");
      return;
    }
    if (action === "reload") {
      reloadRuntimeConfig(ctx);
      notify(ctx, "Fast mode settings reloaded", "info");
      return;
    }
    if (action === "status") {
      notify(ctx, formatFastStatusMessage(fastDesired, activeModel(ctx), config.fast.supportedModels, config.fast.serviceTier), "info");
      return;
    }

    fastDesired = action === "toggle" ? !fastDesired : action === "on";
    config.fast.enabled = fastDesired;
    updateFastStatus(ctx);
    if (config.fast.persistState) {
      const persisted = writeFooterFixedSetting(ctx.cwd, { fast: { enabled: fastDesired } });
      if (!persisted) notify(ctx, "Fast mode changed but was not persisted; check settings.json", "warning");
    }
    notify(ctx, formatFastStatusMessage(fastDesired, activeModel(ctx), config.fast.supportedModels, config.fast.serviceTier), "info");
  }

  pi.registerFlag?.("fast", {
    description: "Start with fast mode enabled for allow-listed OpenAI-compatible models",
    type: "boolean",
    default: false,
  });

  pi.on("before_provider_request", (event, ctx) => {
    currentModelRef = activeModel(ctx);
    return patchFastPayload(event.payload, {
      enabled: fastDesired,
      model: currentModelRef,
      supportedModels: config.fast.supportedModels,
      serviceTier: config.fast.serviceTier,
    });
  });

  pi.on("session_start", async (_event, ctx) => {
    config = parseFooterFixedConfig(readSettings(ctx.cwd));
    needsFixedEditorReinstall = false;
    installRetryAttempts = 0;
    clearInstallTimers();
    currentEditor = null;
    tuiRef = null;
    footerDataRef = null;
    activeCtxRef = ctx;
    activeThinkingLevel = typeof pi.getThinkingLevel === "function" ? pi.getThinkingLevel() : "off";
    currentModelRef = ctx.model;
    fastDesired = config.fast.enabled || pi.getFlag?.("fast") === true;
    config.fast.enabled = fastDesired;
    updateFastStatus(ctx);

    if (!ctx.hasUI) return;

    installFooterCapture(ctx);
    setupEditor(ctx);
    reinstallFixedEditor(ctx);
    queueInstallStabilization(ctx);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    activeThinkingLevel = event.level;
    if (ctx.hasUI) {
      fixedEditorCompositor?.requestRepaint();
      tuiRef?.requestRender?.();
    }
  });

  pi.on("model_select", async (event, ctx) => {
    activeCtxRef = ctx;
    currentModelRef = event.model ?? ctx.model;
    updateFastStatus(ctx);
    if (ctx.hasUI) {
      fixedEditorCompositor?.requestRepaint();
      tuiRef?.requestRender?.();
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (config.taskCompletionNotification && shouldNotifyTaskCompletion(ctx)) {
      notifyTaskCompleteWindows();
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    installRetryAttempts = 0;
    clearInstallTimers();
    teardownFixedEditorCompositor({ resetExtendedKeyboardModes: true });
    ctx?.ui?.setStatus?.("footer-fixed-fast", undefined);
    tuiRef = null;
    currentEditor = null;
    activeCtxRef = null;
    footerDataRef = null;
    currentModelRef = null;
  });

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
