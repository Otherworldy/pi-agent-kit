import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { clearEditorChromeGitCache, renderEditorChrome } from "../src/editor-chrome.ts";
import agentKitPlugin from "../src/index.ts";
import { buildClaudeMetadataUserId } from "../src/provider-compat.ts";
import {
  createPluginState,
  formatWorkingElapsedMs,
  getWorkingElapsedMs,
  startWorkingSpinner,
  stopWorkingSpinner,
} from "../src/plugin-state.ts";

// 增加EventEmitter监听器限制，避免测试中的警告
process.setMaxListeners(20);

initTheme("dark");

const editorTheme = { borderColor: (text: string) => text, selectList: {} };

function createTempSettings() {
  const root = mkdtempSync(join(tmpdir(), "pi-agent-kit-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(home, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({
    agentKit: {
      taskCompletionNotification: true,
      editorChrome: true,
      fast: {
        enabled: false,
        persistState: true,
        serviceTier: "priority",
        supportedModels: ["my-openai/gpt-5.5"],
      },
      providerCompat: {
        claudeCodeHeaders: {
          "User-Agent": "claude-cli/test",
          "X-App": "cli",
        },
        codexHeaders: {
          Originator: "codex_cli_rs",
          "User-Agent": "codex_cli_rs/test",
          "OpenAI-Beta": "responses=experimental",
          "X-Codex-Beta-Features": "remote_compaction_v2",
          "X-Codex-Turn-Metadata": "",
        },
      },
    },
  }), "utf-8");

  return { root, home, cwd };
}

