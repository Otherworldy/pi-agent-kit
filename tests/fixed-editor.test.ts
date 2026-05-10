import test from "node:test";
import assert from "node:assert/strict";
import { TUI, visibleWidth } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, renderFixedEditorCluster, type FixedEditorClusterRender } from "../src/fixed-editor/cluster.ts";
import {
  buildFixedClusterPaint,
  emergencyTerminalModeReset,
  endSynchronizedOutput,
  beginSynchronizedOutput,
  moveCursor,
  resetScrollRegion,
  setScrollRegion,
  TerminalSplitCompositor,
} from "../src/fixed-editor/terminal-split.ts";

class FakeTerminal {
  columns = 40;
  private rowCount = 12;
  writes: string[] = [];

  get rows(): number {
    return this.rowCount;
  }

  setRows(rows: number): void {
    this.rowCount = rows;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  hideCursor(): void {}

  showCursor(): void {}
}

test("fixed cluster keeps the editor visible before optional rows", () => {
  const rendered = renderFixedEditorCluster({
    width: 80,
    terminalRows: 6,
    statusLines: ["status"],
    topLines: ["top"],
    editorLines: ["edit-a", `edit-b ${CURSOR_MARKER}`, "edit-c"],
    secondaryLines: ["secondary"],
    transcriptLines: ["old-1", "old-2"],
    lastPromptLines: ["last"],
  });

  assert.deepEqual(rendered.lines, ["top", "edit-a", "edit-b ", "edit-c", "secondary"]);
  assert.deepEqual(rendered.cursor, { row: 2, col: 7 });
});

test("fixed cluster caps oversized editor around the cursor", () => {
  const rendered = renderFixedEditorCluster({
    width: 80,
    terminalRows: 4,
    statusLines: ["status"],
    editorLines: ["edit-a", "edit-b", `edit-c ${CURSOR_MARKER}`, "edit-d", "edit-e"],
    transcriptLines: ["old"],
  });

  assert.deepEqual(rendered.lines, ["edit-a", "edit-b", "edit-c "]);
  assert.deepEqual(rendered.cursor, { row: 2, col: 7 });
});

test("fixed cluster caps selector-style editor replacements around the selected row", () => {
  const rendered = renderFixedEditorCluster({
    width: 80,
    terminalRows: 4,
    editorLines: [
      "title",
      "  option-a",
      "  option-b",
      "\x1b[38;5;39m→ \x1b[0m\x1b[38;5;39moption-c\x1b[0m",
      "  option-d",
      "hint",
    ],
  });

  assert.deepEqual(rendered.lines, ["  option-b", "\x1b[38;5;39m→ \x1b[0m\x1b[38;5;39moption-c\x1b[0m", "  option-d"]);
});

test("terminal split can render a hidden status container in the fixed cluster", () => {
  const terminal = new FakeTerminal();
  const status = {
    text: "⠏ Working...",
    render() {
      return ["", this.text];
    },
  };
  const editor = {
    render() {
      return ["editor"];
    },
  };
  const tui = {
    terminal,
    render() {
      return ["chat"];
    },
    doRender() {
      this.terminal.write("body");
    },
  };

  let compositor!: TerminalSplitCompositor;
  compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    getShowHardwareCursor: () => false,
    renderCluster: (width): FixedEditorClusterRender => ({
      lines: [
        ...compositor.renderHidden(status, width).filter((line: string) => visibleWidth(line) > 0),
        ...compositor.renderHidden(editor, width),
      ],
      cursor: null,
    }),
  });

  compositor.hideRenderable(status);
  compositor.hideRenderable(editor);
  compositor.install();

  assert.deepEqual(status.render(), []);
  tui.doRender();
  assert.ok(terminal.writes.at(-1)?.includes("⠏ Working..."));

  status.text = "⠙ Working...";
  compositor.requestRepaint();
  assert.ok(terminal.writes.at(-1)?.includes("⠙ Working..."));

  compositor.dispose();
  assert.deepEqual(status.render(), ["", "⠙ Working..."]);
});

test("terminal split escape helpers generate DEC scroll region controls", () => {
  assert.equal(beginSynchronizedOutput(), "\x1b[?2026h");
  assert.equal(endSynchronizedOutput(), "\x1b[?2026l");
  assert.equal(setScrollRegion(1, 18), "\x1b[1;18r");
  assert.equal(resetScrollRegion(), "\x1b[r");
  assert.equal(moveCursor(20, 3), "\x1b[20;3H");
  assert.ok(emergencyTerminalModeReset().includes("\x1b[r"));
});

