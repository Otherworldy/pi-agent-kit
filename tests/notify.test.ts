import test from "node:test";
import assert from "node:assert/strict";
import { parseFooterFixedConfig } from "../src/config.ts";
import { isSubagentProcess, shouldNotifyTaskCompletion, supportsWindowsToast } from "../src/notify.ts";

test("task completion notifications are main interactive Windows or WSL agent only", () => {
  assert.equal(shouldNotifyTaskCompletion({ hasUI: true }, {}, ["node", "pi"], "win32"), true);
  assert.equal(shouldNotifyTaskCompletion({ hasUI: false }, {}, ["node", "pi"], "win32"), false);
  assert.equal(shouldNotifyTaskCompletion({ hasUI: true }, {}, ["node", "pi"], "linux"), false);

  const wslEnv = { WSL_DISTRO_NAME: "Ubuntu" };
  assert.equal(supportsWindowsToast("linux", wslEnv), true);
  assert.equal(shouldNotifyTaskCompletion({ hasUI: true }, wslEnv, ["node", "pi"], "linux"), true);
  assert.equal(
    shouldNotifyTaskCompletion({ hasUI: true }, { ...wslEnv, PI_SUBAGENT_CHILD: "1" }, ["node", "pi"], "linux"),
    false,
  );
});

test("task completion notifications and editor chrome are enabled by default and configurable", () => {
  assert.equal(parseFooterFixedConfig({}).taskCompletionNotification, true);
  assert.equal(parseFooterFixedConfig({ footerFixed: { taskCompletionNotification: false } }).taskCompletionNotification, false);
  assert.equal(parseFooterFixedConfig({}).editorChrome, true);
  assert.equal(parseFooterFixedConfig({ footerFixed: { editorChrome: false } }).editorChrome, false);
});

test("subagent processes are detected from pi-subagents environment", () => {
  assert.equal(isSubagentProcess({ PI_SUBAGENT_CHILD: "1" }, ["node", "pi"]), true);
  assert.equal(isSubagentProcess({ PI_SUBAGENT_DEPTH: "1" }, ["node", "pi"]), true);
  assert.equal(isSubagentProcess({ PI_SUBAGENT_RUN_ID: "run-1" }, ["node", "pi"]), true);
  assert.equal(isSubagentProcess({}, ["node", "pi"]), false);
});

test("subagent processes are detected from json print mode fallback", () => {
  assert.equal(isSubagentProcess({}, ["node", "pi", "--mode", "json", "-p", "--no-session", "Task: hi"]), true);
  assert.equal(isSubagentProcess({}, ["node", "pi", "--mode", "json", "Task: hi"]), false);
  assert.equal(isSubagentProcess({}, ["node", "pi", "-p", "Task: hi"]), false);
});
