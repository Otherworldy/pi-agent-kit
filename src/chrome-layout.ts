import { getKeybindings, matchesKey, truncateToWidth, type Component, type SettingsListTheme } from "@earendil-works/pi-tui";
import { EDITOR_CHROME_SLOTS, type EditorChromeDisplayConfig, type EditorChromeSlot } from "./config.ts";

export type SlotLayout = { left: string[]; right: string[] };
export type SlotGroups = { [side: string]: string[] | undefined };

const CHROME_SIDES = ["left", "right"] as const;

const SLOT_LABELS: Record<EditorChromeSlot, string> = {
  model: "Model",
  thinking: "Thinking",
  timer: "Timer",
  tps: "TPS",
  ttft: "TTFT",
  providerCompat: "Compat",
  fast: "Fast",
  context: "Context",
  cost: "Cost",
};

const SIDE_TITLE: Record<string, string> = {
  left: "Left",
  right: "Right",
  topLeft: "Top left",
  topRight: "Top right",
  bottomLeft: "Bottom left",
  bottomRight: "Bottom right",
  hidden: "Hidden",
};

function takeListedSlots(slots: unknown, allowed: Set<string>, seen: Set<string>): string[] {
  if (!Array.isArray(slots)) return [];
  const out: string[] = [];
  for (const item of slots) {
    if (typeof item !== "string" || !allowed.has(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function normalizeSlotGroups(
  display: SlotGroups,
  allSlots: readonly string[],
  sides: readonly string[],
): SlotGroups {
  const allowed = new Set(allSlots);
  const seen = new Set<string>();
  const out: SlotGroups = {};
  for (const side of sides) out[side] = takeListedSlots(display[side], allowed, seen);
  return out;
}

export function hiddenSlotsFromGroups(
  display: SlotGroups,
  allSlots: readonly string[],
  sides: readonly string[],
): string[] {
  const used = new Set<string>();
  for (const side of sides) {
    for (const slot of display[side] ?? []) used.add(slot);
  }
  return allSlots.filter((slot) => !used.has(slot));
}

export function slotGroupRows(
  display: SlotGroups,
  allSlots: readonly string[],
  sides: readonly string[],
): Array<{ slot: string; side: string }> {
  const next = normalizeSlotGroups(display, allSlots, sides);
  return [
    ...sides.flatMap((side) => (next[side] ?? []).map((slot) => ({ slot, side }))),
    ...hiddenSlotsFromGroups(next, allSlots, sides).map((slot) => ({ slot, side: "hidden" })),
  ];
}

function slotGroupSide(display: SlotGroups, slot: string, sides: readonly string[]): string {
  for (const side of sides) {
    if (display[side]?.includes(slot)) return side;
  }
  return "hidden";
}

export function cycleSlotGroupSide(
  display: SlotGroups,
  slot: string,
  allSlots: readonly string[],
  sides: readonly string[],
): SlotGroups {
  const next = normalizeSlotGroups(display, allSlots, sides);
  const order = [...sides, "hidden"];
  const dest = order[(order.indexOf(slotGroupSide(next, slot, sides)) + 1) % order.length]!;
  const out: SlotGroups = {};
  for (const side of sides) out[side] = (next[side] ?? []).filter((item) => item !== slot);
  if (dest !== "hidden") out[dest] = [...(out[dest] ?? []), slot];
  return out;
}

export function moveSlotInGroup(
  display: SlotGroups,
  slot: string,
  delta: -1 | 1,
  allSlots: readonly string[],
  sides: readonly string[],
): SlotGroups {
  const next = normalizeSlotGroups(display, allSlots, sides);
  const side = slotGroupSide(next, slot, sides);
  if (side === "hidden") return next;
  const list = [...(next[side] ?? [])];
  const index = list.indexOf(slot);
  const swap = index + delta;
  if (index < 0 || swap < 0 || swap >= list.length) return next;
  const current = list[index]!;
  list[index] = list[swap]!;
  list[swap] = current;
  return { ...next, [side]: list };
}

export function normalizeSlotLayout(display: SlotLayout, allSlots: readonly string[]): SlotLayout {
  const next = normalizeSlotGroups(display, allSlots, CHROME_SIDES);
  return { left: next.left ?? [], right: next.right ?? [] };
}

export function normalizeChromeDisplay(display: object): EditorChromeDisplayConfig {
  const groups = display as SlotGroups;
  const next = normalizeSlotLayout({ left: groups.left ?? [], right: groups.right ?? [] }, EDITOR_CHROME_SLOTS);
  return { left: next.left as EditorChromeSlot[], right: next.right as EditorChromeSlot[] };
}

export function chromeDisplayEqual(a: SlotLayout, b: SlotLayout): boolean {
  return a.left.length === b.left.length
    && a.right.length === b.right.length
    && a.left.every((slot, index) => slot === b.left[index])
    && a.right.every((slot, index) => slot === b.right[index]);
}

export function hiddenSlots(display: SlotLayout, allSlots: readonly string[]): string[] {
  return hiddenSlotsFromGroups(display, allSlots, CHROME_SIDES);
}

export function hiddenChromeSlots(display: EditorChromeDisplayConfig): EditorChromeSlot[] {
  return hiddenSlots(display, EDITOR_CHROME_SLOTS) as EditorChromeSlot[];
}

export function slotLayoutRows(display: SlotLayout, allSlots: readonly string[]): Array<{ slot: string; side: string }> {
  return slotGroupRows(display, allSlots, CHROME_SIDES);
}

export function chromeLayoutRows(display: EditorChromeDisplayConfig): Array<{ slot: EditorChromeSlot; side: string }> {
  return slotLayoutRows(display, EDITOR_CHROME_SLOTS) as Array<{ slot: EditorChromeSlot; side: string }>;
}

function joinSlots(slots: string[]): string {
  return slots.length > 0 ? slots.join(" · ") : "—";
}

export function formatSlotLayoutSummary(display: SlotLayout): string {
  return `${joinSlots(display.left)}  |  ${joinSlots(display.right)}`;
}

export function formatChromeLayoutSummary(display: EditorChromeDisplayConfig): string {
  return formatSlotLayoutSummary(normalizeChromeDisplay(display));
}

export function serializeChromeLayout(display: object): string {
  return JSON.stringify(normalizeChromeDisplay(display));
}

export function parseChromeLayoutValue(value: string): EditorChromeDisplayConfig | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as { left?: unknown; right?: unknown };
    return normalizeChromeDisplay({
      left: Array.isArray(record.left) ? record.left as string[] : [],
      right: Array.isArray(record.right) ? record.right as string[] : [],
    });
  } catch {
    return undefined;
  }
}

export function cycleSlotSide(display: SlotLayout, slot: string, allSlots: readonly string[]): SlotLayout {
  const next = cycleSlotGroupSide(display, slot, allSlots, CHROME_SIDES);
  return { left: next.left ?? [], right: next.right ?? [] };
}

export function cycleChromeSlotSide(display: EditorChromeDisplayConfig, slot: EditorChromeSlot): EditorChromeDisplayConfig {
  const next = cycleSlotSide(display, slot, EDITOR_CHROME_SLOTS);
  return { left: next.left as EditorChromeSlot[], right: next.right as EditorChromeSlot[] };
}

export function moveSlot(display: SlotLayout, slot: string, delta: -1 | 1, allSlots: readonly string[]): SlotLayout {
  const next = moveSlotInGroup(display, slot, delta, allSlots, CHROME_SIDES);
  return { left: next.left ?? [], right: next.right ?? [] };
}

export function moveChromeSlot(display: EditorChromeDisplayConfig, slot: EditorChromeSlot, delta: -1 | 1): EditorChromeDisplayConfig {
  const next = moveSlot(display, slot, delta, EDITOR_CHROME_SLOTS);
  return { left: next.left as EditorChromeSlot[], right: next.right as EditorChromeSlot[] };
}

export interface ChromeLayoutEditorOptions {
  display: object;
  allSlots?: readonly string[];
  sides?: readonly string[];
  labels?: Record<string, string>;
  emptyHint?: string;
  theme: SettingsListTheme;
  onConfirm: (display: SlotGroups) => void;
  onCancel: () => void;
}

export class ChromeLayoutEditor implements Component {
  private readonly options: ChromeLayoutEditorOptions;
  private readonly allSlots: readonly string[];
  private readonly sides: readonly string[];
  private display: SlotGroups;
  private selectedIndex = 0;

  constructor(options: ChromeLayoutEditorOptions) {
    this.options = options;
    this.allSlots = options.allSlots ?? EDITOR_CHROME_SLOTS;
    this.sides = options.sides ?? CHROME_SIDES;
    this.display = normalizeSlotGroups(options.display as SlotGroups, this.allSlots, this.sides);
  }

  private labelFor(slot: string): string {
    return this.options.labels?.[slot] ?? SLOT_LABELS[slot as EditorChromeSlot] ?? slot;
  }

  private rows() {
    return slotGroupRows(this.display, this.allSlots, this.sides);
  }

  render(width: number): string[] {
    const rows = this.rows();
    const lines: string[] = [];
    let lastSide: string | undefined;

    if (rows.length === 0) {
      lines.push(this.options.theme.hint(this.options.emptyHint ?? "  No slots available"));
    }

    rows.forEach((row, index) => {
      if (row.side !== lastSide) {
        if (lines.length > 0) lines.push("");
        lines.push(this.options.theme.hint(SIDE_TITLE[row.side] ?? row.side));
        lastSide = row.side;
      }
      const selected = index === this.selectedIndex;
      const prefix = selected ? this.options.theme.cursor : "  ";
      const label = this.options.theme.label(this.labelFor(row.slot), selected);
      lines.push(truncateToWidth(`${prefix}${label}`, width));
    });

    lines.push("");
    lines.push(truncateToWidth(
      this.options.theme.hint("  ↑↓ select · Space side · [ ] move · Enter save · Esc"),
      width,
    ));
    return lines;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    const rows = this.rows();
    if (rows.length === 0) {
      if (kb.matches(data, "tui.select.confirm")) this.options.onConfirm(this.display);
      else if (kb.matches(data, "tui.select.cancel")) this.options.onCancel();
      return;
    }

    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex = this.selectedIndex === 0 ? rows.length - 1 : this.selectedIndex - 1;
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex = this.selectedIndex === rows.length - 1 ? 0 : this.selectedIndex + 1;
      return;
    }
    if (kb.matches(data, "tui.select.confirm")) {
      this.options.onConfirm(this.display);
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) {
      this.options.onCancel();
      return;
    }

    const selected = rows[this.selectedIndex];
    if (!selected) return;

    if (data === " " || matchesKey(data, "space")) {
      this.display = cycleSlotGroupSide(this.display, selected.slot, this.allSlots, this.sides);
      this.selectedIndex = Math.max(0, this.rows().findIndex((row) => row.slot === selected.slot));
      return;
    }
    if (data === "[" || matchesKey(data, "[")) {
      this.display = moveSlotInGroup(this.display, selected.slot, -1, this.allSlots, this.sides);
      this.selectedIndex = Math.max(0, this.rows().findIndex((row) => row.slot === selected.slot));
      return;
    }
    if (data === "]" || matchesKey(data, "]")) {
      this.display = moveSlotInGroup(this.display, selected.slot, 1, this.allSlots, this.sides);
      this.selectedIndex = Math.max(0, this.rows().findIndex((row) => row.slot === selected.slot));
    }
  }

  invalidate(): void {}
}
