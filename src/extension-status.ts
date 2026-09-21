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
  "widget-above": "Widget above",
  "widget-below": "Widget below",
};

export const WIDGET_ABOVE_KEY = "widget-above";
export const WIDGET_BELOW_KEY = "widget-below";

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

function takeStatusItem(key: string, text: unknown, merged: Map<string, string>): void {
  if (!key || OWN_STATUS_KEYS.has(key) || isBuiltinStatusKey(key)) return;
  const cleaned = sanitizeStatusText(typeof text === "string" ? text : String(text));
  if (!cleaned) return;
  const prev = merged.get(key);
  merged.set(key, prev ? `${prev} · ${cleaned}` : cleaned);
}

export function collectExtensionStatuses(
  footerData: FooterDataLike | null | undefined,
  extra?: ReadonlyMap<string, string>,
): ExtensionStatusItem[] {
  const merged = new Map<string, string>();
  const map = footerData?.getExtensionStatuses?.();
  if (map) for (const [key, text] of map.entries()) takeStatusItem(key, text, merged);
  if (extra) for (const [key, text] of extra.entries()) takeStatusItem(key, text, merged);
  return [...merged].map(([key, text]) => ({ key, text }));
}

export function listStatusBarKeys(
  footerData: FooterDataLike | null | undefined,
  statusBar: StatusBarDisplayConfig,
  extra?: ReadonlyMap<string, string>,
): string[] {
  const seen = new Set<string>(BUILTIN_STATUS_KEYS);
  const out: string[] = [...BUILTIN_STATUS_KEYS];
  const add = (key: string) => {
    if (!key || OWN_STATUS_KEYS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const item of collectExtensionStatuses(footerData, extra)) add(item.key);
  for (const side of STATUS_BAR_SIDES) for (const key of statusBar[side]) add(key);
  for (const key of statusBar.hidden) add(key);
  return out;
}

/** Hide native string widgets; factories pass through. */
export function applyWidgetStatus(
  map: Map<string, string>,
  key: string,
  content: unknown,
): "hide" | "passthrough" {
  if (!key || OWN_STATUS_KEYS.has(key)) return "passthrough";
  if (typeof content === "function") {
    map.delete(key);
    return "passthrough";
  }
  if (content === undefined) {
    map.delete(key);
    return "hide";
  }
  if (!Array.isArray(content)) return "passthrough";
  const text = content.map((line) => sanitizeStatusText(String(line))).filter(Boolean).join(" · ");
  if (text) map.set(key, text);
  else map.delete(key);
  return "hide";
}

function collectNodeText(node: { text?: unknown; children?: unknown[] }, out: string[]): void {
  if (typeof node?.text === "string") {
    const cleaned = sanitizeStatusText(node.text);
    if (cleaned) out.push(cleaned);
  }
  if (Array.isArray(node?.children)) {
    for (const child of node.children) {
      if (child && typeof child === "object") collectNodeText(child as { text?: unknown; children?: unknown[] }, out);
    }
  }
}

/** Global extensions run session_start before packages, so leftover widgets must be scraped then cleared.
 * Pi's renderWidgetContainer rebuilds each widget container from the extension
 * widget maps on every renderWidgets(), so clearing once is enough: harvested
 * string widgets are already deleted via setWidget(key, undefined), and later
 * factory widgets (e.g. pi-processes) keep rendering normally. */
export function harvestAndBlankWidgetContainers(
  tui: { children?: unknown[] } | null | undefined,
  editor: unknown,
  map: Map<string, string>,
): void {
  const children = tui?.children;
  if (!Array.isArray(children) || editor == null) return;
  const idx = children.findIndex((child) => {
    if (child === editor) return true;
    const nested = (child as { children?: unknown[] } | null)?.children;
    return Array.isArray(nested) && nested.includes(editor);
  });
  if (idx < 0) return;
  const pairs: Array<[unknown, string]> = [
    [children[idx - 1], WIDGET_ABOVE_KEY],
    [children[idx + 1], WIDGET_BELOW_KEY],
  ];
  for (const [node, key] of pairs) {
    if (!node || typeof node !== "object") continue;
    const container = node as { render?: (width: number) => string[]; clear?: () => void; children?: unknown[] };
    if (typeof container.render !== "function") continue;
    const texts: string[] = [];
    collectNodeText(container, texts);
    const text = texts.join(" · ");
    if (text) map.set(key, text);
    if (typeof container.clear === "function") container.clear();
    else if (Array.isArray(container.children)) container.children.length = 0;
  }
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
