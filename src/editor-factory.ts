import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { PluginState, EditorFactory, AgentKitEditorFactory } from "./plugin-state.ts";
import type { AgentKitConfig } from "./config.ts";
import { AGENT_KIT_EDITOR_FACTORY, formatWorkingElapsedMs, getWorkingElapsedMs, workingSpinnerFrame } from "./plugin-state.ts";
import { renderEditorChrome } from "./editor-chrome.ts";
import { getFastChromeLabel, getProviderCompatChromeLabel } from "./status-updater.ts";
import { formatTpsLabel } from "./tps.ts";

/**
 * 包装编辑器工厂，添加 editor chrome 装饰
 */
export function wrapEditorFactory(
  state: PluginState,
  config: AgentKitConfig,
  factory: EditorFactory | undefined,
): AgentKitEditorFactory {
  const wrapped = ((tui: any, theme: any, keybindings: any) => {
    state.tuiRef = tui;
    const editor = factory
      ? factory(tui, theme, keybindings)
      : new CustomEditor(tui, theme, keybindings);

    const originalRender = editor.render?.bind(editor);
    if (originalRender) {
      editor.render = (width: number) => {
        const theme = state.activeCtxRef?.ui?.theme as { fg?: (color: string, text: string) => string } | undefined;
        let workingLabel = "";
        const statusText = state.isWorking ? "esc interrupt" : "";
        if (statusText) {
          const bounce = workingSpinnerFrame(state, theme);
          let text = statusText;
          try {
            text = theme?.fg?.("muted", statusText) ?? statusText;
          } catch {
            text = statusText;
          }
          workingLabel = `${bounce} ${text}`;
        }
        return renderEditorChrome({
          width,
          enabled: config.editorChrome,
          context: state.activeCtxRef,
          thinkingLevel: state.activeThinkingLevel,
          providerCompatLabel: getProviderCompatChromeLabel(state.activeCtxRef, state.currentModelRef, config),
          fastLabel: getFastChromeLabel(state.activeCtxRef, state.currentModelRef, state.fastDesired, config.fast.supportedModels),
          workingElapsedLabel: formatWorkingElapsedMs(getWorkingElapsedMs(state)),
          tpsLabel: formatTpsLabel(state.tpsMeter.getTps()),
          showGitStatus: config.showGitStatus,
          showProjectDir: config.showProjectDir,
          display: config.chrome,
          workingLabel,
          borderColor: editor.borderColor,
          renderBase: originalRender,
        });
      };
    }

    return editor;
  }) as AgentKitEditorFactory;

  wrapped[AGENT_KIT_EDITOR_FACTORY] = true;
  return wrapped;
}

/**
 * 确保 editor factory wrapper 已安装
 */
export function ensureEditorFactoryInstalled(
  ctx: any,
  state: PluginState,
  config: AgentKitConfig,
): void {
  const existingFactory = ctx.ui.getEditorComponent?.() as AgentKitEditorFactory | undefined;
  if (existingFactory !== undefined && existingFactory[AGENT_KIT_EDITOR_FACTORY] !== true) {
    state.originalEditorFactory = existingFactory;
    state.wrappedEditorFactory = undefined;
  }

  state.wrappedEditorFactory ??= wrapEditorFactory(state, config, state.originalEditorFactory);
  if (existingFactory !== state.wrappedEditorFactory) {
    ctx.ui.setEditorComponent(state.wrappedEditorFactory);
  }
}
