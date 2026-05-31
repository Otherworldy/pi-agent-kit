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
  metadataUserId: string;
  systemIdentity: boolean;
  systemText: string;
}

export interface CodexCompatConfig extends ProviderCompatConfig {
  promptCacheKey: string;
  store: boolean;
}

export interface FooterFixedConfig {
  fixedEditor: boolean;
  mouseScroll: boolean;
  showExtensionStatus: boolean;
  taskCompletionNotification: boolean;
  editorChrome: boolean;
  fast: FastModeConfig;
  claudeCodeCompat: ProviderCompatConfig;
  codexCompat: CodexCompatConfig;
}

export type FooterFixedBooleanSettingKey =
  | "fixedEditor"
  | "mouseScroll"
  | "showExtensionStatus"
  | "taskCompletionNotification"
  | "editorChrome"
  | "fast.enabled";

export type FooterFixedConfigUpdates = Partial<Omit<FooterFixedConfig, "fast" | "claudeCodeCompat" | "codexCompat">> & {
  fast?: Partial<FastModeConfig>;
  claudeCodeCompat?: Partial<ProviderCompatConfig>;
  codexCompat?: Partial<CodexCompatConfig>;
};

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

const DEFAULT_CONFIG: FooterFixedConfig = {
  fixedEditor: true,
  mouseScroll: true,
  showExtensionStatus: true,
  taskCompletionNotification: true,
  editorChrome: true,
  fast: {
    enabled: false,
    persistState: true,
    serviceTier: "priority",
    supportedModels: [...DEFAULT_FAST_SUPPORTED_MODELS],
  },
  claudeCodeCompat: {
    enabled: false,
    providers: [],
    supportedModels: [],
    headers: { ...DEFAULT_CLAUDE_CODE_COMPAT_HEADERS },
    metadataUserId: "pi-agent",
    systemIdentity: true,
    systemText: DEFAULT_CLAUDE_CODE_SYSTEM_TEXT,
  },
  codexCompat: {
    enabled: false,
    providers: [],
    supportedModels: [],
    headers: { ...DEFAULT_CODEX_COMPAT_HEADERS },
    metadataUserId: "pi-agent",
    systemIdentity: false,
    systemText: DEFAULT_CODEX_SYSTEM_TEXT,
    promptCacheKey: "pi-agent",
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
      console.debug(`[pi-footer-fixed] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }

    return parsed;
  } catch (error) {
    console.debug(`[pi-footer-fixed] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

function readWritableSettingsFile(settingsPath: string): Record<string, unknown> | null {
  if (!existsSync(settingsPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[pi-footer-fixed] Refusing to write settings to non-object file at ${settingsPath}`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.debug(`[pi-footer-fixed] Failed to parse settings at ${settingsPath}:`, error);
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

function parseFastConfig(footerFixed: unknown): FastModeConfig {
  const fast = isRecord(footerFixed) ? footerFixed.fast : undefined;

  return {
    enabled: boolFromObject(fast, "enabled")
      ?? boolFromObject(footerFixed, "fastMode")
      ?? DEFAULT_CONFIG.fast.enabled,
    persistState: boolFromObject(fast, "persistState") ?? DEFAULT_CONFIG.fast.persistState,
    serviceTier: stringFromObject(fast, "serviceTier", DEFAULT_CONFIG.fast.serviceTier),
    supportedModels: stringArrayFromObject(fast, "supportedModels", DEFAULT_CONFIG.fast.supportedModels),
  };
}

function parseProviderCompatConfig(
  footerFixed: unknown,
  key: "claudeCodeCompat" | "codexCompat",
): ProviderCompatConfig {
  const rawConfig = isRecord(footerFixed) ? footerFixed[key] : undefined;
  const configured = isRecord(rawConfig);
  const defaults = DEFAULT_CONFIG[key];

  return {
    enabled: configured ? (boolFromObject(rawConfig, "enabled") ?? true) : defaults.enabled,
    providers: stringArrayFromObject(rawConfig, "providers", defaults.providers),
    supportedModels: stringArrayFromObject(rawConfig, "supportedModels", defaults.supportedModels),
    headers: stringRecordFromObject(rawConfig, "headers", defaults.headers),
    metadataUserId: stringFromObject(rawConfig, "metadataUserId", defaults.metadataUserId),
    systemIdentity: boolFromObject(rawConfig, "systemIdentity") ?? defaults.systemIdentity,
    systemText: stringFromObject(rawConfig, "systemText", defaults.systemText),
  };
}

function parseCodexCompatConfig(footerFixed: unknown): CodexCompatConfig {
  const base = parseProviderCompatConfig(footerFixed, "codexCompat");
  const rawConfig = isRecord(footerFixed) ? footerFixed.codexCompat : undefined;

  return {
    ...base,
    promptCacheKey: stringFromObject(rawConfig, "promptCacheKey", DEFAULT_CONFIG.codexCompat.promptCacheKey),
    store: boolFromObject(rawConfig, "store") ?? DEFAULT_CONFIG.codexCompat.store,
  };
}

export function parseFooterFixedConfig(settings: Record<string, unknown>): FooterFixedConfig {
  const footerFixed = settings.footerFixed;
  const powerline = settings.powerline;

  return {
    fixedEditor: boolFromObject(footerFixed, "fixedEditor")
      ?? boolFromObject(powerline, "fixedEditor")
      ?? DEFAULT_CONFIG.fixedEditor,
    mouseScroll: boolFromObject(footerFixed, "mouseScroll")
      ?? boolFromObject(powerline, "mouseScroll")
      ?? DEFAULT_CONFIG.mouseScroll,
    showExtensionStatus: boolFromObject(footerFixed, "showExtensionStatus")
      ?? DEFAULT_CONFIG.showExtensionStatus,
    taskCompletionNotification: boolFromObject(footerFixed, "taskCompletionNotification")
      ?? DEFAULT_CONFIG.taskCompletionNotification,
    editorChrome: boolFromObject(footerFixed, "editorChrome")
      ?? DEFAULT_CONFIG.editorChrome,
    fast: parseFastConfig(footerFixed),
    claudeCodeCompat: parseProviderCompatConfig(footerFixed, "claudeCodeCompat"),
    codexCompat: parseCodexCompatConfig(footerFixed),
  };
}

export function nextFooterFixedSetting(
  existingFooterFixedSetting: unknown,
  updates: FooterFixedConfigUpdates,
): unknown {
  const existing = isRecord(existingFooterFixedSetting) ? existingFooterFixedSetting : DEFAULT_CONFIG;
  return mergeSettings(existing as Record<string, unknown>, updates as Record<string, unknown>);
}

export function writeFooterFixedSetting(
  cwd: string,
  updates: FooterFixedConfigUpdates,
): boolean {
  const globalSettingsPath = getSettingsPath();
  const projectSettingsPath = getProjectSettingsPath(cwd);
  const globalSettings = readWritableSettingsFile(globalSettingsPath);
  const projectSettings = readWritableSettingsFile(projectSettingsPath);

  if (globalSettings === null || projectSettings === null) return false;

  const writeToProject = Object.prototype.hasOwnProperty.call(projectSettings, "footerFixed");
  const settingsPath = writeToProject ? projectSettingsPath : globalSettingsPath;
  const settings = writeToProject ? projectSettings : globalSettings;

  settings.footerFixed = nextFooterFixedSetting(settings.footerFixed, updates);

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[pi-footer-fixed] Failed to persist setting to ${settingsPath}:`, error);
    return false;
  }
}
