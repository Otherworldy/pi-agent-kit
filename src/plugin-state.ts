import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { TerminalSplitCompositor } from "./fixed-editor/terminal-split.ts";
import type { AgentKitConfig } from "./config.ts";
import type { ContinueFailureSnapshot } from "./continue-mode.ts";

/**
 * 插件状态管理
 * 封装所有模块级变量，避免全局状态污染
 */
export interface PluginState {
  // TUI和编辑器引用
  tuiRef: any | null;
  currentEditor: any | null;
  activeCtxRef: ExtensionContext | null;
  footerDataRef: ReadonlyFooterDataProvider | null;

  // 编辑器工厂
  originalEditorFactory: EditorFactory | undefined;
  wrappedEditorFactory: AgentKitEditorFactory | undefined;

  // Compositor状态
  fixedEditorCompositor: TerminalSplitCompositor | null;
  fixedStatusContainer: any | null;
  fixedEditorContainer: any | null;
  fixedWidgetContainerAbove: any | null;
  fixedWidgetContainerBelow: any | null;

  // 安装重试状态
  needsFixedEditorReinstall: boolean;
  installRetryQueued: boolean;
  installRetryAttempts: number;
  installRetryTimer: ReturnType<typeof setTimeout> | null;
  installStabilizationTimers: Set<ReturnType<typeof setTimeout>>;

  // 模型和配置状态
  activeThinkingLevel: string;
  currentModelRef: any | null;
  fastDesired: boolean;

  // 提供商兼容性状态
  registeredClaudeCodeCompatProviders: Set<string>;
  registeredCodexCompatProviders: Set<string>;
  previousCompatProviderConfigs: Map<string, ProviderRequestConfig | null>;

  // 任务完成通知状态
  taskCompletionErrorNotificationTimer: ReturnType<typeof setTimeout> | null;

  // /continue失败恢复状态
  lastContinueFailure: ContinueFailureSnapshot | null;
  pendingContinueRequest: ContinuePendingRequest | null;
}

export type EditorFactory = (tui: any, theme: any, keybindings: any) => any;
export type AgentKitEditorFactory = EditorFactory & { [AGENT_KIT_EDITOR_FACTORY]?: true };

export const AGENT_KIT_EDITOR_FACTORY = Symbol("pi-agent-kit.editorFactory");

export interface ProviderRequestConfig {
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
}

export interface ContinuePendingRequest {
  id: string;
  failureFingerprint: string;
  startedAt: number;
  contextApplied: boolean;
}

function clearTaskCompletionErrorNotificationTimer(state: PluginState): void {
  if (!state.taskCompletionErrorNotificationTimer) return;
  clearTimeout(state.taskCompletionErrorNotificationTimer);
  state.taskCompletionErrorNotificationTimer = null;
}

/**
 * 创建初始插件状态
 */
export function createPluginState(): PluginState {
  return {
    tuiRef: null,
    currentEditor: null,
    activeCtxRef: null,
    footerDataRef: null,
    originalEditorFactory: undefined,
    wrappedEditorFactory: undefined,
    fixedEditorCompositor: null,
    fixedStatusContainer: null,
    fixedEditorContainer: null,
    fixedWidgetContainerAbove: null,
    fixedWidgetContainerBelow: null,
    needsFixedEditorReinstall: false,
    installRetryQueued: false,
    installRetryAttempts: 0,
    installRetryTimer: null,
    installStabilizationTimers: new Set(),
    activeThinkingLevel: "off",
    currentModelRef: null,
    fastDesired: false,
    registeredClaudeCodeCompatProviders: new Set(),
    registeredCodexCompatProviders: new Set(),
    previousCompatProviderConfigs: new Map(),
    taskCompletionErrorNotificationTimer: null,
    lastContinueFailure: null,
    pendingContinueRequest: null,
  };
}

/**
 * 重置插件状态（用于session_start）
 */
export function resetPluginState(state: PluginState): void {
  clearTaskCompletionErrorNotificationTimer(state);
  state.needsFixedEditorReinstall = false;
  state.installRetryAttempts = 0;
  state.currentEditor = null;
  state.tuiRef = null;
  state.footerDataRef = null;
  state.lastContinueFailure = null;
  state.pendingContinueRequest = null;
}

/**
 * 清理插件状态（用于session_shutdown）
 */
export function cleanupPluginState(state: PluginState): void {
  clearTaskCompletionErrorNotificationTimer(state);
  state.installRetryAttempts = 0;
  state.registeredClaudeCodeCompatProviders = new Set();
  state.registeredCodexCompatProviders = new Set();
  state.previousCompatProviderConfigs.clear();
  state.tuiRef = null;
  state.currentEditor = null;
  state.activeCtxRef = null;
  state.footerDataRef = null;
  state.currentModelRef = null;
  state.lastContinueFailure = null;
  state.pendingContinueRequest = null;
}
