import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import footerFixedPlugin from "../src/index.ts";

initTheme("dark");

class FakeTerminal {
  columns = 40;
  private rowCount = 12;
  writes: string[] = [];

  get rows(): number {
    return this.rowCount;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  hideCursor(): void {}
}

function createFooterData() {
  return {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map<string, string>(),
    onBranchChange: () => () => {},
  };
}

function createTempSettings() {
  const root = mkdtempSync(join(tmpdir(), "pi-footer-fixed-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({
    footerFixed: {
      fixedEditor: true,
      mouseScroll: true,
      showExtensionStatus: true,
      taskCompletionNotification: true,
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

function createHarness(cwd: string, options: { synchronousEditorComponent?: boolean; synchronousFooter?: boolean; presetEditorFactory?: (tui: any, theme: any, keybindings: any) => any } = {}) {
  let sessionStart: ((event: unknown, ctx: any) => void | Promise<void>) | undefined;
  let commandHandler: ((args: string[], ctx: any) => void | Promise<void>) | undefined;
  let footerFactory: ((tui: any, theme: any, footerData: any) => any) | undefined;
  let currentEditorFactory: ((tui: any, theme: any, keybindings: any) => any) | undefined = options.presetEditorFactory;
  let customState: { panel: any; done: () => void } | undefined;
  let mountedEditor: any;

  const notifies: Array<{ message: string; type: string | undefined }> = [];
  const widgetCalls: Array<{ key: string; content: unknown; options: unknown }> = [];
  const editorFactories: unknown[] = [];
  const terminal = new FakeTerminal();
  const statusContainer = { render: () => [] as string[] };
  const aboveContainer = { render: () => [] as string[] };
  const editorContainer = { children: [] as any[], render: () => ["editor"] };
  const belowContainer = { render: () => [] as string[] };
  const tui = {
    terminal,
    children: [{}, {}, statusContainer, aboveContainer, editorContainer, belowContainer, {}] as any[],
    overlayStack: [] as any[],
    inputListeners: [] as Array<(data: string) => unknown>,
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
    addInputListener(listener: (data: string) => unknown) {
      this.inputListeners.push(listener);
      return () => {
        const index = this.inputListeners.indexOf(listener);
        if (index !== -1) this.inputListeners.splice(index, 1);
      };
    },
  };

  const ui = {
    notify(message: string, type?: string) {
      notifies.push({ message, type });
    },
    setWidget(key: string, content: unknown, options?: unknown) {
      widgetCalls.push({ key, content, options });
    },
    setFooter(factory: typeof footerFactory) {
      footerFactory = factory;
      if (options.synchronousFooter && factory) {
        factory(tui, {}, createFooterData());
      }
    },
    getEditorComponent() {
      return currentEditorFactory;
    },
    setEditorComponent(factory: typeof currentEditorFactory) {
      currentEditorFactory = factory;
      editorFactories.push(factory);
      if (options.synchronousEditorComponent && factory) {
        editorContainer.children = [];
        mountedEditor = factory(tui, {}, {});
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
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
    registerCommand(name: string, command: { handler: typeof commandHandler }) {
      if (name === "footer-fixed") commandHandler = command.handler;
    },
  };

  footerFixedPlugin(api as never);

  const ctx = { hasUI: true, cwd, ui };

  async function startWithMountedEditor() {
    assert.ok(sessionStart);
    await sessionStart({ reason: "new" }, ctx);
    assert.ok(currentEditorFactory);

    const editor = mountedEditor ?? currentEditorFactory(tui, {}, {});
    if (!editorContainer.children.includes(editor)) {
      editorContainer.children = [editor];
    }
    if (!options.synchronousFooter) {
      assert.ok(footerFactory);
      footerFactory(tui, {}, createFooterData());
    }
    await Promise.resolve();
    await Promise.resolve();
  }

  async function openSettings() {
    assert.ok(commandHandler);
    const promise = Promise.resolve(commandHandler([], ctx));
    await Promise.resolve();
    assert.ok(customState);
    return { promise, state: customState };
  }

  return {
    ctx,
    notifies,
    widgetCalls,
    editorFactories,
    tui,
    terminal,
    editorContainer,
    get currentEditorFactory() {
      return currentEditorFactory;
    },
    get sessionStart() {
      return sessionStart;
    },
    startWithMountedEditor,
    openSettings,
  };
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("plugin exports a default factory and registers lifecycle hooks plus commands", () => {
  const events: string[] = [];
  const commands: string[] = [];
  const api = {
    on(event: string) {
      events.push(event);
    },
    registerCommand(name: string) {
      commands.push(name);
    },
  };

  assert.equal(typeof footerFixedPlugin, "function");
  footerFixedPlugin(api as never);

  assert.deepEqual(events, ["session_start", "agent_end", "session_shutdown"]);
  assert.deepEqual(commands, ["footer-fixed"]);
});

test("default startup installs fixed editor with mouse scrolling before settings are changed", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd, { synchronousEditorComponent: true, synchronousFooter: true });
    assert.ok(harness.sessionStart);

    await harness.sessionStart({ reason: "new" }, harness.ctx);
    await Promise.resolve();
    await flushTimers();
    await Promise.resolve();

    assert.deepEqual(harness.notifies, []);
    assert.equal(harness.tui.inputListeners.length, 1);
    assert.ok(harness.terminal.writes.some((write) => write.includes("\x1b[?1002h") && write.includes("\x1b[?1006h")));
  });
});

test("startup rebinds an existing custom editor factory before settings are toggled", async () => {
  await withTempSettings(async ({ cwd }) => {
    const customEditorFactory = () => ({
      onSubmit: undefined,
      setText() {},
      getText: () => "",
      render: () => ["custom-editor"],
    });
    const harness = createHarness(cwd, {
      synchronousEditorComponent: true,
      synchronousFooter: true,
      presetEditorFactory: customEditorFactory,
    });
    assert.ok(harness.sessionStart);

    await harness.sessionStart({ reason: "new" }, harness.ctx);
    await Promise.resolve();
    await flushTimers();
    await Promise.resolve();

    assert.deepEqual(harness.notifies, []);
    assert.equal(harness.editorFactories.length, 1);
    assert.notEqual(harness.currentEditorFactory, customEditorFactory);
    assert.equal(harness.tui.inputListeners.length, 1);
    assert.ok(harness.terminal.writes.some((write) => write.includes("\x1b[?1002h") && write.includes("\x1b[?1006h")));
  });
});

test("startup retries fixed editor install after delayed editor container mount", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd, { synchronousFooter: true });
    assert.ok(harness.sessionStart);

    await harness.sessionStart({ reason: "new" }, harness.ctx);
    assert.ok(harness.currentEditorFactory);
    const editor = harness.currentEditorFactory(harness.tui, {}, {});
    await Promise.resolve();

    assert.equal(harness.tui.inputListeners.length, 0);
    harness.editorContainer.children = [editor];
    await flushTimers();
    await Promise.resolve();

    assert.deepEqual(harness.notifies, []);
    assert.equal(harness.tui.inputListeners.length, 1);
    assert.ok(harness.terminal.writes.some((write) => write.includes("\x1b[?1002h") && write.includes("\x1b[?1006h")));
  });
});