function withTempSettings<T>(run: (paths: { root: string; home: string; cwd: string }) => Promise<T> | T): Promise<T> | T {
  const paths = createTempSettings();
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = paths.home;
  process.env.USERPROFILE = paths.home;

  const cleanup = () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    rmSync(paths.root, { recursive: true, force: true });
  };

  try {
    const result = run(paths);
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function createHarness(cwd: string, options: { synchronousEditorComponent?: boolean; presetEditorFactory?: (tui: any, theme: any, keybindings: any) => any } = {}) {
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown | Promise<unknown>>>();
  const commands = new Map<string, (args: string, ctx: any) => void | Promise<void>>();
  let sessionStart: ((event: unknown, ctx: any) => void | Promise<void>) | undefined;
  let commandHandler: ((args: string, ctx: any) => void | Promise<void>) | undefined;
  let currentEditorFactory: ((tui: any, theme: any, keybindings: any) => any) | undefined = options.presetEditorFactory;
  let customState: { panel: any; done: () => void } | undefined;
  let mountedEditor: any;
  let thinkingLevel = "high";
  let idle = true;

  const notifies: Array<{ message: string; type: string | undefined }> = [];
  const sentMessages: Array<{ message: unknown; options: unknown }> = [];
  const statuses = new Map<string, string>();
  const flags = new Map<string, boolean | string>();
  const providerRegistrations = new Map<string, unknown>();
  const editorFactories: unknown[] = [];
  const footerFactories: Array<((...args: any[]) => any) | undefined> = [];
  const terminal = { rows: 24, columns: 80 };
  const editorContainer = { children: [] as any[], render: () => ["editor"] };
  const tui = {
    terminal,
    children: [editorContainer] as any[],
    overlayStack: [] as any[],
    requestRenderCalls: [] as Array<boolean | undefined>,
    requestRender(force?: boolean) {
      this.requestRenderCalls.push(force);
    },
    hasOverlay() {
      return this.overlayStack.some((entry) => entry && entry.hidden !== true);
    },
    getShowHardwareCursor() {
      return false;
    },
  };

  const ui = {
    notify(message: string, type?: string) {
      notifies.push({ message, type });
    },
    setStatus(key: string, text: string | undefined) {
      if (text === undefined) statuses.delete(key);
      else statuses.set(key, text);
    },
    theme: {
      fg: (_kind: string, text: string) => text,
    },
    setFooter(factory: ((...args: any[]) => any) | undefined) {
      footerFactories.push(factory);
    },
    getEditorComponent() {
      return currentEditorFactory;
    },
    setEditorComponent(factory: typeof currentEditorFactory) {
      currentEditorFactory = factory;
      editorFactories.push(factory);
      if (options.synchronousEditorComponent && factory) {
        editorContainer.children = [];
        mountedEditor = factory(tui, editorTheme, {});
        editorContainer.children.push(mountedEditor);
      }
    },
    custom(factory: (tui: any, theme: any, keybindings: any, done: () => void) => any) {
      return new Promise<void>((resolve) => {
        const panel = factory(tui, { fg: (_kind: string, text: string) => text }, {}, () => {
          tui.overlayStack.pop();
          resolve();
        });
        tui.overlayStack.push({ component: panel, hidden: false });
        customState = { panel, done: () => panel.handleInput("\x1b") };
      });
    },
  };

  const api = {
    on(event: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      if (event === "session_start") sessionStart = handler as typeof sessionStart;
    },
    registerCommand(name: string, command: { handler: (args: string, ctx: any) => void | Promise<void> }) {
      commands.set(name, command.handler);
      if (name === "agent-kit") commandHandler = command.handler;
    },
    registerFlag(name: string, options: { default?: boolean | string }) {
      if (options.default !== undefined && !flags.has(name)) flags.set(name, options.default);
    },
    getFlag(name: string) {
      return flags.get(name);
    },
    getThinkingLevel() {
      return thinkingLevel;
    },
    sendMessage(message: unknown, options: unknown) {
      sentMessages.push({ message, options });
    },
    registerProvider(name: string, providerConfig: unknown) {
      providerRegistrations.set(name, providerConfig);
    },
    unregisterProvider(name: string) {
      providerRegistrations.delete(name);
    },
  };

  agentKitPlugin(api as never);

  const ctx = {
    hasUI: true,
    cwd,
    ui,
    model: { contextWindow: 200000, id: "gpt-5.5", provider: "my-openai", api: "openai-responses" },
    sessionManager: { getEntries: () => [], getSessionId: () => "test-session-id" },
    modelRegistry: { providerRequestConfigs: new Map<string, unknown>() },
    getContextUsage: () => ({ contextWindow: 200000, percent: 42, tokens: 84000 }),
    isIdle: () => idle,
  };

  async function startWithMountedEditor() {
    assert.ok(sessionStart);
    await sessionStart({ reason: "new" }, ctx);
    assert.ok(currentEditorFactory);

    const editor = mountedEditor ?? currentEditorFactory(tui, editorTheme, {});
    if (!editorContainer.children.includes(editor)) {
      editorContainer.children = [editor];
    }
    await Promise.resolve();
    await Promise.resolve();
  }

  async function openSettings() {
    assert.ok(commandHandler);
    const promise = Promise.resolve(commandHandler("", ctx));
    await Promise.resolve();
    assert.ok(customState);
    return { promise, state: customState };
  }

  return {
    ctx,
    notifies,
    sentMessages,
    statuses,
    editorFactories,
    handlers,
    commands,
    flags,
    providerRegistrations,
    footerFactories,
    tui,
    editorContainer,
    get mountedEditor() {
      return mountedEditor;
    },
    get currentEditorFactory() {
      return currentEditorFactory;
    },
    get sessionStart() {
      return sessionStart;
    },
    setIdle(value: boolean) {
      idle = value;
    },
    async emit(event: string, payload: any = {}) {
      let result: unknown;
      for (const handler of handlers.get(event) ?? []) {
        const handlerResult = await handler(payload, ctx);
        if (handlerResult !== undefined) result = handlerResult;
      }
      return result;
    },
    async runCommand(name: string, args = "") {
      const handler = commands.get(name);
      assert.ok(handler);
      await handler(args, ctx);
    },
    startWithMountedEditor,
    openSettings,
  };
}

test("plugin exports a default factory and registers lifecycle hooks plus commands", () => {
  const events: string[] = [];
  const commands: string[] = [];
  const flags: string[] = [];
  const api = {
    on(event: string) {
      events.push(event);
    },
    registerCommand(name: string) {
      commands.push(name);
    },
    registerFlag(name: string) {
      flags.push(name);
    },
    getFlag() {
      return false;
    },
  };

  assert.equal(typeof agentKitPlugin, "function");
  agentKitPlugin(api as never);

  assert.deepEqual(events, [
    "context",
    "before_provider_request",
    "message_update",
    "turn_start",
    "session_start",
    "thinking_level_select",
    "model_select",
    "agent_start",
    "agent_end",
    "session_shutdown",
  ]);
  assert.deepEqual(commands, ["agent-kit", "fast", "continue"]);
  assert.deepEqual(flags, ["fast"]);
});

test("continue command reports when there is no failed assistant response", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);

    await harness.runCommand("continue");

    assert.equal(harness.sentMessages.length, 0);
    assert.deepEqual(harness.notifies.at(-1), {
      message: "No failed assistant response is available to continue.",
      type: "info",
    });
  });
});

