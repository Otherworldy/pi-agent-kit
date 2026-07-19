import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClaudeCodeUserAgent,
  buildCodexUserAgent,
  stainlessArch,
  stainlessOs,
  type CodexCompatConfig,
  type ProviderCompatConfig,
} from "../src/config.ts";
import {
  buildClaudeMetadataUserId,
  getClaudeCodeCompatHeaders,
  getClaudeCodeCompatProviderNames,
  getCodexCompatHeaders,
  getCodexCompatProviderNames,
  matchesCompatModelSelector,
  patchClaudeCodeCompatPayload,
  patchCodexCompatPayload,
  supportsClaudeCodeCompat,
  supportsCodexCompat,
} from "../src/provider-compat.ts";

const claudeConfig: ProviderCompatConfig = {
  enabled: true,
  providers: [],
  supportedModels: [],
  headers: { "User-Agent": "claude-cli/test", "X-App": "cli" },
  systemIdentity: true,
  systemText: "You are Claude Code, Anthropic's official CLI for Claude.",
  metadataUserId: "",
};

const codexConfig: CodexCompatConfig = {
  enabled: true,
  providers: [],
  supportedModels: [],
  headers: {
    Originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/test",
    "OpenAI-Beta": "responses=experimental",
    "X-Codex-Beta-Features": "remote_compaction_v2",
    "X-Codex-Turn-Metadata": "",
  },
  systemIdentity: false,
  systemText: "You are Codex CLI, OpenAI's official coding agent.",
  metadataUserId: "",
  store: false,
};

test("provider compat model selectors still support exact, provider wildcard, model-only, and global wildcard", () => {
  const model = { provider: "my-claude", id: "claude-sonnet" };

  assert.equal(matchesCompatModelSelector(model, "my-claude/claude-sonnet"), true);
  assert.equal(matchesCompatModelSelector(model, "my-claude/*"), true);
  assert.equal(matchesCompatModelSelector(model, "*/claude-sonnet"), true);
  assert.equal(matchesCompatModelSelector(model, "claude-sonnet"), true);
  assert.equal(matchesCompatModelSelector(model, "*"), true);
  assert.equal(matchesCompatModelSelector(model, "other/claude-sonnet"), false);
  assert.equal(matchesCompatModelSelector(model, "my-claude/other"), false);
});

test("provider compat auto-detects Claude Code and Codex model families", () => {
  assert.equal(supportsClaudeCodeCompat({ provider: "my-claude", id: "sonnet", api: "openai-responses" }, claudeConfig), true);
  assert.equal(supportsClaudeCodeCompat({ provider: "anthropic", id: "sonnet", api: "anthropic-messages" }, claudeConfig), true);
  assert.equal(supportsClaudeCodeCompat({ provider: "my-codex", id: "gpt-5.5", api: "openai-responses" }, claudeConfig), false);
  assert.equal(supportsClaudeCodeCompat({ provider: "my-claude", id: "sonnet" }, { ...claudeConfig, enabled: false }), false);

  assert.equal(supportsCodexCompat({ provider: "my-codex", id: "gpt-5.5", api: "openai-responses" }, codexConfig), true);
  assert.equal(supportsCodexCompat({ provider: "openai-codex", id: "gpt-5.5", api: "openai-codex-responses" }, codexConfig), true);
  assert.equal(supportsCodexCompat({ provider: "my-openai", id: "custom-model", api: "openai-completions" }, codexConfig), true);
  assert.equal(supportsCodexCompat({ provider: "my-claude", id: "claude-sonnet", api: "openai-responses" }, codexConfig), false);
  assert.equal(supportsCodexCompat({ provider: "my-codex", id: "gpt-5.5", api: "openai-responses" }, { ...codexConfig, enabled: false }), false);
});

test("provider compat registers only the active provider for the detected family", () => {
  assert.deepEqual(getClaudeCodeCompatProviderNames(claudeConfig, { provider: "my-claude", id: "claude-sonnet" }), ["my-claude"]);
  assert.deepEqual(getClaudeCodeCompatProviderNames(claudeConfig, { provider: "my-codex", id: "gpt-5.5", api: "openai-responses" }), []);
  assert.deepEqual(getCodexCompatProviderNames(codexConfig, { provider: "my-codex", id: "gpt-5.5", api: "openai-responses" }), ["my-codex"]);
  assert.deepEqual(getCodexCompatProviderNames(codexConfig, { provider: "my-openai", id: "custom-model", api: "openai-completions" }), ["my-openai"]);
  assert.deepEqual(getCodexCompatProviderNames(codexConfig, { provider: "my-claude", id: "claude-sonnet" }), []);
});

