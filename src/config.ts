import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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

export interface AgentKitConfig {
  fixedEditor: boolean;
  mouseScroll: boolean;
  showExtensionStatus: boolean;
  showGitStatus: boolean;
  taskCompletionNotification: boolean;
  notificationChannels: NotificationChannelsConfig;
  editorChrome: boolean;
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

export type AgentKitConfigUpdates = Partial<Omit<AgentKitConfig, "fast" | "notificationChannels" | "providerCompat" | "claudeCodeCompat" | "codexCompat">> & {
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

export const DEFAULT_CODEX_COMPAT_HEADERS = {
  Originator: process.env.PI_CODEX_COMPAT_ORIGINATOR || "codex_cli_rs",
  "User-Agent": process.env.PI_CODEX_COMPAT_USER_AGENT || `codex_cli_rs/${process.env.PI_CODEX_COMPAT_VERSION || "0.132.0"} (${process.platform}; ${process.arch}) node`,
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

function getSettingsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(homeDir, ".pi", "agent", "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
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
  return mergeSettings(readSettingsFile(getSettingsPath()), readSettingsFile(getProjectSettingsPath(cwd)));
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
