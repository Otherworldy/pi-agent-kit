import { getKeybindings, matchesKey, truncateToWidth, type Component, type SettingsListTheme } from "@earendil-works/pi-tui";
import { EDITOR_CHROME_SLOTS, type EditorChromeDisplayConfig, type EditorChromeSlot } from "./config.ts";

type ChromeSide = "left" | "right" | "hidden";

const SLOT_SET = new Set<string>(EDITOR_CHROME_SLOTS);

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

const SIDE_TITLE: Record<ChromeSide, string> = {
  left: "Left",
  right: "Right",
  hidden: "Hidden",
};

function takeSlots(slots: unknown, seen: Set<EditorChromeSlot>): EditorChromeSlot[] {
  if (!Array.isArray(slots)) return [];
  const out: EditorChromeSlot[] = [];
  for (const item of slots) {
    if (typeof item !== "string" || !SLOT_SET.has(item)) continue;
    const slot = item as EditorChromeSlot;
    if (seen.has(slot)) continue;
    seen.add(slot);
    out.push(slot);
  }
  return out;
}

export function normalizeChromeDisplay(display: EditorChromeDisplayConfig): EditorChromeDisplayConfig {
  const seen = new Set<EditorChromeSlot>();
  return {
    left: takeSlots(display.left, seen),
    right: takeSlots(display.right, seen),
  };
}

export function chromeDisplayEqual(a: EditorChromeDisplayConfig, b: EditorChromeDisplayConfig): boolean {
  return a.left.length === b.left.length
    && a.right.length === b.right.length
    && a.left.every((slot, index) => slot === b.left[index])
    && a.right.every((slot, index) => slot === b.right[index]);
}

export function hiddenChromeSlots(display: EditorChromeDisplayConfig): EditorChromeSlot[] {
  const used = new Set<string>([...display.left, ...display.right]);
  return EDITOR_CHROME_SLOTS.filter((slot) => !used.has(slot));
}

export function chromeLayoutRows(display: EditorChromeDisplayConfig): Array<{ slot: EditorChromeSlot; side: ChromeSide }> {
  const next = normalizeChromeDisplay(display);
  return [
    ...next.left.map((slot) => ({ slot, side: "left" as const })),
    ...next.right.map((slot) => ({ slot, side: "right" as const })),
    ...hiddenChromeSlots(next).map((slot) => ({ slot, side: "hidden" as const })),
  ];
}

function joinSlots(slots: EditorChromeSlot[]): string {
  return slots.length > 0 ? slots.join(" · ") : "—";
}

export function formatChromeLayoutSummary(display: EditorChromeDisplayConfig): string {
  const next = normalizeChromeDisplay(display);
  return `${joinSlots(next.left)}  |  ${joinSlots(next.right)}`;
}

export function serializeChromeLayout(display: EditorChromeDisplayConfig): string {
  return JSON.stringify(normalizeChromeDisplay(display));
}

export function parseChromeLayoutValue(value: string): EditorChromeDisplayConfig | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as { left?: unknown; right?: unknown };
    return normalizeChromeDisplay({
      left: Array.isArray(record.left) ? record.left as EditorChromeSlot[] : [],
      right: Array.isArray(record.right) ? record.right as EditorChromeSlot[] : [],
    });
  } catch {
    return undefined;
  }
}

function slotSide(display: EditorChromeDisplayConfig, slot: EditorChromeSlot): ChromeSide {
  if (display.left.includes(slot)) return "left";
  if (display.right.includes(slot)) return "right";
  return "hidden";
}

export function cycleChromeSlotSide(display: EditorChromeDisplayConfig, slot: EditorChromeSlot): EditorChromeDisplayConfig {
  const next = normalizeChromeDisplay(display);
  const side = slotSide(next, slot);
  const left = next.left.filter((item) => item !== slot);
  const right = next.right.filter((item) => item !== slot);
  if (side === "left") right.push(slot);
  else if (side === "hidden") left.push(slot);
  return { left, right };
}

export function moveChromeSlot(display: EditorChromeDisplayConfig, slot: EditorChromeSlot, delta: -1 | 1): EditorChromeDisplayConfig {
  const next = normalizeChromeDisplay(display);
  const side = slotSide(next, slot);
  if (side === "hidden") return next;
  const list = side === "left" ? [...next.left] : [...next.right];
  const index = list.indexOf(slot);
  const swap = index + delta;
  if (index < 0 || swap < 0 || swap >= list.length) return next;
  const current = list[index]!;
  list[index] = list[swap]!;
  list[swap] = current;
  return side === "left" ? { left: list, right: next.right } : { left: next.left, right: list };
}

export interface ChromeLayoutEditorOptions {
  display: EditorChromeDisplayConfig;
  theme: SettingsListTheme;
  onConfirm: (display: EditorChromeDisplayConfig) => void;
  onCancel: () => void;
}

export class ChromeLayoutEditor implements Component {
  private readonly options: ChromeLayoutEditorOptions;
  private display: EditorChromeDisplayConfig;
  private selectedIndex = 0;

  constructor(options: ChromeLayoutEditorOptions) {
    this.options = options;
    this.display = normalizeChromeDisplay(options.display);
  }

  render(width: number): string[] {
    const rows = chromeLayoutRows(this.display);
    const lines: string[] = [];
    let lastSide: ChromeSide | undefined;

    rows.forEach((row, index) => {
      if (row.side !== lastSide) {
        if (lines.length > 0) lines.push("");
        lines.push(this.options.theme.hint(SIDE_TITLE[row.side]));
        lastSide = row.side;
      }
      const selected = index === this.selectedIndex;
      const prefix = selected ? this.options.theme.cursor : "  ";
      const label = this.options.theme.label(SLOT_LABELS[row.slot], selected);
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
    const rows = chromeLayoutRows(this.display);
    if (rows.length === 0) {
      if (kb.matches(data, "tui.select.cancel")) this.options.onCancel();
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
      this.display = cycleChromeSlotSide(this.display, selected.slot);
      this.selectedIndex = Math.max(0, chromeLayoutRows(this.display).findIndex((row) => row.slot === selected.slot));
      return;
    }
    if (data === "[" || matchesKey(data, "[")) {
      this.display = moveChromeSlot(this.display, selected.slot, -1);
      this.selectedIndex = Math.max(0, chromeLayoutRows(this.display).findIndex((row) => row.slot === selected.slot));
      return;
    }
    if (data === "]" || matchesKey(data, "]")) {
      this.display = moveChromeSlot(this.display, selected.slot, 1);
      this.selectedIndex = Math.max(0, chromeLayoutRows(this.display).findIndex((row) => row.slot === selected.slot));
    }
  }

  invalidate(): void {}
}
