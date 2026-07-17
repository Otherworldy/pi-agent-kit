import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, release } from "node:os";

export interface FastModeConfig {
  enabled: boolean;
  persistState: boolean;
  serviceTier: string;
  supportedModels: string[];
}

export interface ProviderCompatConfig {
  enabled: boolean;
  providers: string[];
  supportedModels: string[];
  headers: Record<string, string>;
  systemIdentity: boolean;
  systemText: string;
}

export interface CodexCompatConfig extends ProviderCompatConfig {
  store: boolean;
}

export interface WindowsToastNotificationChannelConfig {
  enabled: boolean;
}

export interface TelegramNotificationChannelConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  apiBaseUrl: string;
  timeoutMs: number;
}

export interface NotificationChannelsConfig {
  windowsToast: WindowsToastNotificationChannelConfig;
  telegram: TelegramNotificationChannelConfig;
}

export interface ProviderCompatSwitchConfig {
  enabled: boolean;
  claudeCodeHeaders: Record<string, string>;
  codexHeaders: Record<string, string>;
}

/** Meta-line field ids. Place each in chrome.left / chrome.right to show (order = display order). */
export type EditorChromeSlot =
  | "model"
  | "thinking"
  | "providerCompat"
  | "fast"
  | "context"
  | "cost";

export const EDITOR_CHROME_SLOTS: readonly EditorChromeSlot[] = [
  "model",
  "thinking",
  "providerCompat",
  "fast",
  "context",
  "cost",
] as const;

/** left/right slot lists control side + order; omit a slot to hide it. */
export interface EditorChromeDisplayConfig {
  left: EditorChromeSlot[];
  right: EditorChromeSlot[];
}

export interface AgentKitConfig {
  fixedEditor: boolean;
  mouseScroll: boolean;
  showExtensionStatus: boolean;
  showGitStatus: boolean;
  taskCompletionNotification: boolean;
  notificationChannels: NotificationChannelsConfig;
  editorChrome: boolean;
  /** Meta-line layout: which fields on left/right and in what order. */
  chrome: EditorChromeDisplayConfig;
  fast: FastModeConfig;
  providerCompat: ProviderCompatSwitchConfig;
  claudeCodeCompat: ProviderCompatConfig;
  codexCompat: CodexCompatConfig;
}

export type AgentKitBooleanSettingKey =
  | "fixedEditor"
  | "mouseScroll"
  | "showExtensionStatus"
  | "showGitStatus"
  | "taskCompletionNotification"
  | "notificationChannels.windowsToast.enabled"
  | "notificationChannels.telegram.enabled"
  | "editorChrome"
  | "providerCompat"
  | "fast.enabled";

export type AgentKitConfigUpdates = Partial<Omit<AgentKitConfig, "chrome" | "fast" | "notificationChannels" | "providerCompat" | "claudeCodeCompat" | "codexCompat">> & {
  chrome?: Partial<EditorChromeDisplayConfig>;
  fast?: Partial<FastModeConfig>;
  notificationChannels?: {
    windowsToast?: Partial<WindowsToastNotificationChannelConfig>;
    telegram?: Partial<TelegramNotificationChannelConfig>;
  };
  providerCompat?: Partial<ProviderCompatSwitchConfig>;
  claudeCodeCompat?: Partial<ProviderCompatConfig>;
  codexCompat?: Partial<CodexCompatConfig>;
};

const AGENT_KIT_SETTINGS_KEY = "agentKit";

export const DEFAULT_FAST_SUPPORTED_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
] as const;

export const DEFAULT_CLAUDE_CODE_COMPAT_HEADERS = {
  "User-Agent": "claude-cli/2.1.75 (external, cli)",
  "X-App": "cli",
  "X-Stainless-Arch": process.env.PI_CLAUDE_CODE_COMPAT_ARCH || process.arch,
  "X-Stainless-Lang": "js",
  "X-Stainless-Os": process.env.PI_CLAUDE_CODE_COMPAT_OS || process.platform,
  "X-Stainless-Package-Version": process.env.PI_CLAUDE_CODE_COMPAT_VERSION || "2.1.75",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Runtime-Version": process.env.PI_CLAUDE_CODE_COMPAT_RUNTIME_VERSION || process.versions.node,
  "X-Stainless-Timeout": "600",
  "Anthropic-Version": "2023-06-01",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
} as const;

export const DEFAULT_CLAUDE_CODE_SYSTEM_TEXT = "You are Claude Code, Anthropic's official CLI for Claude.";