test("continue command refuses while the agent is still running", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    harness.setIdle(false);

    await harness.runCommand("continue");

    assert.equal(harness.sentMessages.length, 0);
    assert.deepEqual(harness.notifies.at(-1), {
      message: "Pi Agent is still running. Wait for it to stop before using /continue.",
      type: "warning",
    });
  });
});

test("continue command triggers one hidden retry request after an assistant error", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    const userMessage = { role: "user", content: [{ type: "text", text: "make a change" }], timestamp: 1000 };
    const failedAssistant = {
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
      stopReason: "error",
      errorMessage: "provider returned error 503",
      timestamp: 2000,
    };

    await harness.emit("agent_end", { messages: [userMessage, failedAssistant] });
    await harness.runCommand("continue");
    await harness.runCommand("continue");

    assert.equal(harness.sentMessages.length, 1);
    const sent = harness.sentMessages[0];
    assert.deepEqual(sent.options, { triggerTurn: true });
    assert.equal((sent.message as any).customType, "pi-agent-kit.continue");
    assert.equal((sent.message as any).display, false);
    assert.equal(typeof (sent.message as any).details?.requestId, "string");
    assert.equal(typeof (sent.message as any).details?.failureFingerprint, "string");
    assert.deepEqual(harness.notifies.at(-1), {
      message: "A /continue retry is already pending for the last failure.",
      type: "warning",
    });
  });
});

test("continue failure state clears after a later successful assistant response", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    const userMessage = { role: "user", content: [{ type: "text", text: "make a change" }], timestamp: 1000 };
    const failedAssistant = {
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
      stopReason: "error",
      errorMessage: "provider returned error 503",
      timestamp: 2000,
    };
    const successfulAssistant = {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      stopReason: "stop",
      timestamp: 3000,
    };

    await harness.emit("agent_end", { messages: [userMessage, failedAssistant] });
    await harness.emit("agent_end", { messages: [userMessage, failedAssistant, successfulAssistant] });
    await harness.runCommand("continue");

    assert.equal(harness.sentMessages.length, 0);
    assert.deepEqual(harness.notifies.at(-1), {
      message: "No failed assistant response is available to continue.",
      type: "info",
    });
  });
});

test("continue context filter removes the failed assistant and internal trigger once", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    const userMessage = { role: "user", content: [{ type: "text", text: "make a change" }], timestamp: 1000 };
    const failedAssistant = {
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
      stopReason: "error",
      errorMessage: "provider returned error 503",
      timestamp: 2000,
    };

    await harness.emit("agent_end", { messages: [userMessage, failedAssistant] });
    await harness.runCommand("continue");

    const triggerMessage = {
      role: "custom",
      ...(harness.sentMessages[0].message as Record<string, unknown>),
      timestamp: 3000,
    };
    const contextMessages = [userMessage, failedAssistant, triggerMessage];
    const filtered = await harness.emit("context", { messages: contextMessages }) as { messages: unknown[] };
    const secondFilter = await harness.emit("context", { messages: contextMessages });

    assert.deepEqual(filtered.messages, [userMessage]);
    assert.equal(secondFilter, undefined);
  });
});