test("settings overlay changes defer fixed-editor reinstall without warning fallback", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    await harness.startWithMountedEditor();

    const { promise, state } = await harness.openSettings();
    state.panel.settingsList.onChange("mouseScroll", "false");
    await Promise.resolve();

    assert.deepEqual(harness.notifies, []);
    assert.equal(harness.widgetCalls.some((call) => call.content !== undefined), false);

    state.done();
    await promise;
    await Promise.resolve();

    assert.deepEqual(harness.notifies, []);
    assert.equal(harness.widgetCalls.some((call) => call.content !== undefined), false);
  });
});

test("settings overlay persists task completion notification toggle", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    await harness.startWithMountedEditor();

    const { promise, state } = await harness.openSettings();
    state.panel.settingsList.onChange("taskCompletionNotification", "false");
    state.done();
    await promise;

    const settings = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    assert.equal(settings.footerFixed.taskCompletionNotification, false);
  });
});

test("settings toggles do not wrap pi-footer-fixed editor factory repeatedly", async () => {
  await withTempSettings(async ({ cwd }) => {
    const harness = createHarness(cwd);
    assert.ok(harness.sessionStart);
    await harness.sessionStart({ reason: "new" }, harness.ctx);
    const firstFactory = harness.currentEditorFactory;

    const { promise, state } = await harness.openSettings();
    state.panel.settingsList.onChange("fixedEditor", "false");
    state.panel.settingsList.onChange("fixedEditor", "true");
    state.done();
    await promise;

    assert.equal(harness.currentEditorFactory, firstFactory);
    assert.ok(harness.editorFactories.every((factory) => factory === firstFactory));
  });
});