/** Matches openai/codex `get_codex_user_agent`: `{originator}/{version} ({os_type} {os_version}; {arch}) {terminal}`. */
export function buildCodexUserAgent(options?: {
  originator?: string;
  version?: string;
  platform?: NodeJS.Platform | string;
  arch?: string;
  osVersion?: string;
  terminal?: string;
}): string {
  const originator = options?.originator || process.env.PI_CODEX_COMPAT_ORIGINATOR || "codex_cli_rs";
  const version = options?.version || process.env.PI_CODEX_COMPAT_VERSION || "0.144.5";
  const platform = options?.platform || process.platform;
  const osType = platform === "darwin" ? "Mac OS" : platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : String(platform);
  const osVersion = options?.osVersion || process.env.PI_CODEX_COMPAT_OS_VERSION || release();
  const archRaw = options?.arch || process.arch;
  const arch = archRaw === "x64" ? "x86_64" : archRaw === "ia32" ? "x86" : archRaw;
  const program = process.env.TERM_PROGRAM?.trim();
  const programVersion = process.env.TERM_PROGRAM_VERSION?.trim();
  const terminal = options?.terminal
    || process.env.PI_CODEX_COMPAT_TERMINAL
    || (program ? (programVersion ? `${program}/${programVersion}` : program) : process.env.TERM?.trim() || "unknown");
  return `${originator}/${version} (${osType} ${osVersion}; ${arch}) ${terminal}`;
}

export const DEFAULT_CODEX_COMPAT_HEADERS = {
  Originator: process.env.PI_CODEX_COMPAT_ORIGINATOR || "codex_cli_rs",
  "User-Agent": process.env.PI_CODEX_COMPAT_USER_AGENT || buildCodexUserAgent(),
  "OpenAI-Beta": "responses=experimental",
  "X-Codex-Beta-Features": process.env.PI_CODEX_COMPAT_BETA_FEATURES || "",
  "X-Codex-Turn-Metadata": "",
} as const;

export const DEFAULT_CODEX_SYSTEM_TEXT = "You are Codex CLI, OpenAI's official coding agent.";