test("startup replaces only Pi's native footer, not the fullscreen layout", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    await harness.startWithMountedEditor();

    assert.equal(harness.footerFactories.length, 1);
    const footer = harness.footerFactories[0]?.(harness.tui, {}, {});
    assert.deepEqual(footer?.render(80), []);
    assert.deepEqual(harness.tui.children, [harness.editorContainer]);
  });
});

test("settings overlay persists local and Telegram notification toggles", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    await harness.startWithMountedEditor();

    const { promise, state } = await harness.openSettings();
    state.panel.settingsList.onChange("notificationChannels.windowsToast.enabled", "false");
    state.panel.settingsList.onChange("notificationChannels.telegram.enabled", "true");
    state.done();
    await promise;

    const settings = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    assert.equal(settings.agentKit.notificationChannels.windowsToast.enabled, false);
    assert.equal(settings.agentKit.notificationChannels.telegram.enabled, true);
  });
});

test("editor chrome renders model, thinking level, context usage, git status, cwd, and body padding", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd, { synchronousEditorComponent: true });
    assert.ok(harness.sessionStart);

    await harness.sessionStart({ reason: "new" }, harness.ctx);
    await Promise.resolve();

    assert.ok(harness.mountedEditor);
    const lines = harness.mountedEditor.render(120);
    const joined = lines.join("\n");
    assert.ok(joined.includes("my-openai/gpt-5.5"));
    assert.ok(joined.includes("high"));
    assert.ok(joined.includes("Codex"));
    assert.ok(joined.includes("84k/200k"));
    assert.ok(joined.includes("$0.000"));
    assert.ok(joined.includes(" · "));
    assert.ok(joined.includes("main"));
    assert.match(joined, /clean|Δ/);
    // Solid panel + ▌ thinking bar; no chrome ─ borders
    assert.ok(lines.some((line: string) => line.includes("▌")));
    assert.ok(lines.some((line: string) => /\x1b\[48[;:]/.test(line)));
    assert.equal((lines[0] ?? "").includes("─"), false);
    // git sits outside the panel (last chrome line, right-aligned, no ▌)
    const gitLine = [...lines].reverse().find((line: string) => /main/.test(line) && /clean|Δ/.test(line));
    assert.ok(gitLine);
    assert.equal(gitLine?.includes("▌"), false);

    const narrowLines = harness.mountedEditor.render(40);
    const narrowJoined = narrowLines.join("\n");
    assert.ok(narrowJoined.includes("main"));
    assert.match(narrowJoined, /clean|Δ/);
  });
});