test("fixed cluster paint clears bottom rows and positions hardware cursor", () => {
  const paint = buildFixedClusterPaint(
    { lines: ["top", "edit"], cursor: { row: 1, col: 2 } },
    10,
    20,
    true,
  );

  assert.match(paint, /^\x1b\[r/);
  assert.ok(paint.includes("\x1b[9;1H\x1b[2Ktop"));
  assert.ok(paint.includes("\x1b[10;1H\x1b[2Kedit"));
  assert.ok(paint.endsWith("\x1b[10;3H\x1b[?25h"));
});

test("terminal split reserves rows, hides root renderables, repaints, and cleans up", () => {
  const terminal = new FakeTerminal();
  const hidden = {
    render(width: number) {
      return [`hidden:${width}`];
    },
  };
  const tui = {
    terminal,
    hardwareCursorRow: 2,
    cursorRow: 2,
    previousViewportTop: 0,
    rendered: 0,
    doRender() {
      this.rendered += 1;
      this.terminal.write("body");
    },
  };

  let compositor!: TerminalSplitCompositor;
  compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    getShowHardwareCursor: () => false,
    renderCluster: (width): FixedEditorClusterRender => ({
      lines: [`cluster:${width}`, ...compositor.renderHidden(hidden, width)],
      cursor: null,
    }),
  });

  compositor.hideRenderable(hidden);
  compositor.install();

  assert.deepEqual(hidden.render(40), []);
  assert.equal(terminal.rows, 10);

  tui.doRender();

  assert.equal(tui.rendered, 1);
  assert.equal(terminal.writes.length, 3);
  assert.ok(terminal.writes[0]?.includes("\x1b[?1049h"));
  assert.ok(terminal.writes[0]?.includes("\x1b[?1007l"));
  assert.ok(terminal.writes[0]?.includes("\x1b[?1002h"));
  assert.ok(terminal.writes[0]?.includes("\x1b[?1006h"));
  assert.ok(terminal.writes[1]?.includes("\x1b[1;10r\x1b[3;1Hbody"));
  assert.ok(terminal.writes[1]?.includes("cluster:40"));
  assert.ok(terminal.writes[1]?.includes("hidden:40"));
  assert.ok(terminal.writes[2]?.includes("cluster:40"));

  compositor.dispose();

  assert.deepEqual(hidden.render(8), ["hidden:8"]);
  assert.equal(terminal.rows, 12);
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[r"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1006l"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1002l"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1000l"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1007h"));
  assert.ok(terminal.writes.at(-1)?.includes("\x1b[?1049l"));
});

test("terminal row reservation does not recurse when hidden editor render reads terminal rows", () => {
  const terminal = new FakeTerminal();
  const tui = { terminal };
  const hidden = {
    render() {
      return [`rows:${terminal.rows}`];
    },
  };

  let compositor!: TerminalSplitCompositor;
  compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: (width): FixedEditorClusterRender => ({
      lines: compositor.renderHidden(hidden, width),
      cursor: null,
    }),
  });

  compositor.hideRenderable(hidden);
  compositor.install();

  assert.equal(terminal.rows, 11);
  compositor.requestRepaint();
  assert.ok(terminal.writes.at(-1)?.includes("rows:12"));

  compositor.dispose();
});

test("terminal split suspends fixed cluster painting while overlays are active", () => {
  const terminal = new FakeTerminal();
  const tui = {
    terminal,
    overlayStack: [{}],
    rendered: 0,
    clearOnShrink: false,
    getClearOnShrink() {
      return this.clearOnShrink;
    },
    setClearOnShrink(enabled: boolean) {
      this.clearOnShrink = enabled;
    },
    doRender() {
      this.rendered += 1;
      this.terminal.write("overlay-frame");
    },
  };

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    getShowHardwareCursor: () => false,
    renderCluster: () => ({ lines: ["editor-cluster"], cursor: null }),
  });

  compositor.install();
  assert.equal(tui.clearOnShrink, true);
  tui.doRender();
  compositor.requestRepaint();

  assert.equal(terminal.writes.length, 2);
  assert.ok(terminal.writes[1].includes("overlay-frame"));
  assert.ok(!terminal.writes[1].includes("editor-cluster"));

  compositor.dispose();
  assert.equal(tui.clearOnShrink, false);
});


test("terminal split bypasses fixed cluster when editor container is replaced by a selector", () => {
  const terminal = new FakeTerminal();
  const editorContainer = {
    child: "editor",
    render(width: number) {
      return [`selector:${this.child}:${width}`];
    },
  };
  const tui = {
    terminal,
    render() {
      return ["chat", ...editorContainer.render(terminal.columns)];
    },
    doRender() {
      this.terminal.write(this.render().join("\n"));
    },
  };

  let selectorActive = false;
  let compositor!: TerminalSplitCompositor;
  compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    shouldBypassFixedCluster: () => selectorActive,
    renderCluster: (width): FixedEditorClusterRender => ({
      lines: compositor.renderHidden(editorContainer, width),
      cursor: null,
    }),
  });

  compositor.hideRenderable(editorContainer, () => !selectorActive);
  compositor.install();

  tui.doRender();
  assert.ok(terminal.writes[1].includes("selector:editor:40"));
  assert.ok(!terminal.writes[1].includes("chat\nselector:editor:40"));

  selectorActive = true;
  editorContainer.child = "settings";
  tui.doRender();
  assert.ok(terminal.writes.at(-1)?.includes("chat\nselector:settings:40"));
  assert.ok(!terminal.writes.at(-1)?.includes("\x1b[1;"));

  compositor.dispose();
});

test("terminal split keeps tabbed overlay composition within terminal width", () => {
  const terminal = new FakeTerminal();
  terminal.columns = 250;
  terminal.setRows(40);
  const tui = new TUI(terminal as never, false);
  const overlay = "\x1b[38;2;119;125;136m[grep]: render.ts-706- \treturn [...lines.slice(0, visibleLines), truncLine(theme.fg(\"dim\", hint), width)];\x1b[39m";

  const before = Reflect.get(tui, "compositeLineAt").call(tui, "Validation before " + " ".repeat(232), overlay, 20, 210, 250);
  assert.ok(visibleWidth(before) > 250);

  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => ({ lines: ["cluster"], cursor: null }),
  });

  compositor.install();
  const after = Reflect.get(tui, "compositeLineAt").call(tui, "Validation before " + " ".repeat(232), overlay, 20, 210, 250);

  assert.ok(visibleWidth(after) <= 250);
  assert.doesNotMatch(after, /\t/);

  compositor.dispose();
});
