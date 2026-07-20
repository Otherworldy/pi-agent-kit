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

  // 输入区外左下角 status 指示（working / compacting）
  isWorking: boolean;
  /** agent_start 时刻；仅 working 期间推进，idle 为 null */
  workingStartedAt: number | null;
  /** 上一次 working 冻结时长；idle 时持续展示 */
  lastWorkingElapsedMs: number;
  isCompacting: boolean;
  compactingLabel: string | null;
  workingSpinnerIndex: number;
  workingSpinnerTimer: ReturnType<typeof setInterval> | null;

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
    isWorking: false,
    workingStartedAt: null,
    lastWorkingElapsedMs: 0,
    isCompacting: false,
    compactingLabel: null,
    workingSpinnerIndex: 0,
    workingSpinnerTimer: null,
    lastContinueFailure: null,
    pendingContinueRequest: null,
  };
}

// Long dual-dot bounce track (● travels L→R→L across dim dots).
const WORKING_BOUNCE_LEN = 6;
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
    case "off":
    default:
      return "thinkingOff";
  }
}

/** Build ping-pong frames: ●······· ·●······ … ·······● … ·●······ */
function bounceFrames(length: number): string[] {
  const n = Math.max(3, length);
  const frames: string[] = [];
  for (let i = 0; i < n; i += 1) {
    frames.push("∙".repeat(i) + "●" + "∙".repeat(n - 1 - i));
  }
  // reverse without duplicating endpoints
  for (let i = n - 2; i >= 1; i -= 1) {
    frames.push("∙".repeat(i) + "●" + "∙".repeat(n - 1 - i));
  }
  return frames;
}

const WORKING_BOUNCE_FRAMES = bounceFrames(WORKING_BOUNCE_LEN);

function stopStatusSpinnerTimer(state: PluginState): void {
  if (state.workingSpinnerTimer) {
    clearInterval(state.workingSpinnerTimer);
    state.workingSpinnerTimer = null;
  }
}

/** Keep bounce timer alive while working and/or compacting. */
export function ensureStatusSpinner(state: PluginState): void {
  if (state.workingSpinnerTimer) return;
  state.workingSpinnerIndex = 0;
  state.workingSpinnerTimer = setInterval(() => {
    state.workingSpinnerIndex = (state.workingSpinnerIndex + 1) % WORKING_BOUNCE_FRAMES.length;
    state.fixedEditorCompositor?.requestRepaint();
    state.tuiRef?.requestRender?.();
  }, WORKING_TICK_MS);
}

function maybeStopStatusSpinner(state: PluginState): void {
  if (!state.isWorking && !state.isCompacting) stopStatusSpinnerTimer(state);
}

export function startWorkingSpinner(state: PluginState): void {
  state.isWorking = true;
  state.workingStartedAt = Date.now();
  ensureStatusSpinner(state);
}

export function stopWorkingSpinner(state: PluginState): void {
  if (state.workingStartedAt != null) {
    state.lastWorkingElapsedMs = Math.max(0, Date.now() - state.workingStartedAt);
    state.workingStartedAt = null;
  }
  state.isWorking = false;
  maybeStopStatusSpinner(state);
}

/** Live while working, else last frozen working duration. */
export function getWorkingElapsedMs(state: PluginState, now = Date.now()): number {
  if (state.workingStartedAt != null) return Math.max(0, now - state.workingStartedAt);
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

export function setCompactingStatus(state: PluginState, label: string | null): void {
  if (label) {
    state.isCompacting = true;
    state.compactingLabel = label;
    ensureStatusSpinner(state);
    return;
  }
  state.isCompacting = false;
  state.compactingLabel = null;
  maybeStopStatusSpinner(state);
}

/** Strip ANSI + OSC sequences for plain-text matching. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\][^\u0007]*\u0007/g, "")
    .replace(/\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * Relocate built-in compaction loader lines out of statusContainer into external chrome.
 * Returns filtered lines + compacting label (null when not compacting).
 */
export function peelCompactingStatusLines(lines: string[]): { filtered: string[]; label: string | null } {
  const plain = lines.map((line) => stripAnsi(line));
  const idx = plain.findIndex((line) => /compact(ing)?/i.test(line));
  if (idx === -1) return { filtered: lines, label: null };

  // Drop spinner glyph when present: "⠋ Compacting context..." (not multi-word prefixes).
  const raw = plain[idx].trim();
  const spinnerPrefix = raw.match(/^(\S{1,2})\s+(.+)$/);
  const label = (spinnerPrefix?.[2] && /compact/i.test(spinnerPrefix[2])
    ? spinnerPrefix[2]
    : raw) || "Compacting context...";

  const filtered = lines.filter((_, i) => {
    const p = plain[i].trim();
    if (!p) return false; // Loader adds a blank pad line
    if (/compact(ing)?/i.test(p)) return false;
    return true;
  });
  return { filtered, label };
}

export function workingSpinnerFrame(
  state: PluginState,
  theme?: { fg?: (color: string, text: string) => string } | null,
): string {
  const frame = WORKING_BOUNCE_FRAMES[state.workingSpinnerIndex % WORKING_BOUNCE_FRAMES.length]
    ?? "●" + "∙".repeat(WORKING_BOUNCE_LEN - 1);
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
  setCompactingStatus(state, null);
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
  stopWorkingSpinner(state);
  setCompactingStatus(state, null);
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
