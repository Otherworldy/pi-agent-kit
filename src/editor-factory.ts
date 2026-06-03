import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { PluginState, EditorFactory, FooterFixedEditorFactory } from "./plugin-state.ts";
import type { FooterFixedConfig } from "./config.ts";
import { FOOTER_FIXED_EDITOR_FACTORY } from "./plugin-state.ts";
import { renderEditorChrome } from "./editor-chrome.ts";
import { getFastChromeLabel, getProviderCompatChromeLabel } from "./status-updater.ts";
import { findContainerWithChild } from "./utils.ts";

/**
 * 包装编辑器工厂，添加Chrome装饰和固定编辑器支持
 */
export function wrapEditorFactory(
  ctx: any,
  state: PluginState,
  config: FooterFixedConfig,
  factory: EditorFactory | undefined,
  installWhenTuiReady: (ctx: any, tui: any) => void,
): FooterFixedEditorFactory {
  const wrapped = ((tui: any, theme: any, keybindings: any) => {
    const editor = factory
      ? factory(tui, theme, keybindings)
      : new CustomEditor(tui, theme, keybindings);

    const originalRender = editor.render?.bind(editor);
    if (originalRender) {
      editor.render = (width: number) => renderEditorChrome({
        width,
        enabled: config.editorChrome,
        context: state.activeCtxRef,
        thinkingLevel: state.activeThinkingLevel,
        providerCompatLabel: getProviderCompatChromeLabel(state.activeCtxRef, state.currentModelRef, config),
        fastLabel: getFastChromeLabel(state.activeCtxRef, state.currentModelRef, state.fastDesired, config.fast.supportedModels),
        borderColor: editor.borderColor,
        renderBase: originalRender,
      });
    }

    state.currentEditor = editor;

    // 拦截onSubmit，在提交时跳转到底部
    let inheritedOnSubmit = editor.onSubmit;
    Object.defineProperty(editor, "onSubmit", {
      configurable: true,
      get: () => inheritedOnSubmit,
      set(handler: unknown) {
        inheritedOnSubmit = typeof handler === "function"
          ? (text: string) => {
            state.fixedEditorCompositor?.jumpToRootBottom();
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

/**
 * 检查当前编辑器是否已挂载
 */
export function isCurrentEditorMounted(state: PluginState): boolean {
  return Boolean(state.tuiRef && state.currentEditor && findContainerWithChild(state.tuiRef, state.currentEditor));
}

/**
 * 确保编辑器工厂已安装
 */
export function ensureEditorFactoryInstalled(
  ctx: any,
  state: PluginState,
  config: FooterFixedConfig,
  installWhenTuiReady: (ctx: any, tui: any) => void,
): void {
  const existingFactory = ctx.ui.getEditorComponent?.() as FooterFixedEditorFactory | undefined;
  if (existingFactory !== undefined && existingFactory[FOOTER_FIXED_EDITOR_FACTORY] !== true) {
    state.originalEditorFactory = existingFactory;
    state.wrappedEditorFactory = undefined;
  }

  state.wrappedEditorFactory ??= wrapEditorFactory(ctx, state, config, state.originalEditorFactory, installWhenTuiReady);
  if (existingFactory !== state.wrappedEditorFactory || !isCurrentEditorMounted(state)) {
    ctx.ui.setEditorComponent(state.wrappedEditorFactory);
  }
}
