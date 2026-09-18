import {
  chromeDisplayEqual,
  formatSlotLayoutSummary,
  type SlotGroups,
} from "./chrome-layout.ts";
import {
  BUILTIN_STATUS_KEYS,
  EMPTY_STATUS_BAR,
  STATUS_BAR_SIDES,
  type StatusBarDisplayConfig,
  type StatusBarSide,
} from "./config.ts";

export const OWN_STATUS_KEYS = new Set([
  "agent-kit-fast",
  "agent-kit-claude-code",
  "agent-kit-codex",
]);

export const STATUS_BAR_LABELS: Record<string, string> = {
  projectDir: "Project directory",
  git: "Git status",
};

export type ExtensionStatusItem = { key: string; text: string };
export type StatusBarCorners = Pick<StatusBarDisplayConfig, StatusBarSide>;

export type FooterDataLike = {
  getExtensionStatuses?: () => ReadonlyMap<string, string> | undefined;
};

export function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function isBuiltinStatusKey(key: string): boolean {
  return (BUILTIN_STATUS_KEYS as readonly string[]).includes(key);
}

export function isStatusBarAuto(config: StatusBarDisplayConfig): boolean {
  return STATUS_BAR_SIDES.every((side) => config[side].length === 0);
}

export function statusBarEqual(a: StatusBarDisplayConfig, b: StatusBarDisplayConfig): boolean {
  return STATUS_BAR_SIDES.every((side) => chromeDisplayEqual(
    { left: a[side], right: [] },
    { left: b[side], right: [] },
  )) && chromeDisplayEqual({ left: a.hidden, right: [] }, { left: b.hidden, right: [] });
}

export function collectExtensionStatuses(footerData: FooterDataLike | null | undefined): ExtensionStatusItem[] {
  const map = footerData?.getExtensionStatuses?.();
  if (!map) return [];
  const out: ExtensionStatusItem[] = [];
  for (const [key, text] of map.entries()) {
    if (!key || OWN_STATUS_KEYS.has(key) || isBuiltinStatusKey(key)) continue;
    const cleaned = sanitizeStatusText(typeof text === "string" ? text : String(text));
    if (!cleaned) continue;
    out.push({ key, text: cleaned });
  }
  return out;
}

export function listStatusBarKeys(
  footerData: FooterDataLike | null | undefined,
  statusBar: StatusBarDisplayConfig,
): string[] {
  const seen = new Set<string>(BUILTIN_STATUS_KEYS);
  const out: string[] = [...BUILTIN_STATUS_KEYS];
  const add = (key: string) => {
    if (!key || OWN_STATUS_KEYS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const item of collectExtensionStatuses(footerData)) add(item.key);
  for (const side of STATUS_BAR_SIDES) for (const key of statusBar[side]) add(key);
  for (const key of statusBar.hidden) add(key);
  return out;
}

export function resolveStatusBarLayout(
  config: StatusBarDisplayConfig,
  activeKeys: readonly string[],
): StatusBarCorners {
  const hidden = new Set(config.hidden);
  const active = activeKeys.filter((key) => key && !OWN_STATUS_KEYS.has(key) && !hidden.has(key));
  const used = new Set<string>();
  const take = (listed: string[]) => listed.filter((key) => {
    if (!active.includes(key) || used.has(key)) return false;
    used.add(key);
    return true;
  });
  const corners = {
    topLeft: take(config.topLeft),
    topRight: take(config.topRight),
    bottomLeft: take(config.bottomLeft),
    bottomRight: take(config.bottomRight),
  };
  const leftover = active.filter((key) => !used.has(key));
  corners.topLeft.push(...leftover.filter((key) => !isBuiltinStatusKey(key)).sort((a, b) => a.localeCompare(b)));
  corners.bottomRight.push(...BUILTIN_STATUS_KEYS.filter((key) => leftover.includes(key)));
  return corners;
}

export function formatStatusBarSummary(config: StatusBarDisplayConfig): string {
  if (isStatusBarAuto(config)) return "auto";
  return [
    formatSlotLayoutSummary({ left: config.topLeft, right: config.topRight }),
    formatSlotLayoutSummary({ left: config.bottomLeft, right: config.bottomRight }),
  ].join("  /  ");
}

export function serializeStatusBarLayout(config: StatusBarDisplayConfig): string {
  return JSON.stringify({
    topLeft: [...config.topLeft],
    topRight: [...config.topRight],
    bottomLeft: [...config.bottomLeft],
    bottomRight: [...config.bottomRight],
    hidden: [...config.hidden],
  });
}

function takeStatusKeys(slots: unknown, used: Set<string>): string[] {
  if (!Array.isArray(slots)) return [];
  const out: string[] = [];
  for (const item of slots) {
    if (typeof item !== "string" || !item || OWN_STATUS_KEYS.has(item) || used.has(item)) continue;
    used.add(item);
    out.push(item);
  }
  return out;
}

export function parseStatusBarLayoutValue(value: string): StatusBarDisplayConfig | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const used = new Set<string>();
    return {
      topLeft: takeStatusKeys(record.topLeft ?? record.left, used),
      topRight: takeStatusKeys(record.topRight ?? record.right, used),
      bottomLeft: takeStatusKeys(record.bottomLeft, used),
      bottomRight: takeStatusKeys(record.bottomRight, used),
      hidden: takeStatusKeys(record.hidden, used),
    };
  } catch {
    return undefined;
  }
}

export function statusBarFromGroups(display: SlotGroups, allSlots: readonly string[]): StatusBarDisplayConfig {
  const used = new Set<string>();
  const take = (side: StatusBarSide) => {
    const out: string[] = [];
    for (const key of display[side] ?? []) {
      if (!key || used.has(key)) continue;
      used.add(key);
      out.push(key);
    }
    return out;
  };
  return {
    topLeft: take("topLeft"),
    topRight: take("topRight"),
    bottomLeft: take("bottomLeft"),
    bottomRight: take("bottomRight"),
    hidden: allSlots.filter((key) => !used.has(key)),
  };
}

export { EMPTY_STATUS_BAR, STATUS_BAR_SIDES };
