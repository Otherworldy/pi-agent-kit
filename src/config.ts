import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface FooterFixedConfig {
  fixedEditor: boolean;
  mouseScroll: boolean;
  showExtensionStatus: boolean;
  taskCompletionNotification: boolean;
}

const DEFAULT_CONFIG: FooterFixedConfig = {
  fixedEditor: true,
  mouseScroll: true,
  showExtensionStatus: true,
  taskCompletionNotification: true,
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

function boolFromObject(value: unknown, key: keyof FooterFixedConfig): boolean | undefined {
  if (!isRecord(value)) return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return value[key] !== false;
  }
  return undefined;
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
  };
}

export function nextFooterFixedSetting(
  existingFooterFixedSetting: unknown,
  updates: Partial<FooterFixedConfig>,
): unknown {
  if (!isRecord(existingFooterFixedSetting)) {
    return { ...DEFAULT_CONFIG, ...updates };
  }
  return { ...existingFooterFixedSetting, ...updates };
}

export function writeFooterFixedSetting(
  cwd: string,
  updates: Partial<FooterFixedConfig>,
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