test("editor chrome omits git status outside repositories", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-agent-kit-nogit-"));

  try {
    clearEditorChromeGitCache();
    const lines = renderEditorChrome({
      width: 80,
      enabled: true,
      context: {
        cwd,
        model: { id: "model" },
        ui: { theme: { fg: (_kind: string, text: string) => text } },
      },
      thinkingLevel: "off",
      renderBase: (width) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width)],
    });

    assert.equal(lines[0]?.includes("no git"), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("editor chrome context is bottom-right and respects left/right slot order", () => {
  const theme = { fg: (_kind: string, text: string) => text };
  const base = {
    width: 100,
    enabled: true as const,
    thinkingLevel: "off",
    renderBase: (width: number) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width)],
  };
  const session = {
    getEntries: () => [{
      type: "message",
      message: { role: "assistant", usage: { cost: { total: 1.234 } } },
    }],
  };

  // parent + subagent toolResult child cost
  const withSubagent = renderEditorChrome({
    ...base,
    context: {
      cwd: process.cwd(),
      model: { id: "m", contextWindow: 500000 },
      ui: { theme },
      getContextUsage: () => ({ tokens: 34000, percent: 8, contextWindow: 500000 }),
      sessionManager: {
        getEntries: () => [
          { type: "message", message: { role: "assistant", usage: { cost: { total: 1.0 } } } },
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "subagent",
              details: {
                mode: "single",
                results: [{ agent: "worker", usage: { cost: 0.5 } }],
                totalChildUsage: { cost: 0.5 },
              },
            },
          },
        ],
      },
    },
  });
  const subMeta = withSubagent.find((line) => line.includes("$1.500"));
  assert.ok(subMeta, "chrome cost should include subagent child usage");

  const withCtx = renderEditorChrome({
    ...base,
    context: {
      cwd: process.cwd(),
      model: { id: "m", contextWindow: 500000 },
      ui: { theme },
      getContextUsage: () => ({ tokens: 34000, percent: 8, contextWindow: 500000 }),
      sessionManager: session,
    },
  });
  const meta = withCtx.find((line) => line.includes("34k/500k"));
  assert.ok(meta);
  const plain = (meta ?? "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trimEnd();
  assert.ok(plain.endsWith("34k/500k"));
  assert.ok(plain.includes("$1.234"));
  assert.ok(plain.indexOf("$1.234") < plain.indexOf("34k/500k"));

  // custom order: context left, cost right; empty lists hide
  const reordered = renderEditorChrome({
    ...base,
    display: { left: ["context", "model"], right: ["cost"] },
    context: {
      cwd: process.cwd(),
      model: { id: "reorder-model", contextWindow: 500000 },
      ui: { theme },
      getContextUsage: () => ({ tokens: 34000, percent: 8, contextWindow: 500000 }),
      sessionManager: session,
    },
  });
  const reorderedMeta = reordered.find((line) => line.includes("34k/500k"));
  const reorderedPlain = (reorderedMeta ?? "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/^▌\s*/, "").trimEnd();
  assert.ok(reorderedPlain.startsWith("34k/500k"));
  assert.ok(reorderedPlain.includes("reorder-model"));
  assert.ok(reorderedPlain.endsWith("$1.234"));

  const hidden = renderEditorChrome({
    ...base,
    display: { left: [], right: [] },
    context: {
      cwd: process.cwd(),
      model: { id: "hidden-model", contextWindow: 500000 },
      ui: { theme },
      getContextUsage: () => ({ tokens: 34000, percent: 8, contextWindow: 500000 }),
      sessionManager: session,
    },
  });
  const joined = hidden.join("\n");
  assert.equal(joined.includes("hidden-model"), false);
  assert.equal(joined.includes("34k/500k"), false);
  assert.equal(joined.includes("$1.234"), false);
});

test("editor chrome left bar follows borderColor (bash green) over thinking level", () => {
  const lines = renderEditorChrome({
    width: 80,
    enabled: true,
    context: {
      cwd: process.cwd(),
      model: { id: "model" },
      ui: {
        theme: {
          fg: (kind: string, text: string) => (kind === "thinkingHigh" ? `[TH]${text}` : text),
        },
      },
    },
    thinkingLevel: "high",
    borderColor: (text) => `[BASH]${text}`,
    renderBase: (width) => ["─".repeat(width), "!ls".padEnd(width), "─".repeat(width)],
  });

  assert.ok(lines.some((line) => line.includes("[BASH]▌")));
  assert.equal(lines.some((line) => line.includes("[TH]▌")), false);
});

test("editor chrome left bar falls back to thinking color without borderColor", () => {
  const lines = renderEditorChrome({
    width: 80,
    enabled: true,
    context: {
      cwd: process.cwd(),
      model: { id: "model" },
      ui: {
        theme: {
          fg: (kind: string, text: string) => (kind === "thinkingHigh" ? `[TH]${text}` : text),
        },
      },
    },
    thinkingLevel: "high",
    renderBase: (width) => ["─".repeat(width), "hello".padEnd(width), "─".repeat(width)],
  });

  assert.ok(lines.some((line) => line.includes("[TH]▌")));
});

test("editor chrome keeps autocomplete popup rows below the custom border", async () => {
  await withTempSettings(async ({ cwd }) => {
    const baseEditorFactory = () => ({
      onSubmit: undefined,
      setText() {},
      getText: () => "",
      render: (width: number) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width), "popup".padEnd(width)],
    });
    const harness = createHarness(cwd, {
      synchronousEditorComponent: true,
      presetEditorFactory: baseEditorFactory,
    });
    assert.ok(harness.sessionStart);

    await harness.sessionStart({ reason: "new" }, harness.ctx);

    const lines = harness.mountedEditor.render(80);
    // popup is last; chrome lines above it have no box-drawing corners
    assert.match(lines.at(-1) ?? "", /popup/);
    assert.ok(lines.slice(0, -1).some((line: string) => line.includes("▌")));
    assert.equal(lines.slice(0, -1).some((line: string) => line.includes("╰")), false);
  });
});

