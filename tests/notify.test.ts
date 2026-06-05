import test from "node:test";
import assert from "node:assert/strict";
import { nextFooterFixedSetting, parseFooterFixedConfig } from "../src/config.ts";
import {
  getTaskCompletionNotificationAnswer,
  getTaskCompletionNotificationStatus,
  isSubagentProcess,
  notifyTaskCompleteTelegram,
  shouldNotifyTaskCompletion,
  shouldNotifyTaskCompletionWindows,
  shouldSendTaskCompletionNotification,
  supportsWindowsToast,
  taskCompletionNotificationMessage,
  type TelegramFetch,
} from "../src/notify.ts";

test("task completion notifications are main interactive agent only", () => {
  assert.equal(shouldNotifyTaskCompletion({ hasUI: true }, {}, ["node", "pi"]), true);
  assert.equal(shouldNotifyTaskCompletion({ hasUI: false }, {}, ["node", "pi"]), false);
  assert.equal(shouldNotifyTaskCompletion({ hasUI: true }, { PI_SUBAGENT_CHILD: "1" }, ["node", "pi"]), false);
});

test("Windows task completion notifications require Windows toast support", () => {
  assert.equal(shouldNotifyTaskCompletionWindows({ hasUI: true }, {}, ["node", "pi"], "win32"), true);
  assert.equal(shouldNotifyTaskCompletionWindows({ hasUI: false }, {}, ["node", "pi"], "win32"), false);
  assert.equal(shouldNotifyTaskCompletionWindows({ hasUI: true }, {}, ["node", "pi"], "linux"), false);

  const wslEnv = { WSL_DISTRO_NAME: "Ubuntu" };
  assert.equal(supportsWindowsToast("linux", wslEnv), true);
  assert.equal(shouldNotifyTaskCompletionWindows({ hasUI: true }, wslEnv, ["node", "pi"], "linux"), true);
  assert.equal(
    shouldNotifyTaskCompletionWindows({ hasUI: true }, { ...wslEnv, PI_SUBAGENT_CHILD: "1" }, ["node", "pi"], "linux"),
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
  assert.equal(parseFooterFixedConfig({}).notificationChannels.windowsToast.enabled, true);
  assert.equal(parseFooterFixedConfig({ footerFixed: { taskCompletionNotification: false } }).notificationChannels.windowsToast.enabled, false);
  assert.equal(parseFooterFixedConfig({}).notificationChannels.telegram.enabled, false);
  const telegramConfig = parseFooterFixedConfig({
    footerFixed: {
      notificationChannels: {
        telegram: {
          enabled: true,
          botToken: "123:abc",
          chatId: "123456789",
          timeoutMs: 1000,
        },
      },
    },
  }).notificationChannels.telegram;
  assert.equal(telegramConfig.enabled, true);
  assert.equal(telegramConfig.botToken, "123:abc");
  assert.equal(telegramConfig.chatId, "123456789");
  assert.equal(telegramConfig.apiBaseUrl, "https://api.telegram.org");
  assert.equal(telegramConfig.timeoutMs, 1000);
  assert.equal(parseFooterFixedConfig({
    footerFixed: {
      notificationChannels: {
        telegram: {
          chatId: -1001234567890,
        },
      },
    },
  }).notificationChannels.telegram.chatId, "-1001234567890");
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

test("task completion notification messages use answers, fixed errors, and skip aborts", () => {
  assert.equal(taskCompletionNotificationMessage("completed").title, "Pi Agent");
  assert.equal(taskCompletionNotificationMessage("completed", "最后回答").body, "最后回答");
  assert.equal(taskCompletionNotificationMessage("error", "不会发送这个回答").body, "任务出错，请回到本地查看详情。");
  assert.equal(taskCompletionNotificationMessage("aborted", "不会发送这个回答").body, "");
  assert.equal(shouldSendTaskCompletionNotification("completed"), true);
  assert.equal(shouldSendTaskCompletionNotification("error"), true);
  assert.equal(shouldSendTaskCompletionNotification("aborted"), false);
});

test("task completion notification answer is extracted from the last assistant message", () => {
  assert.equal(getTaskCompletionNotificationAnswer([
    { role: "assistant", content: "first" },
    { role: "user", content: "next" },
    { role: "assistant", content: [{ type: "text", text: "final answer" }] },
  ]), "final answer");
  assert.equal(getTaskCompletionNotificationAnswer([{ role: "user", content: "hi" }]), undefined);
});

test("Telegram task completion notification sends through configured channel", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const fetchImpl: TelegramFetch = async (url, init) => {
    requests.push({ url, body: init.body });
    return { ok: true, status: 200, text: async () => "" };
  };

  const sent = await notifyTaskCompleteTelegram("completed", {
    enabled: true,
    botToken: "123:abc",
    chatId: "456",
    apiBaseUrl: "https://telegram.example/api/",
    timeoutMs: 1000,
  }, "最后回答", fetchImpl);

  assert.equal(sent, true);
  assert.equal(requests[0].url, "https://telegram.example/api/bot123:abc/sendMessage");
  const params = new URLSearchParams(requests[0].body);
  assert.equal(params.get("chat_id"), "456");
  assert.equal(params.get("text"), "最后回答");
});

test("Telegram task completion notification skips aborts and missing credentials", async () => {
  let called = false;
  const fetchImpl: TelegramFetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => "" };
  };

  const aborted = await notifyTaskCompleteTelegram("aborted", {
    enabled: true,
    botToken: "123:abc",
    chatId: "456",
    apiBaseUrl: "https://telegram.example/api",
    timeoutMs: 1000,
  }, "不会发送这个回答", fetchImpl);
  const missingCredentials = await notifyTaskCompleteTelegram("completed", {
    enabled: true,
    apiBaseUrl: "https://telegram.example/api",
    timeoutMs: 1000,
  }, undefined, fetchImpl);

  assert.equal(aborted, false);
  assert.equal(missingCredentials, false);
  assert.equal(called, false);
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