test("Claude Code User-Agent matches official getUserAgent shape", () => {
  assert.equal(
    buildClaudeCodeUserAgent({ version: "2.1.212", userType: "external", entrypoint: "cli" }),
    "claude-cli/2.1.212 (external, cli)",
  );
  assert.equal(
    buildClaudeCodeUserAgent({
      version: "2.1.212",
      userType: "external",
      entrypoint: "cli",
      agentSdkVersion: "0.1.0",
      clientApp: "my-app/1.0",
    }),
    "claude-cli/2.1.212 (external, cli, agent-sdk/0.1.0, client-app/my-app/1.0)",
  );
  assert.equal(stainlessOs("darwin"), "MacOS");
  assert.equal(stainlessOs("linux"), "Linux");
  assert.equal(stainlessOs("win32"), "Windows");
  assert.equal(stainlessArch("x64"), "x64");
  assert.equal(stainlessArch("arm64"), "arm64");
});

test("Claude Code compat builds session header from real session id", () => {
  const headers = getClaudeCodeCompatHeaders(claudeConfig, "session-abc");
  assert.equal(headers["User-Agent"], "claude-cli/test");
  assert.equal(headers["X-App"], "cli");
  assert.equal(headers["X-Claude-Code-Session-Id"], "session-abc");
  assert.equal(headers["x-claude-code-session-id"], "session-abc");
});

test("Claude Code metadata.user_id uses sub2api-compatible JSON format", () => {
  const auto = JSON.parse(buildClaudeMetadataUserId("sess-1"));
  assert.equal(auto.device_id.length, 64);
  assert.equal(auto.account_uuid, "");
  assert.equal(auto.session_id, "sess-1");
  assert.equal(buildClaudeMetadataUserId("sess-1", "custom-id"), "custom-id");
});

test("Claude Code compat patches native Anthropic payloads without mutating originals", () => {
  const payload = {
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
    system: [{ type: "text", text: "Base prompt" }],
  };
  const expectedUserId = buildClaudeMetadataUserId("sess-1");

  const patched = patchClaudeCodeCompatPayload(payload, {
    config: claudeConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
    sessionId: "sess-1",
  });

  assert.deepEqual(payload, {
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
    system: [{ type: "text", text: "Base prompt" }],
  });
  assert.deepEqual(patched, {
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
    system: [
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: "text", text: "Base prompt" },
    ],
    metadata: { user_id: expectedUserId },
  });
});