test("settings overlay persists editor chrome toggle", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    await harness.startWithMountedEditor();

    const { promise, state } = await harness.openSettings();
    state.panel.settingsList.onChange("editorChrome", "false");
    state.done();
    await promise;

    const settings = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    assert.equal(settings.agentKit.editorChrome, false);
  });
});

test("fast command toggles status, editor chrome label, and provider payload", async () => {
  await withTempSettings(async ({ cwd }) => {
    const settingsPath = join(cwd, ".pi", "settings.json");
    const settingsBefore = JSON.parse(readFileSync(settingsPath, "utf-8"));
    delete settingsBefore.agentKit.providerCompat;
    writeFileSync(settingsPath, JSON.stringify(settingsBefore), "utf-8");

    const harness = createHarness(cwd, { synchronousEditorComponent: true });
    assert.ok(harness.sessionStart);
    await harness.sessionStart({ reason: "new" }, harness.ctx);

    const { promise, state } = await harness.openSettings();
    state.panel.settingsList.onChange("providerCompat", "false");
    state.done();
    await promise;

    assert.equal(await harness.emit("before_provider_request", { payload: { model: "gpt-5.5" } }), undefined);
    await harness.runCommand("fast", "on");

    assert.equal(harness.statuses.get("agent-kit-fast"), "⚡fast");
    assert.ok(harness.mountedEditor.render(120).some((line: string) => line.includes("⚡fast")));
    assert.deepEqual(await harness.emit("before_provider_request", { payload: { model: "gpt-5.5" } }), {
      model: "gpt-5.5",
      service_tier: "priority",
    });

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.equal(settings.agentKit.fast.enabled, true);
  });
});

test("message_update stream deltas drive the tps chrome slot", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd, { synchronousEditorComponent: true });
    assert.ok(harness.sessionStart);
    await harness.sessionStart({ reason: "new" }, harness.ctx);

    // No stream yet → slot stays visible at 0
    assert.ok(harness.mountedEditor.render(120).some((line: string) => line.includes("0 t/s")));

    // Simulate a stream of deltas (~400 chars each ≈ 100 tokens)
    for (let i = 0; i < 10; i += 1) {
      await harness.emit("message_update", {
        assistantMessageEvent: { type: "text_delta", delta: "x".repeat(400) },
      });
    }
    const rendered = harness.mountedEditor.render(120).join("\n");
    assert.match(rendered, /\d+ t\/s/);
    assert.equal(/(^|[^0-9])0 t\/s/.test(rendered), false);

    // agent_end keeps the last rate frozen (no reset to 0)
    await harness.emit("agent_end", { messages: [] });
    const frozen = harness.mountedEditor.render(120).join("\n");
    assert.equal(/(^|[^0-9])0 t\/s/.test(frozen), false);
    assert.match(frozen, /\d+ t\/s/);
  });
});

test("provider compat switch auto-registers Claude Code headers and patches Claude payloads", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd, { synchronousEditorComponent: true });
    harness.ctx.model = { contextWindow: 200000, id: "claude-sonnet-4-5", provider: "my-claude", api: "openai-responses" };
    assert.ok(harness.sessionStart);
    await harness.sessionStart({ reason: "new" }, harness.ctx);

    const settings = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    assert.equal(settings.agentKit.providerCompat.enabled, undefined);
    const providerConfig = harness.providerRegistrations.get("my-claude") as { headers: Record<string, string> };
    assert.equal(providerConfig.headers["User-Agent"], "claude-cli/test");
    assert.equal(providerConfig.headers["X-App"], "cli");
    assert.equal(providerConfig.headers["Anthropic-Version"], "2023-06-01");
    assert.equal(providerConfig.headers["Anthropic-Beta"], "claude-code-20250219,interleaved-thinking-2025-05-14");
    assert.equal(providerConfig.headers["X-Claude-Code-Session-Id"], "test-session-id");
    assert.equal(harness.statuses.get("agent-kit-claude-code"), "CC compat");
    assert.deepEqual(await harness.emit("before_provider_request", {
      payload: {
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "hi" }],
      },
    }), {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
        { role: "user", content: "hi" },
      ],
      metadata: { user_id: buildClaudeMetadataUserId("test-session-id") },
    });
  });
});

