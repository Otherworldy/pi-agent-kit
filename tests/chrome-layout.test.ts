import test from "node:test";
import assert from "node:assert/strict";
import {
  ChromeLayoutEditor,
  chromeDisplayEqual,
  chromeLayoutRows,
  cycleChromeSlotSide,
  formatChromeLayoutSummary,
  hiddenChromeSlots,
  moveChromeSlot,
  normalizeChromeDisplay,
  parseChromeLayoutValue,
  serializeChromeLayout,
} from "../src/chrome-layout.ts";
import type { EditorChromeDisplayConfig, EditorChromeSlot } from "../src/config.ts";

const display: EditorChromeDisplayConfig = {
  left: ["model", "thinking", "timer"],
  right: ["cost", "context"],
};

const theme = {
  label: (text: string) => text,
  value: (text: string) => text,
  description: (text: string) => text,
  cursor: "› ",
  hint: (text: string) => text,
};

test("chrome layout helpers cycle side, reorder, hide, and serialize", () => {
  const base = normalizeChromeDisplay({
    left: ["model", "thinking", "model", "nope"] as EditorChromeSlot[],
    right: ["cost", "thinking", "context"],
  });
  assert.deepEqual(base, { left: ["model", "thinking"], right: ["cost", "context"] });
  assert.deepEqual(hiddenChromeSlots(base).slice(0, 3), ["timer", "tps", "ttft"]);

  assert.deepEqual(cycleChromeSlotSide(base, "model"), {
    left: ["thinking"],
    right: ["cost", "context", "model"],
  });
  assert.deepEqual(cycleChromeSlotSide(cycleChromeSlotSide(base, "model"), "model"), {
    left: ["thinking"],
    right: ["cost", "context"],
  });
  assert.deepEqual(cycleChromeSlotSide({ left: ["thinking"], right: ["cost"] }, "model"), {
    left: ["thinking", "model"],
    right: ["cost"],
  });

  assert.deepEqual(moveChromeSlot(base, "thinking", -1), {
    left: ["thinking", "model"],
    right: ["cost", "context"],
  });
  assert.deepEqual(moveChromeSlot(base, "model", -1), base);
  assert.deepEqual(moveChromeSlot(base, "timer", 1), base);

  const encoded = serializeChromeLayout(display);
  assert.deepEqual(parseChromeLayoutValue(encoded), { left: [...display.left], right: [...display.right] });
  assert.equal(parseChromeLayoutValue("nope"), undefined);
  assert.equal(formatChromeLayoutSummary({ left: [], right: [] }), "—  |  —");
  assert.equal(chromeDisplayEqual(base, { left: ["model", "thinking"], right: ["cost", "context"] }), true);
  assert.deepEqual(chromeLayoutRows(base).map((row) => row.side).slice(0, 4), ["left", "left", "right", "right"]);
});

test("chrome layout editor space cycles side, brackets move, enter saves", () => {
  const confirmed: unknown[] = [];
  const editor = new ChromeLayoutEditor({
    display: { left: ["model", "thinking"], right: ["cost"] },
    theme,
    onConfirm: (next) => confirmed.push(next),
    onCancel: () => confirmed.push("cancel"),
  });

  const before = editor.render(40).join("\n");
  assert.match(before, /Left/);
  assert.match(before, /Model/);

  editor.handleInput("]");
  editor.handleInput(" ");
  editor.handleInput("\r");

  assert.deepEqual(confirmed, [{
    left: ["thinking"],
    right: ["cost", "model"],
  }]);
});

test("chrome layout editor escape cancels without saving", () => {
  const events: unknown[] = [];
  const editor = new ChromeLayoutEditor({
    display: { left: ["model"], right: ["cost"] },
    theme,
    onConfirm: (next) => events.push(next),
    onCancel: () => events.push("cancel"),
  });
  editor.handleInput(" ");
  editor.handleInput("\x1b");
  assert.deepEqual(events, ["cancel"]);
});
