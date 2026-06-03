import test from "node:test";
import assert from "node:assert/strict";
import { nextFooterFixedSetting, parseFooterFixedConfig } from "../src/config.ts";
import {
  getTaskCompletionNotificationStatus,
  isSubagentProcess,
  shouldNotifyTaskCompletion,
  supportsWindowsToast,
  taskCompletionNotificationMessage,
} from "../src/notify.ts";

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

test("task completion notifications, editor chrome, and fast defaults are configurable", () => {
  assert.equal(parseFooterFixedConfig({}).taskCompletionNotification, true);
  assert.equal(parseFooterFixedConfig({ footerFixed: { taskCompletionNotification: false } }).taskCompletionNotification, false);
  assert.equal(parseFooterFixedConfig({}).editorChrome, true);
  assert.equal(parseFooterFixedConfig({ footerFixed: { editorChrome: false } }).editorChrome, false);
  assert.equal(parseFooterFixedConfig({}).fast.enabled, false);
  assert.equal(parseFooterFixedConfig({ footerFixed: { fast: { enabled: true, supportedModels: ["my-openai/gpt-5.5"] } } }).fast.supportedModels[0], "my-openai/gpt-5.5");
  assert.equal(parseFooterFixedConfig({}).providerCompat.enabled, true);
  assert.equal(parseFooterFixedConfig({}).claudeCodeCompat.enabled, true);
  assert.equal(parseFooterFixedConfig({}).codexCompat.enabled, true);
  const providerCompatConfig = parseFooterFixedConfig({
    footerFixed: {
      providerCompat: {
        enabled: true,
        claudeCodeHeaders: { "User-Agent": "claude-cli/test" },
        codexHeaders: { "X-Codex-Beta-Features": "remote_compaction_v2" },
      },
    },
  });
  assert.equal(providerCompatConfig.providerCompat.enabled, true);
  assert.equal(providerCompatConfig.claudeCodeCompat.enabled, true);
  assert.equal(providerCompatConfig.codexCompat.enabled, true);
  assert.equal(providerCompatConfig.claudeCodeCompat.headers["User-Agent"], "claude-cli/test");
  assert.equal(providerCompatConfig.claudeCodeCompat.headers["Anthropic-Version"], "2023-06-01");
  assert.equal(providerCompatConfig.codexCompat.headers["X-Codex-Beta-Features"], "remote_compaction_v2");
  assert.equal(providerCompatConfig.codexCompat.headers.Originator, "codex_cli_rs");
  assert.equal(parseFooterFixedConfig({ footerFixed: { providerCompat: { enabled: false } } }).claudeCodeCompat.enabled, true);
  assert.deepEqual(nextFooterFixedSetting(undefined, { editorChrome: false }), { editorChrome: false });
});

test("task completion notification status is derived from the final assistant result", () => {
  assert.equal(getTaskCompletionNotificationStatus([{ role: "assistant", stopReason: "stop" }]), "completed");
  assert.equal(getTaskCompletionNotificationStatus([{ role: "assistant", stopReason: "toolUse" }]), "completed");
  assert.equal(getTaskCompletionNotificationStatus([{ role: "assistant", stopReason: "aborted" }]), "aborted");
  assert.equal(getTaskCompletionNotificationStatus([{ role: "assistant", stopReason: "error" }]), "error");
  assert.equal(getTaskCompletionNotificationStatus([{ role: "assistant", stopReason: "length" }]), "error");
  assert.equal(getTaskCompletionNotificationStatus([{ role: "assistant", stopReason: "stop", errorMessage: "boom" }]), "error");
  assert.equal(
    getTaskCompletionNotificationStatus([
      { role: "assistant", stopReason: "error" },
      { role: "toolResult", isError: true },
      { role: "assistant", stopReason: "stop" },
    ]),
    "completed",
  );
});

test("task completion notification messages distinguish completion, interruption, and errors", () => {
  assert.equal(taskCompletionNotificationMessage("completed").title, "任务已完成");
  assert.equal(taskCompletionNotificationMessage("aborted").title, "任务已中断");
  assert.equal(taskCompletionNotificationMessage("error").title, "任务出错");
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