test("provider compat switch auto-registers Codex headers and patches responses payloads", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd, { synchronousEditorComponent: true });
    harness.ctx.model = { contextWindow: 200000, id: "gpt-5.5", provider: "my-codex", api: "openai-codex-responses" };
    assert.ok(harness.sessionStart);
    await harness.sessionStart({ reason: "new" }, harness.ctx);

    const providerConfig = harness.providerRegistrations.get("my-codex") as { headers: Record<string, string> };
    const readTurnMetadata = () => {
      const latestConfig = harness.providerRegistrations.get("my-codex") as { headers: Record<string, string> };
      return JSON.parse(latestConfig.headers["X-Codex-Turn-Metadata"]);
    };
    assert.equal(providerConfig.headers.Originator, "codex_cli_rs");
    assert.equal(providerConfig.headers["User-Agent"], "codex_cli_rs/test");
    assert.equal(providerConfig.headers["OpenAI-Beta"], "responses=experimental");
    assert.equal(providerConfig.headers["X-Codex-Beta-Features"], "remote_compaction_v2");
    assert.equal(providerConfig.headers.Session_id, "test-session-id");
    assert.equal(providerConfig.headers["session-id"], "test-session-id");
    assert.equal(providerConfig.headers.Thread_id, "test-session-id");
    assert.equal(providerConfig.headers["thread-id"], "test-session-id");
    assert.equal(providerConfig.headers["X-Client-Request-Id"], "test-session-id");
    assert.equal(providerConfig.headers["X-Codex-Window-Id"], "test-session-id:0");
    const sessionMetadata = readTurnMetadata();
    assert.equal(sessionMetadata.session_id, "test-session-id");
    assert.equal(sessionMetadata.thread_id, "test-session-id");
    assert.equal(sessionMetadata.window_id, "test-session-id:0");
    assert.equal(sessionMetadata.model, "gpt-5.5");
    assert.equal(harness.statuses.get("agent-kit-codex"), "Codex compat");

    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
    const firstTurnMetadata = readTurnMetadata();
    assert.notEqual(firstTurnMetadata.turn_id, sessionMetadata.turn_id);
    assert.equal(firstTurnMetadata.model, "gpt-5.5");

    await harness.emit("turn_start", { turnIndex: 1, timestamp: Date.now() });
    const secondTurnMetadata = readTurnMetadata();
    assert.notEqual(secondTurnMetadata.turn_id, firstTurnMetadata.turn_id);
    assert.equal(secondTurnMetadata.model, "gpt-5.5");

    const patched = await harness.emit("before_provider_request", {
      payload: {
        model: "gpt-5.5",
        input: [{ role: "user", content: "hi" }],
        client_metadata: { "x-codex-installation-id": "real-installation-id" },
      },
    }) as Record<string, unknown>;
    assert.equal(patched.model, "gpt-5.5");
    assert.equal(patched.prompt_cache_key, "test-session-id");
    assert.equal(patched.store, false);
    assert.equal(patched.instructions, "");
    const cm = patched.client_metadata as Record<string, string>;
    assert.equal(cm["x-codex-installation-id"], "real-installation-id");
    assert.equal(cm.session_id, "test-session-id");
    assert.equal(cm.thread_id, "test-session-id");
    assert.equal(cm["x-codex-window-id"], "test-session-id:0");
    assert.equal(typeof cm.turn_id, "string");
  });
});