const DEFAULT_CONFIG: AgentKitConfig = {
  fixedEditor: true,
  mouseScroll: true,
  showExtensionStatus: true,
  showGitStatus: true,
  taskCompletionNotification: true,
  notificationChannels: {
    windowsToast: {
      enabled: true,
    },
    telegram: {
      enabled: false,
      apiBaseUrl: "https://api.telegram.org",
      timeoutMs: 5000,
    },
  },
  editorChrome: true,
  chrome: {
    left: ["model", "thinking", "providerCompat", "fast"],
    right: ["cost", "context"],
  },
  fast: {
    enabled: false,
    persistState: true,
    serviceTier: "priority",
    supportedModels: [...DEFAULT_FAST_SUPPORTED_MODELS],
  },
  providerCompat: {
    enabled: true,
    claudeCodeHeaders: { ...DEFAULT_CLAUDE_CODE_COMPAT_HEADERS },
    codexHeaders: { ...DEFAULT_CODEX_COMPAT_HEADERS },
  },
  claudeCodeCompat: {
    enabled: false,
    providers: [],
    supportedModels: [],
    headers: { ...DEFAULT_CLAUDE_CODE_COMPAT_HEADERS },
    systemIdentity: true,
    systemText: DEFAULT_CLAUDE_CODE_SYSTEM_TEXT,
  },
  codexCompat: {
    enabled: false,
    providers: [],
    supportedModels: [],
    headers: { ...DEFAULT_CODEX_COMPAT_HEADERS },
    systemIdentity: false,
    systemText: DEFAULT_CODEX_SYSTEM_TEXT,
    store: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSettings(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isRecord(baseValue) && isRecord(overrideValue)
      ? mergeSettings(baseValue, overrideValue)
      : overrideValue;
  }

  return merged;
}

function getPiAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (configured && configured.trim()) {
    if (configured === "~") return join(homedir(), ".pi", "agent");
    if (configured.startsWith("~/") || configured.startsWith("~\\")) {
      return join(homedir(), configured.slice(2));
    }
    return configured;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent");
}

function getSettingsPath(): string {
  return join(getPiAgentDir(), "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

/** Canonical extension config; also accepts legacy typo dir `pi-agent-ket`. */
export function getExtensionConfigPath(): string {
  const extensionsDir = join(getPiAgentDir(), "extensions");
  const kit = join(extensionsDir, "pi-agent-kit", "config.json");
  const ket = join(extensionsDir, "pi-agent-ket", "config.json");
  if (existsSync(kit)) return kit;
  if (existsSync(ket)) return ket;
  return kit;
}

function readExtensionConfig(): Record<string, unknown> {
  return readSettingsFile(getExtensionConfigPath());
}

function readSettingsFile(settingsPath: string): Record<string, unknown> {
  try {
    if (!existsSync(settingsPath)) return {};

    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[pi-agent-kit] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }

    return parsed;
  } catch (error) {
    console.debug(`[pi-agent-kit] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function readWritableSettingsFile(settingsPath: string): Record<string, unknown> | null {
  if (!existsSync(settingsPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[pi-agent-kit] Refusing to write settings to non-object file at ${settingsPath}`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.debug(`[pi-agent-kit] Failed to parse settings at ${settingsPath}:`, error);
    return null;
  }
}

export function readSettings(cwd: string = process.cwd()): Record<string, unknown> {
  // Extension config.json is flat (no agentKit wrapper). settings.json nests under agentKit.
  // Merge order (later wins): global settings → extension config → project settings.
  // Extension sits above global so ~/.pi/agent/extensions/pi-agent-kit/config.json is authoritative;
  // project .pi/settings.json can still override per-repo.
  const extension = readExtensionConfig();
  const globalSettings = readSettingsFile(getSettingsPath());
  const projectSettings = readSettingsFile(getProjectSettingsPath(cwd));
  const settings = mergeSettings(globalSettings, projectSettings);

  const globalAgentKit = isRecord(globalSettings[AGENT_KIT_SETTINGS_KEY])
    ? globalSettings[AGENT_KIT_SETTINGS_KEY] as Record<string, unknown>
    : {};
  const projectAgentKit = isRecord(projectSettings[AGENT_KIT_SETTINGS_KEY])
    ? projectSettings[AGENT_KIT_SETTINGS_KEY] as Record<string, unknown>
    : {};
  const agentKit = mergeSettings(mergeSettings(globalAgentKit, extension), projectAgentKit);

  return {
    ...settings,
    [AGENT_KIT_SETTINGS_KEY]: agentKit,
  };
}

function boolFromObject(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return value[key] !== false;
  }
  return undefined;
}

function stringFromObject(value: unknown, key: string, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const item = value[key];
  return typeof item === "string" ? item : fallback;
}

function optionalStringFromObject(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item : undefined;
}

function optionalChatIdFromObject(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  if (typeof item === "string" && item.trim().length > 0) return item;
  if (typeof item === "number" && Number.isFinite(item)) return String(item);
  return undefined;
}

function numberFromObject(value: unknown, key: string, fallback: number, min = 0): number {
  if (!isRecord(value)) return fallback;
  const item = value[key];
  if (typeof item !== "number" || !Number.isFinite(item)) return fallback;
  return item >= min ? item : fallback;
}

function stringArrayFromObject(value: unknown, key: string, fallback: readonly string[]): string[] {
  if (!isRecord(value)) return [...fallback];
  const item = value[key];
  if (!Array.isArray(item)) return [...fallback];
  const strings = item.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return strings.length > 0 ? strings : [...fallback];
}

function stringRecordFromObject(value: unknown, key: string, fallback: Readonly<Record<string, string>>): Record<string, string> {
  if (!isRecord(value)) return { ...fallback };
  const item = value[key];
  if (!isRecord(item)) return { ...fallback };

  const strings = Object.fromEntries(
    Object.entries(item).filter((entry): entry is [string, string] => (
      typeof entry[0] === "string" && entry[0].trim().length > 0 && typeof entry[1] === "string"
    )),
  );
  return { ...fallback, ...strings };
}

function nestedHeaderRecordFromObject(
  value: unknown,
  directKey: string,
  nestedKey: string,
  fallback: Readonly<Record<string, string>>,
): Record<string, string> {
  const directHeaders = stringRecordFromObject(value, directKey, fallback);
  const nestedConfig = isRecord(value) ? value[nestedKey] : undefined;
  return stringRecordFromObject(nestedConfig, "headers", directHeaders);
}

function parseFastConfig(agentKit: unknown): FastModeConfig {
  const fast = isRecord(agentKit) ? agentKit.fast : undefined;

  return {
    enabled: boolFromObject(fast, "enabled")
      ?? boolFromObject(agentKit, "fastMode")
      ?? DEFAULT_CONFIG.fast.enabled,
    persistState: boolFromObject(fast, "persistState") ?? DEFAULT_CONFIG.fast.persistState,
    serviceTier: stringFromObject(fast, "serviceTier", DEFAULT_CONFIG.fast.serviceTier),
    supportedModels: stringArrayFromObject(fast, "supportedModels", DEFAULT_CONFIG.fast.supportedModels),
  };
}

const CHROME_SLOT_SET = new Set<string>(EDITOR_CHROME_SLOTS);

function parseChromeSlots(value: unknown, fallback: readonly EditorChromeSlot[]): EditorChromeSlot[] {
  if (!Array.isArray(value)) return [...fallback];
  const slots: EditorChromeSlot[] = [];
  for (const item of value) {
    if (typeof item === "string" && CHROME_SLOT_SET.has(item)) {
      slots.push(item as EditorChromeSlot);
    }
  }
  return slots;
}

function parseChromeDisplayConfig(agentKit: unknown): EditorChromeDisplayConfig {
  const chrome = isRecord(agentKit) && isRecord(agentKit.chrome) ? agentKit.chrome : undefined;
  const d = DEFAULT_CONFIG.chrome;
  if (!chrome) return { left: [...d.left], right: [...d.right] };

  // Preferred: { left: [...], right: [...] }
  if (Array.isArray(chrome.left) || Array.isArray(chrome.right)) {
    return {
      left: parseChromeSlots(chrome.left, d.left),
      right: parseChromeSlots(chrome.right, d.right),
    };
  }

  // Legacy boolean map: filter default sides by false flags.
  const keep = (slot: EditorChromeSlot) => {
    if (!Object.prototype.hasOwnProperty.call(chrome, slot)) return true;
    return chrome[slot] !== false;
  };
  return {
    left: d.left.filter(keep),
    right: d.right.filter(keep),
  };
}

function parseNotificationChannelsConfig(agentKit: unknown): NotificationChannelsConfig {
  const channels = isRecord(agentKit) ? agentKit.notificationChannels : undefined;
  const windowsToast = isRecord(channels) ? channels.windowsToast : undefined;
  const telegram = isRecord(channels) && isRecord(channels.telegram)
    ? channels.telegram
    : isRecord(agentKit)
      ? agentKit.telegramNotification
      : undefined;

  return {
    windowsToast: {
      enabled: boolFromObject(windowsToast, "enabled")
        ?? boolFromObject(agentKit, "taskCompletionNotification")
        ?? DEFAULT_CONFIG.notificationChannels.windowsToast.enabled,
    },
    telegram: {
      enabled: boolFromObject(telegram, "enabled") ?? DEFAULT_CONFIG.notificationChannels.telegram.enabled,
      botToken: optionalStringFromObject(telegram, "botToken"),
      chatId: optionalChatIdFromObject(telegram, "chatId"),
      apiBaseUrl: stringFromObject(telegram, "apiBaseUrl", DEFAULT_CONFIG.notificationChannels.telegram.apiBaseUrl),
      timeoutMs: numberFromObject(telegram, "timeoutMs", DEFAULT_CONFIG.notificationChannels.telegram.timeoutMs, 1),
    },
  };
}

function parseProviderCompatSwitchConfig(agentKit: unknown): ProviderCompatSwitchConfig {
  const providerCompat = isRecord(agentKit) ? agentKit.providerCompat : undefined;

  return {
    enabled: DEFAULT_CONFIG.providerCompat.enabled,
    claudeCodeHeaders: nestedHeaderRecordFromObject(
      providerCompat,
      "claudeCodeHeaders",
      "claudeCode",
      DEFAULT_CONFIG.providerCompat.claudeCodeHeaders,
    ),
    codexHeaders: nestedHeaderRecordFromObject(
      providerCompat,
      "codexHeaders",
      "codex",
      DEFAULT_CONFIG.providerCompat.codexHeaders,
    ),
  };
}

function parseProviderCompatConfig(
  agentKit: unknown,
  key: "claudeCodeCompat" | "codexCompat",
  enabled: boolean,
  headers: Record<string, string>,
): ProviderCompatConfig {
  const rawConfig = isRecord(agentKit) ? agentKit[key] : undefined;
  const defaults = DEFAULT_CONFIG[key];

  return {
    enabled,
    providers: [...defaults.providers],
    supportedModels: [...defaults.supportedModels],
    headers: stringRecordFromObject(rawConfig, "headers", headers),
    systemIdentity: boolFromObject(rawConfig, "systemIdentity") ?? defaults.systemIdentity,
    systemText: stringFromObject(rawConfig, "systemText", defaults.systemText),
  };
}

function parseCodexCompatConfig(
  agentKit: unknown,
  enabled: boolean,
  headers: Record<string, string>,
): CodexCompatConfig {
  const base = parseProviderCompatConfig(agentKit, "codexCompat", enabled, headers);
  const rawConfig = isRecord(agentKit) ? agentKit.codexCompat : undefined;

  return {
    ...base,
    store: boolFromObject(rawConfig, "store") ?? DEFAULT_CONFIG.codexCompat.store,
  };
}

function getAgentKitSettings(settings: Record<string, unknown>): unknown {
  return settings[AGENT_KIT_SETTINGS_KEY];
}

function hasAgentKitSettings(settings: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(settings, AGENT_KIT_SETTINGS_KEY);
}

export function parseAgentKitConfig(settings: Record<string, unknown>): AgentKitConfig {
  const agentKit = getAgentKitSettings(settings);
  const powerline = settings.powerline;
  const providerCompat = parseProviderCompatSwitchConfig(agentKit);

  return {
    fixedEditor: boolFromObject(agentKit, "fixedEditor")
      ?? boolFromObject(powerline, "fixedEditor")
      ?? DEFAULT_CONFIG.fixedEditor,
    mouseScroll: boolFromObject(agentKit, "mouseScroll")
      ?? boolFromObject(powerline, "mouseScroll")
      ?? DEFAULT_CONFIG.mouseScroll,
    showExtensionStatus: boolFromObject(agentKit, "showExtensionStatus")
      ?? DEFAULT_CONFIG.showExtensionStatus,
    showGitStatus: boolFromObject(agentKit, "showGitStatus")
      ?? DEFAULT_CONFIG.showGitStatus,
    taskCompletionNotification: boolFromObject(agentKit, "taskCompletionNotification")
      ?? DEFAULT_CONFIG.taskCompletionNotification,
    notificationChannels: parseNotificationChannelsConfig(agentKit),
    editorChrome: boolFromObject(agentKit, "editorChrome")
      ?? DEFAULT_CONFIG.editorChrome,
    chrome: parseChromeDisplayConfig(agentKit),
    fast: parseFastConfig(agentKit),
    providerCompat,
    claudeCodeCompat: parseProviderCompatConfig(
      agentKit,
      "claudeCodeCompat",
      providerCompat.enabled,
      providerCompat.claudeCodeHeaders,
    ),
    codexCompat: parseCodexCompatConfig(
      agentKit,
      providerCompat.enabled,
      providerCompat.codexHeaders,
    ),
  };
}

export function nextAgentKitSetting(
  existingAgentKitSetting: unknown,
  updates: AgentKitConfigUpdates,
): unknown {
  const existing = isRecord(existingAgentKitSetting) ? existingAgentKitSetting : {};
  return mergeSettings(existing as Record<string, unknown>, updates as Record<string, unknown>);
}

export function writeAgentKitSetting(
  cwd: string,
  updates: AgentKitConfigUpdates,
): boolean {
  const extensionPath = getExtensionConfigPath();
  const extensionExists = existsSync(extensionPath);

  // Prefer dedicated extension config when present (or default kit path once created).
  // Fall back to project/global settings.json for tests / legacy installs without extension dir.
  if (extensionExists || !hasAgentKitSettings(readSettingsFile(getProjectSettingsPath(cwd)))) {
    const existing = readWritableSettingsFile(extensionPath);
    if (existing === null) return false;
    const next = nextAgentKitSetting(existing, updates);
    try {
      mkdirSync(dirname(extensionPath), { recursive: true });
      writeFileSync(extensionPath, JSON.stringify(next, null, 2) + "\n");
      return true;
    } catch (error) {
      console.debug(`[pi-agent-kit] Failed to persist setting to ${extensionPath}:`, error);
      return false;
    }
  }

  const globalSettingsPath = getSettingsPath();
  const projectSettingsPath = getProjectSettingsPath(cwd);
  const globalSettings = readWritableSettingsFile(globalSettingsPath);
  const projectSettings = readWritableSettingsFile(projectSettingsPath);

  if (globalSettings === null || projectSettings === null) return false;

  const writeToProject = hasAgentKitSettings(projectSettings);
  const settingsPath = writeToProject ? projectSettingsPath : globalSettingsPath;
  const settings = writeToProject ? projectSettings : globalSettings;

  settings[AGENT_KIT_SETTINGS_KEY] = nextAgentKitSetting(settings[AGENT_KIT_SETTINGS_KEY], updates);

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[pi-agent-kit] Failed to persist setting to ${settingsPath}:`, error);
    return false;
  }
}
