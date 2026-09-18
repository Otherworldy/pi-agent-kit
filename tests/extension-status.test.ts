import test from "node:test";
import assert from "node:assert/strict";
import { renderEditorChrome } from "../src/editor-chrome.ts";
import {
  collectExtensionStatuses,
  formatStatusBarSummary,
  isStatusBarAuto,
  listStatusBarKeys,
  parseStatusBarLayoutValue,
  resolveStatusBarLayout,
  statusBarFromGroups,
} from "../src/extension-status.ts";
import { parseAgentKitConfig } from "../src/config.ts";
import { ChromeLayoutEditor } from "../src/chrome-layout.ts";

const auto = {
  topLeft: [] as string[],
  topRight: [] as string[],
  bottomLeft: [] as string[],
  bottomRight: [] as string[],
  hidden: [] as string[],
};

const theme = {
  label: (text: string) => text,
  value: (text: string) => text,
  description: (text: string) => text,
  cursor: "› ",
  hint: (text: string) => text,
};

test("status bar auto puts plugins top-left and projectDir/git bottom-right", () => {
  assert.equal(isStatusBarAuto(auto), true);
  assert.deepEqual(resolveStatusBarLayout(auto, ["zeta", "alpha", "projectDir", "git"]), {
    topLeft: ["alpha", "zeta"],
    topRight: [],
    bottomLeft: [],
    bottomRight: ["projectDir", "git"],
  });
  assert.equal(formatStatusBarSummary(auto), "auto");
});

test("status bar custom layout hides listed keys and appends unknown plugins to the top-left", () => {
  const layout = resolveStatusBarLayout(
    { topLeft: ["keep"], topRight: ["east"], bottomLeft: [], bottomRight: ["git"], hidden: ["gone"] },
    ["gone", "keep", "east", "new", "git", "projectDir"],
  );
  assert.deepEqual(layout, {
    topLeft: ["keep", "new"],
    topRight: ["east"],
    bottomLeft: [],
    bottomRight: ["git", "projectDir"],
  });
});

test("status bar collectors skip this plugin's own footer keys and include builtins", () => {
  const items = collectExtensionStatuses({
    getExtensionStatuses: () => new Map([
      ["agent-kit-fast", "⚡"],
      ["other.hint", "Hello"],
      ["agent-kit-codex", "Codex"],
    ]),
  });
  assert.deepEqual(items, [{ key: "other.hint", text: "Hello" }]);
  assert.deepEqual(
    listStatusBarKeys(
      { getExtensionStatuses: () => new Map([["agent-kit-fast", "⚡"], ["live", "L"]]) },
      { ...auto, topRight: ["saved"], hidden: ["gone"] },
    ),
    ["projectDir", "git", "live", "saved", "gone"],
  );
});

test("status bar parse/serialize drops duplicates and own keys", () => {
  const parsed = parseStatusBarLayoutValue(JSON.stringify({
    left: ["a", "a", "agent-kit-fast"],
    right: ["a", "b"],
    hidden: ["b", "c"],
  }));
  assert.deepEqual(parsed, {
    topLeft: ["a"],
    topRight: ["b"],
    bottomLeft: [],
    bottomRight: [],
    hidden: ["c"],
  });
  assert.deepEqual(statusBarFromGroups({ topLeft: ["a"], bottomRight: ["git"] }, ["a", "git", "projectDir"]), {
    topLeft: ["a"],
    topRight: [],
    bottomLeft: [],
    bottomRight: ["git"],
    hidden: ["projectDir"],
  });
  assert.deepEqual(parseAgentKitConfig({}).statusBar, auto);
  assert.deepEqual(parseAgentKitConfig({
    agentKit: { statusBar: { left: ["x"], hidden: ["y"] } },
  }).statusBar, { ...auto, topLeft: ["x"], hidden: ["y"] });
  assert.deepEqual(parseAgentKitConfig({
    agentKit: { showGitStatus: false },
  }).statusBar.hidden, ["git"]);
});

test("extension statuses render above the input panel, not in the ▌ chrome", () => {
  const lines = renderEditorChrome({
    width: 40,
    enabled: true,
    context: {
      cwd: process.cwd(),
      model: { id: "m" },
      ui: { theme: { fg: (_kind: string, text: string) => text } },
    },
    thinkingLevel: "off",
    extensionStatuses: [
      { key: "alpha", text: "LeftA" },
      { key: "zeta", text: "RightZ" },
    ],
    statusBar: { ...auto, topLeft: ["alpha"], topRight: ["zeta"], hidden: ["projectDir", "git"] },
    renderBase: (width) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width)],
  });

  assert.equal(lines[0]?.includes("LeftA"), true);
  assert.equal(lines[0]?.includes("RightZ"), true);
  assert.equal(lines[0]?.includes("▌"), false);
  assert.equal(lines.slice(1).some((line) => line.includes("▌")), true);
});

test("extension statuses still render when editor chrome is off", () => {
  const lines = renderEditorChrome({
    width: 40,
    enabled: false,
    context: { cwd: process.cwd() },
    thinkingLevel: "off",
    extensionStatuses: [{ key: "hint", text: "Stay" }],
    statusBar: { ...auto, topLeft: ["hint"], hidden: ["projectDir", "git"] },
    renderBase: () => ["native"],
  });
  assert.equal(lines[0]?.includes("Stay"), true);
  assert.equal(lines.at(-1), "native");
});

test("status bar can place projectDir above the input and a plugin below", () => {
  const lines = renderEditorChrome({
    width: 60,
    enabled: true,
    context: {
      cwd: process.cwd(),
      model: { id: "m" },
      ui: { theme: { fg: (_kind: string, text: string) => text } },
    },
    thinkingLevel: "off",
    extensionStatuses: [{ key: "hint", text: "Plug" }],
    statusBar: {
      topLeft: ["projectDir"],
      topRight: [],
      bottomLeft: [],
      bottomRight: ["hint"],
      hidden: ["git"],
    },
    renderBase: (width) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width)],
  });
  const panel = lines.filter((line) => line.includes("▌"));
  const top = lines[0] ?? "";
  const bottom = lines.at(-1) ?? "";
  assert.equal(top.includes("▌"), false);
  assert.ok(top.includes("pi-agent-kit") || top.includes("agent-kit"));
  assert.equal(bottom.includes("Plug"), true);
  assert.equal(bottom.includes("▌"), false);
  assert.ok(panel.length > 0);
});

test("status bar editor space cycles through four corners then hidden", () => {
  const confirmed: unknown[] = [];
  const editor = new ChromeLayoutEditor({
    display: { topLeft: ["projectDir"], bottomRight: ["git"] },
    allSlots: ["projectDir", "git"],
    sides: ["topLeft", "topRight", "bottomLeft", "bottomRight"],
    theme,
    onConfirm: (next) => confirmed.push(next),
    onCancel: () => {},
  });
  editor.handleInput(" ");
  editor.handleInput("\r");
  assert.deepEqual(confirmed, [{
    topLeft: [],
    topRight: ["projectDir"],
    bottomLeft: [],
    bottomRight: ["git"],
  }]);
});