test("working elapsed formats seconds, freezes on stop, stays visible", () => {
  assert.equal(formatWorkingElapsedMs(0), "0s");
  assert.equal(formatWorkingElapsedMs(12_400), "12s");
  assert.equal(formatWorkingElapsedMs(65_000), "1m 05s");

  const state = createPluginState();
  assert.equal(getWorkingElapsedMs(state), 0);
  startWorkingSpinner(state);
  assert.ok(getWorkingElapsedMs(state) >= 0);
  state.workingStartedAt = Date.now() - 12_400;
  stopWorkingSpinner(state);
  assert.equal(state.workingStartedAt, null);
  assert.ok(state.lastWorkingElapsedMs >= 12_400 && state.lastWorkingElapsedMs < 12_500);
  assert.equal(getWorkingElapsedMs(state), state.lastWorkingElapsedMs);
  if (state.workingSpinnerTimer) {
    clearInterval(state.workingSpinnerTimer);
    state.workingSpinnerTimer = null;
  }
});

test("editor chrome timer slot can be placed, reordered, or hidden", () => {
  const theme = { fg: (_kind: string, text: string) => text };
  const base = {
    width: 100,
    enabled: true as const,
    thinkingLevel: "off",
    workingElapsedLabel: "12s",
    renderBase: (width: number) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width)],
    context: {
      cwd: process.cwd(),
      model: { id: "m" },
      ui: { theme },
    },
  };

  const withTimer = renderEditorChrome({
    ...base,
    display: { left: ["timer", "model"], right: [] },
  });
  const withPlain = (withTimer.find((line) => line.includes("12s")) ?? "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/^▌\s*/, "")
    .trimEnd();
  assert.ok(withPlain.startsWith("12s"));
  assert.ok(withPlain.includes("m"));

  const hidden = renderEditorChrome({
    ...base,
    display: { left: ["model"], right: [] },
  });
  assert.equal(hidden.some((line) => line.includes("12s")), false);
});

test("editor chrome tps slot can be placed, reordered, or hidden", () => {
  const theme = { fg: (_kind: string, text: string) => text };
  const base = {
    width: 100,
    enabled: true as const,
    thinkingLevel: "off",
    tpsLabel: "45.7 t/s",
    renderBase: (width: number) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width)],
    context: {
      cwd: process.cwd(),
      model: { id: "m" },
      ui: { theme },
    },
  };

  const withTps = renderEditorChrome({
    ...base,
    display: { left: ["tps", "model"], right: [] },
  });
  const withPlain = (withTps.find((line) => line.includes("45.7 t/s")) ?? "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/^▌\s*/, "")
    .trimEnd();
  assert.ok(withPlain.startsWith("45.7 t/s"));
  assert.ok(withPlain.includes("m"));

  const hidden = renderEditorChrome({
    ...base,
    display: { left: ["model"], right: [] },
  });
  assert.equal(hidden.some((line) => line.includes("45.7 t/s")), false);
});

test("editor chrome shows project dir left of git status, hides via showProjectDir", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-agent-kit-dir-"));
  const repo = join(root, "my-project");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });

  try {
    clearEditorChromeGitCache();
    const theme = { fg: (_kind: string, text: string) => text };
    const base = {
      width: 100,
      enabled: true as const,
      thinkingLevel: "off",
      renderBase: (width: number) => ["─".repeat(width), "body".padEnd(width), "─".repeat(width)],
      context: {
        cwd: repo,
        model: { id: "m" },
        ui: { theme },
      },
    };

    const withDir = renderEditorChrome({
      ...base,
      showProjectDir: true,
      showGitStatus: true,
    });
    const line = withDir.find((l) => l.includes("my-project") && l.includes("main")) ?? "";
    const plain = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trimEnd();
    assert.ok(plain.indexOf("my-project") < plain.indexOf("main"), `dir should sit left of git: ${plain}`);

    const dirOnly = renderEditorChrome({
      ...base,
      showProjectDir: true,
      showGitStatus: false,
    });
    const dirPlain = (dirOnly.find((l) => l.includes("my-project")) ?? "")
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .trimEnd();
    assert.ok(dirPlain.endsWith("my-project"));

    const hidden = renderEditorChrome({
      ...base,
      showProjectDir: false,
      showGitStatus: true,
    });
    assert.equal(hidden.some((l) => l.includes("my-project")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
