import test from "node:test";
import assert from "node:assert/strict";
import { nextAgentKitSetting, parseAgentKitConfig, type NotificationChannelsConfig } from "../src/config.ts";
import {
  clearPendingTaskCompletionErrorNotification,
  getTaskCompletionNotificationAnswer,
  getTaskCompletionNotificationStatus,
  isSubagentProcess,
  notifyTaskCompleteCoalesced,
  notifyTaskCompleteTelegram,
  shouldNotifyTaskCompletion,
  shouldNotifyTaskCompletionWindows,
  shouldSendTaskCompletionNotification,
  supportsWindowsToast,
  taskCompletionNotificationMessage,
  type TaskCompletionNotificationCoalescingState,
  type TaskCompletionNotificationStatus,
  type TelegramFetch,
} from "../src/notify.ts";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function disabledNotificationChannels(): NotificationChannelsConfig {
  return {
    windowsToast: { enabled: false },
    telegram: {
      enabled: false,
      apiBaseUrl: "https://telegram.example/api",
      timeoutMs: 1000,
    },
  };
}

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
  assert.equal(parseAgentKitConfig({}).taskCompletionNotification, true);
  assert.equal(parseAgentKitConfig({ agentKit: { taskCompletionNotification: false } }).taskCompletionNotification, false);
  assert.equal(parseAgentKitConfig({}).editorChrome, true);
  assert.equal(parseAgentKitConfig({ agentKit: { editorChrome: false } }).editorChrome, false);
  assert.equal(parseAgentKitConfig({}).showGitStatus, true);
  assert.equal(parseAgentKitConfig({ agentKit: { showGitStatus: false } }).showGitStatus, false);
  assert.equal(parseAgentKitConfig({}).fast.enabled, false);
  assert.equal(parseAgentKitConfig({ agentKit: { fast: { enabled: true, supportedModels: ["my-openai/gpt-5.5"] } } }).fast.supportedModels[0], "my-openai/gpt-5.5");
  assert.equal(parseAgentKitConfig({}).notificationChannels.windowsToast.enabled, true);
  assert.equal(parseAgentKitConfig({ agentKit: { taskCompletionNotification: false } }).notificationChannels.windowsToast.enabled, false);
  assert.equal(parseAgentKitConfig({}).notificationChannels.telegram.enabled, false);
  const telegramConfig = parseAgentKitConfig({
    agentKit: {
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
  assert.equal(parseAgentKitConfig({
    agentKit: {
      notificationChannels: {
        telegram: {
          chatId: -1001234567890,
        },
      },
    },
  }).notificationChannels.telegram.chatId, "-1001234567890");
  assert.equal(parseAgentKitConfig({}).providerCompat.enabled, true);
  assert.equal(parseAgentKitConfig({}).claudeCodeCompat.enabled, true);
  assert.equal(parseAgentKitConfig({}).codexCompat.enabled, true);
  assert.equal(parseAgentKitConfig({}).codexCompat.store, false);
  const providerCompatConfig = parseAgentKitConfig({
    agentKit: {
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
  assert.equal(parseAgentKitConfig({ agentKit: { providerCompat: { enabled: false } } }).claudeCodeCompat.enabled, true);
  assert.deepEqual(nextAgentKitSetting(undefined, { editorChrome: false }), { editorChrome: false });
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

test("error task completion notifications are coalesced before sending", async () => {
  const state: TaskCompletionNotificationCoalescingState = { taskCompletionErrorNotificationTimer: null };
  const sent: Array<{ status: TaskCompletionNotificationStatus; answer?: string }> = [];
  const send = (status: TaskCompletionNotificationStatus, _channels: NotificationChannelsConfig, answer?: string) => {
    sent.push({ status, answer });
  };

  try {
    notifyTaskCompleteCoalesced(state, "error", disabledNotificationChannels(), "first error", { errorDelayMs: 5, send });
    notifyTaskCompleteCoalesced(state, "error", disabledNotificationChannels(), "second error", { errorDelayMs: 5, send });

    assert.deepEqual(sent, []);
    await wait(20);

    assert.deepEqual(sent, [{ status: "error", answer: "second error" }]);
    assert.equal(state.taskCompletionErrorNotificationTimer, null);
  } finally {
    clearPendingTaskCompletionErrorNotification(state);
  }
});

test("completed and aborted task completion results clear pending error notifications", async () => {
  const state: TaskCompletionNotificationCoalescingState = { taskCompletionErrorNotificationTimer: null };
  const sent: Array<{ status: TaskCompletionNotificationStatus; answer?: string }> = [];
  const send = (status: TaskCompletionNotificationStatus, _channels: NotificationChannelsConfig, answer?: string) => {
    sent.push({ status, answer });
  };

  try {
    notifyTaskCompleteCoalesced(state, "error", disabledNotificationChannels(), "failed", { errorDelayMs: 20, send });
    notifyTaskCompleteCoalesced(state, "completed", disabledNotificationChannels(), "done", { errorDelayMs: 20, send });

    assert.deepEqual(sent, [{ status: "completed", answer: "done" }]);
    assert.equal(state.taskCompletionErrorNotificationTimer, null);
    await wait(30);
    assert.deepEqual(sent, [{ status: "completed", answer: "done" }]);

    notifyTaskCompleteCoalesced(state, "error", disabledNotificationChannels(), "failed again", { errorDelayMs: 20, send });
    notifyTaskCompleteCoalesced(state, "aborted", disabledNotificationChannels(), "stopped", { errorDelayMs: 20, send });

    assert.equal(state.taskCompletionErrorNotificationTimer, null);
    await wait(30);
    assert.deepEqual(sent, [{ status: "completed", answer: "done" }]);
  } finally {
    clearPendingTaskCompletionErrorNotification(state);
  }
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