test("Claude Code compat patches OpenAI chat and responses payload shapes", () => {
  const expectedUserId = buildClaudeMetadataUserId("sess-1");
  assert.deepEqual(patchClaudeCodeCompatPayload({
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
  }, {
    config: claudeConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
    sessionId: "sess-1",
  }), {
    model: "claude-sonnet",
    messages: [
      { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
      { role: "user", content: "hi" },
    ],
    metadata: { user_id: expectedUserId },
  });

  assert.deepEqual(patchClaudeCodeCompatPayload({
    model: "claude-sonnet",
    input: [{ role: "user", content: "hi" }],
  }, {
    config: claudeConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
    sessionId: "sess-1",
  }), {
    model: "claude-sonnet",
    input: [
      { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
      { role: "user", content: "hi" },
    ],
    metadata: { user_id: expectedUserId },
  });
});

test("Claude Code compat returns undefined when nothing changes or model is unsupported", () => {
  assert.equal(patchClaudeCodeCompatPayload({ model: "gpt-5.5" }, {
    config: claudeConfig,
    model: { provider: "my-codex", id: "gpt-5.5", api: "openai-responses" },
    sessionId: "sess-1",
  }), undefined);

  const userId = buildClaudeMetadataUserId("sess-1");
  assert.equal(patchClaudeCodeCompatPayload({
    system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
    metadata: { user_id: userId },
  }, {
    config: claudeConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
    sessionId: "sess-1",
  }), undefined);
});

test("Codex User-Agent matches official get_codex_user_agent shape", () => {
  assert.equal(
    buildCodexUserAgent({
      originator: "codex_cli_rs",
      version: "0.144.5",
      platform: "linux",
      arch: "x64",
      osVersion: "6.8.0",
      terminal: "tmux",
    }),
    "codex_cli_rs/0.144.5 (Linux 6.8.0; x86_64) tmux",
  );
  assert.equal(
    buildCodexUserAgent({
      originator: "codex_cli_rs",
      version: "0.144.5",
      platform: "darwin",
      arch: "arm64",
      osVersion: "14.5.0",
      terminal: "iTerm.app/3.5.0",
    }),
    "codex_cli_rs/0.144.5 (Mac OS 14.5.0; arm64) iTerm.app/3.5.0",
  );
});

test("Codex compat builds Codex CLI-like headers with real session metadata", () => {
  const headers = getCodexCompatHeaders(codexConfig, "session-id", { provider: "my-codex", id: "gpt-5.5" });

  assert.equal(headers.Originator, "codex_cli_rs");
  assert.equal(headers["User-Agent"], "codex_cli_rs/test");
  assert.equal(headers["OpenAI-Beta"], "responses=experimental");
  assert.equal(headers["X-Codex-Beta-Features"], "remote_compaction_v2");
  assert.equal(headers.Session_id, "session-id");
  assert.equal(headers["session-id"], "session-id");
  assert.equal(headers["Session-Id"], "session-id");
  assert.equal(headers.Thread_id, "session-id");
  assert.equal(headers["thread-id"], "session-id");
  assert.equal(headers["Thread-Id"], "session-id");
  assert.equal(headers["X-Client-Request-Id"], "session-id");
  assert.equal(headers["x-client-request-id"], "session-id");
  assert.equal(headers["X-Codex-Window-Id"], "session-id:0");
  assert.equal(headers["x-codex-window-id"], "session-id:0");

  const metadata = JSON.parse(headers["X-Codex-Turn-Metadata"]);
  assert.equal(typeof metadata.installation_id, "string");
  assert.ok(metadata.installation_id.length > 0);
  assert.equal(metadata.session_id, "session-id");
  assert.equal(metadata.thread_id, "session-id");
  assert.equal(metadata.window_id, "session-id:0");
  assert.equal(metadata.request_kind, "turn");
  assert.equal(metadata.model, "gpt-5.5");
  assert.equal(typeof metadata.turn_id, "string");
  assert.equal(typeof metadata.turn_started_at_unix_ms, "number");
});

test("Codex compat omits empty beta features header", () => {
  const headers = getCodexCompatHeaders({
    ...codexConfig,
    headers: {
      Originator: "codex_cli_rs",
      "User-Agent": "codex_cli_rs/test",
      "OpenAI-Beta": "responses=experimental",
      "X-Codex-Beta-Features": "",
      "X-Codex-Turn-Metadata": "",
    },
  }, "session-id");

  assert.equal(headers["X-Codex-Beta-Features"], undefined);
  assert.ok(headers["X-Codex-Turn-Metadata"]);
});

test("Codex compat patches OpenAI Responses payloads without mutating originals", () => {
  const payload = {
    model: "gpt-5.5",
    input: [{ role: "user", content: "hi" }],
    max_output_tokens: 1024,
  };

  const patched = patchCodexCompatPayload(payload, {
    config: codexConfig,
    model: { provider: "my-codex", id: "gpt-5.5", api: "openai-codex-responses" },
    sessionId: "session-id",
  }) as Record<string, unknown>;

  assert.deepEqual(payload, {
    model: "gpt-5.5",
    input: [{ role: "user", content: "hi" }],
    max_output_tokens: 1024,
  });
  assert.equal(patched.model, "gpt-5.5");
  assert.equal(patched.prompt_cache_key, "session-id");
  assert.equal(patched.store, false);
  assert.equal(patched.instructions, "");
  const cm = patched.client_metadata as Record<string, string>;
  assert.ok(cm["x-codex-installation-id"]?.length);
  assert.equal(cm.session_id, "session-id");
  assert.equal(cm.thread_id, "session-id");
  assert.equal(cm["x-codex-window-id"], "session-id:0");
  assert.equal(typeof cm.turn_id, "string");
});

test("Codex compat preserves upstream cache and installation IDs", () => {
  const patched = patchCodexCompatPayload({
    model: "gpt-5.5",
    input: [{ role: "user", content: "hi" }],
    prompt_cache_key: "upstream-cache-key",
    client_metadata: { "x-codex-installation-id": "upstream-installation-id" },
  }, {
    config: codexConfig,
    model: { provider: "my-codex", id: "gpt-5.5", api: "openai-responses" },
    sessionId: "session-id",
  }) as Record<string, unknown>;

  assert.equal(patched.prompt_cache_key, "upstream-cache-key");
  const cm = patched.client_metadata as Record<string, string>;
  assert.equal(cm["x-codex-installation-id"], "upstream-installation-id");
  assert.equal(cm.session_id, "session-id");
});

test("Codex compat can prepend optional instructions and skips non-responses payloads", () => {
  const patched = patchCodexCompatPayload({
    model: "gpt-5.5",
    instructions: "Base instructions",
    input: [{ role: "user", content: "hi" }],
  }, {
    config: { ...codexConfig, systemIdentity: true },
    model: { provider: "my-codex", id: "gpt-5.5", api: "openai-responses" },
    sessionId: "session-id",
  }) as Record<string, unknown>;

  assert.equal(
    patched.instructions,
    "You are Codex CLI, OpenAI's official coding agent.\nBase instructions",
  );
  assert.equal(patched.prompt_cache_key, "session-id");
  assert.equal(patched.store, false);
  assert.ok((patched.client_metadata as Record<string, string>)["x-codex-installation-id"]);

  assert.equal(patchCodexCompatPayload({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "hi" }],
  }, {
    config: codexConfig,
    model: { provider: "other", id: "custom-model", api: "openai-completions" },
    sessionId: "session-id",
  }), undefined);
});
