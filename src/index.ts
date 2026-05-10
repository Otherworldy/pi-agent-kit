import {
  copyToClipboard,
  CustomEditor,
  type ExtensionAPI,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  parseFooterFixedConfig,
  readSettings,
  type FooterFixedConfig,
  writeFooterFixedSetting,
} from "./config.ts";
import { renderFixedEditorCluster } from "./fixed-editor/cluster.ts";
import { emergencyTerminalModeReset, TerminalSplitCompositor } from "./fixed-editor/terminal-split.ts";
import { showFooterFixedSettingsPanel } from "./settings-panel.ts";

const STATUS_WIDGET_ID = "footer-fixed-status";
const SECONDARY_WIDGET_ID = "footer-fixed-secondary";
const DEFAULT_SCROLL_UP_SHORTCUT = "super+up";
const DEFAULT_SCROLL_DOWN_SHORTCUT = "super+down";

let config: FooterFixedConfig = {
  fixedEditor: true,
  mouseScroll: true,
  showExtensionStatus: true,
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

function copyTextToClipboard(ctx: any, text: string): void {
  void copyToClipboard(text).then(
    () => notify(ctx, "Copied selection", "info"),
    (error) => notify(ctx, `Copy failed: ${error instanceof Error ? error.message : String(error)}`, "warning"),
  );
}

export default function footerFixedPlugin(pi: ExtensionAPI) {
  let tuiRef: any = null;
  let currentEditor: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let originalEditorFactory: ((tui: any, theme: any, keybindings: any) => any) | undefined;
  let fixedEditorCompositor: TerminalSplitCompositor | null = null;
  let fixedStatusContainer: any = null;
  let fixedEditorContainer: any = null;
  let fixedWidgetContainerAbove: any = null;
  let fixedWidgetContainerBelow: any = null;

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

  function installFixedEditorCompositor(ctx: any, tui: any) {
    teardownFixedEditorCompositor();

    if (!ctx?.hasUI || !config.fixedEditor) return;
    if (!tui?.terminal || typeof tui.terminal.write !== "function") {
      throw new Error("[pi-footer-fixed] Fixed editor compositor could not find tui.terminal.write()");
    }
    if (!currentEditor) {
      throw new Error("[pi-footer-fixed] Fixed editor compositor expected the editor to be installed first");
    }

    const editorContainerMatch = findContainerWithChild(tui, currentEditor);
    if (!editorContainerMatch) {
      throw new Error("[pi-footer-fixed] Fixed editor compositor could not find the editor container in TUI children");
    }

    const tuiChildren = Array.isArray(tui.children) ? tui.children : [];
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
      shouldBypassFixedCluster: () => !isEditorShellActive(fixedEditorContainer, currentEditor),
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

  function wrapEditorFactory(ctx: any, factory: ((tui: any, theme: any, keybindings: any) => any) | undefined) {
    return (tui: any, theme: any, keybindings: any) => {
      const editor = factory
        ? factory(tui, theme, keybindings)
        : new CustomEditor(tui, theme, keybindings);

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
    };
  }

  function installWhenTuiReady(ctx: any, tui: any) {
    queueMicrotask(() => {
      if (!config.fixedEditor || !currentEditor) return;

      try {
        installFixedEditorCompositor(ctx, tui);
      } catch (error) {
        console.debug("[pi-footer-fixed] Fixed editor install failed:", error);
        notify(ctx, "pi-footer-fixed: fixed editor install failed; using normal widgets", "warning");
        config.fixedEditor = false;
        teardownFixedEditorCompositor();
        installFallbackWidgets(ctx);
      }
    });
  }

  function setupEditor(ctx: any) {
    if (!ctx?.hasUI) return;

    teardownFixedEditorCompositor();
    clearFallbackWidgets(ctx);

    const existingFactory = ctx.ui.getEditorComponent?.();
    if (existingFactory !== undefined && existingFactory !== originalEditorFactory) {
      originalEditorFactory = existingFactory;
    }

    ctx.ui.setEditorComponent(wrapEditorFactory(ctx, originalEditorFactory));

    if (!config.fixedEditor) {
      installFallbackWidgets(ctx);
    } else if (tuiRef && currentEditor) {
      installWhenTuiReady(ctx, tuiRef);
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

      if (config.fixedEditor && currentEditor) {
        installWhenTuiReady(ctx, tui);
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

  function applySetting(ctx: any, key: keyof FooterFixedConfig, value: boolean): void {
    if (config[key] === value) return;

    config[key] = value;
    if (key === "fixedEditor") {
      setupEditor(ctx);
    } else if (config.fixedEditor && tuiRef && currentEditor) {
      installWhenTuiReady(ctx, tuiRef);
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
  }

  pi.on("session_start", async (_event, ctx) => {
    config = parseFooterFixedConfig(readSettings(ctx.cwd));

    if (!ctx.hasUI) return;

    installFooterCapture(ctx);
    setupEditor(ctx);
  });

  pi.on("session_shutdown", async () => {
    teardownFixedEditorCompositor({ resetExtendedKeyboardModes: true });
    tuiRef = null;
    currentEditor = null;
    footerDataRef = null;
  });

  pi.registerCommand("footer-fixed", {
    description: "Open pi-footer-fixed settings",
    handler: async (_args, ctx) => {
      await openSettings(ctx);
    },
  });
}
