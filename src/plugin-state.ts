import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContinueFailureSnapshot } from "./continue-mode.ts";

/**
 * 插件状态管理
 * 封装所有模块级变量，避免全局状态污染
 */
export interface PluginState {
  // TUI引用
  tuiRef: any | null;
  activeCtxRef: ExtensionContext | null;

  // 编辑器工厂
  originalEditorFactory: EditorFactory | undefined;
  wrappedEditorFactory: AgentKitEditorFactory | undefined;

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

  // 输入区外左下角 status 指示（working / compacting）
  isWorking: boolean;
  /** agent_start 时刻；仅 working 期间推进，idle 为 null */
  workingStartedAt: number | null;
  /** 上一次 working 冻结时长；idle 时持续展示 */
  lastWorkingElapsedMs: number;
  workingSpinnerIndex: number;
  workingSpinnerTimer: ReturnType<typeof setInterval> | null;

  // /continue失败恢复状态
  lastContinueFailure: ContinueFailureSnapshot | null;
  pendingContinueRequest: ContinuePendingRequest | null;
}

export type EditorFactory = (tui: any, theme: any, keybindings: any) => any;
export type AgentKitEditorFactory = EditorFactory & {
  [AGENT_KIT_EDITOR_FACTORY]?: true;
};

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
    activeCtxRef: null,
    originalEditorFactory: undefined,
    wrappedEditorFactory: undefined,
    activeThinkingLevel: "off",
    currentModelRef: null,
    fastDesired: false,
    registeredClaudeCodeCompatProviders: new Set(),
    registeredCodexCompatProviders: new Set(),
    previousCompatProviderConfigs: new Map(),
    taskCompletionErrorNotificationTimer: null,
    isWorking: false,
    workingStartedAt: null,
    lastWorkingElapsedMs: 0,
    workingSpinnerIndex: 0,
    workingSpinnerTimer: null,
    lastContinueFailure: null,
    pendingContinueRequest: null,
  };
}

const WORKING_SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"] as const;
const WORKING_TICK_MS = 100;

function thinkingFgColor(level: string): string {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    case "off":
    default:
      return "thinkingOff";
  }
}

function stopStatusSpinnerTimer(state: PluginState): void {
  if (state.workingSpinnerTimer) {
    clearInterval(state.workingSpinnerTimer);
    state.workingSpinnerTimer = null;
  }
}

/** Keep spinner timer alive while working and/or compacting. */
export function ensureStatusSpinner(state: PluginState): void {
  if (state.workingSpinnerTimer) return;
  state.workingSpinnerIndex = 0;
  state.workingSpinnerTimer = setInterval(() => {
    state.workingSpinnerIndex =
      (state.workingSpinnerIndex + 1) % WORKING_SPINNER_FRAMES.length;
    state.tuiRef?.requestRender?.();
  }, WORKING_TICK_MS);
}

function maybeStopStatusSpinner(state: PluginState): void {
  if (!state.isWorking) stopStatusSpinnerTimer(state);
}

export function startWorkingSpinner(state: PluginState): void {
  state.isWorking = true;
  state.workingStartedAt = Date.now();
  ensureStatusSpinner(state);
}

export function stopWorkingSpinner(state: PluginState): void {
  if (state.workingStartedAt != null) {
    state.lastWorkingElapsedMs = Math.max(
      0,
      Date.now() - state.workingStartedAt,
    );
    state.workingStartedAt = null;
  }
  state.isWorking = false;
  maybeStopStatusSpinner(state);
}

/** Live while working, else last frozen working duration. */
export function getWorkingElapsedMs(
  state: PluginState,
  now = Date.now(),
): number {
  if (state.workingStartedAt != null)
    return Math.max(0, now - state.workingStartedAt);
  return state.lastWorkingElapsedMs;
}

/** Whole seconds: `12s` / `1m 05s`. */
export function formatWorkingElapsedMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function workingSpinnerFrame(
  state: PluginState,
  theme?: { fg?: (color: string, text: string) => string } | null,
): string {
  const frame =
    WORKING_SPINNER_FRAMES[
      state.workingSpinnerIndex % WORKING_SPINNER_FRAMES.length
    ] ?? "⠋";
  const color = thinkingFgColor(state.activeThinkingLevel || "off");
  try {
    return theme?.fg?.(color, frame) ?? frame;
  } catch {
    return frame;
  }
}

/**
 * 重置插件状态（用于session_start）
 */
export function resetPluginState(state: PluginState): void {
  clearTaskCompletionErrorNotificationTimer(state);
  stopWorkingSpinner(state);
  state.tuiRef = null;
  state.lastContinueFailure = null;
  state.pendingContinueRequest = null;
}

/**
 * 清理插件状态（用于session_shutdown）
 */
export function cleanupPluginState(state: PluginState): void {
  clearTaskCompletionErrorNotificationTimer(state);
  stopWorkingSpinner(state);
  state.registeredClaudeCodeCompatProviders = new Set();
  state.registeredCodexCompatProviders = new Set();
  state.previousCompatProviderConfigs.clear();
  state.tuiRef = null;
  state.activeCtxRef = null;
  state.currentModelRef = null;
  state.lastContinueFailure = null;
  state.pendingContinueRequest = null;
}
