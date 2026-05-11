import test from "node:test";
import assert from "node:assert/strict";
import { isSubagentProcess, shouldNotifyTaskCompletion } from "../src/notify.ts";

test("task completion notifications are main interactive Windows agent only", () => {
  assert.equal(shouldNotifyTaskCompletion({ hasUI: true }, {}, ["node", "pi"], "win32"), true);
  assert.equal(shouldNotifyTaskCompletion({ hasUI: false }, {}, ["node", "pi"], "win32"), false);
  assert.equal(shouldNotifyTaskCompletion({ hasUI: true }, {}, ["node", "pi"], "linux"), false);
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
