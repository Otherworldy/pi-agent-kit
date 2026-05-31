import test from "node:test";
import assert from "node:assert/strict";

import type { CodexCompatConfig, ProviderCompatConfig } from "../src/config.ts";
import {
  getClaudeCodeCompatProviderNames,
  getCodexCompatHeaders,
  getCodexCompatProviderNames,
  matchesCompatModelSelector,
  patchClaudeCodeCompatPayload,
  patchCodexCompatPayload,
  supportsClaudeCodeCompat,
  supportsCodexCompat,
} from "../src/provider-compat.ts";

const baseConfig: ProviderCompatConfig = {
  enabled: true,
  providers: ["my-claude"],
  supportedModels: ["my-claude/claude-sonnet", "other/*"],
  headers: { "User-Agent": "claude-cli/test", "X-App": "cli" },
  metadataUserId: "pi-agent",
  systemIdentity: true,
  systemText: "You are Claude Code, Anthropic's official CLI for Claude.",
};

const codexConfig: CodexCompatConfig = {
  enabled: true,
  providers: ["my-codex"],
  supportedModels: ["my-codex/gpt-5.5"],
  headers: {
    Originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/test",
    "OpenAI-Beta": "responses=experimental",
    "X-Codex-Beta-Features": "remote_compaction_v2",
    "X-Codex-Turn-Metadata": "",
  },
  metadataUserId: "pi-agent",
  systemIdentity: false,
  systemText: "You are Codex CLI, OpenAI's official coding agent.",
  promptCacheKey: "pi-agent",
  store: false,
};

test("Claude Code compat model selectors support exact, provider wildcard, model-only, and global wildcard", () => {
  const model = { provider: "my-claude", id: "claude-sonnet" };

  assert.equal(matchesCompatModelSelector(model, "my-claude/claude-sonnet"), true);
  assert.equal(matchesCompatModelSelector(model, "my-claude/*"), true);
  assert.equal(matchesCompatModelSelector(model, "*/claude-sonnet"), true);
  assert.equal(matchesCompatModelSelector(model, "claude-sonnet"), true);
  assert.equal(matchesCompatModelSelector(model, "*"), true);
  assert.equal(matchesCompatModelSelector(model, "other/claude-sonnet"), false);
  assert.equal(matchesCompatModelSelector(model, "my-claude/other"), false);
});

test("Claude Code compat support uses config activation and allow list", () => {
  assert.equal(supportsClaudeCodeCompat({ provider: "my-claude", id: "claude-sonnet" }, baseConfig), true);
  assert.equal(supportsClaudeCodeCompat({ provider: "other", id: "any" }, baseConfig), true);
  assert.equal(supportsClaudeCodeCompat({ provider: "my-claude", id: "haiku" }, baseConfig), false);
  assert.equal(supportsClaudeCodeCompat({ provider: "my-claude", id: "claude-sonnet" }, {
    ...baseConfig,
    enabled: false,
  }), false);
  assert.equal(supportsClaudeCodeCompat({ provider: "unlisted", id: "model" }, {
    ...baseConfig,
    supportedModels: [],
  }), false);
  assert.equal(supportsClaudeCodeCompat({ provider: "unlisted", id: "model" }, {
    ...baseConfig,
    providers: [],
    supportedModels: [],
  }), true);
});

test("Claude Code compat provider registration list combines explicit providers and model selectors", () => {
  assert.deepEqual(getClaudeCodeCompatProviderNames(baseConfig, { provider: "active", id: "model" }).sort(), [
    "my-claude",
    "other",
  ]);

  assert.deepEqual(getClaudeCodeCompatProviderNames({
    ...baseConfig,
    supportedModels: ["*"],
  }, { provider: "active", id: "model" }).sort(), ["active", "my-claude"]);
});

test("Claude Code compat patches native Anthropic payloads without mutating originals", () => {
  const payload = {
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
    system: [{ type: "text", text: "Base prompt" }],
  };

  const patched = patchClaudeCodeCompatPayload(payload, {
    config: baseConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
  });

  assert.deepEqual(payload, {
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
    system: [{ type: "text", text: "Base prompt" }],
  });
  assert.deepEqual(patched, {
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
    metadata: { user_id: "pi-agent" },
    system: [
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: "text", text: "Base prompt" },
    ],
  });
});

test("Claude Code compat patches OpenAI chat and responses payload shapes", () => {
  assert.deepEqual(patchClaudeCodeCompatPayload({
    model: "claude-sonnet",
    messages: [{ role: "user", content: "hi" }],
  }, {
    config: baseConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
  }), {
    model: "claude-sonnet",
    messages: [
      { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
      { role: "user", content: "hi" },
    ],
    metadata: { user_id: "pi-agent" },
  });

  assert.deepEqual(patchClaudeCodeCompatPayload({
    model: "claude-sonnet",
    input: [{ role: "user", content: "hi" }],
  }, {
    config: baseConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
  }), {
    model: "claude-sonnet",
    input: [
      { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
      { role: "user", content: "hi" },
    ],
    metadata: { user_id: "pi-agent" },
  });
});

test("Claude Code compat returns undefined when nothing changes or model is unsupported", () => {
  assert.equal(patchClaudeCodeCompatPayload({ model: "haiku" }, {
    config: baseConfig,
    model: { provider: "my-claude", id: "haiku" },
  }), undefined);

  assert.equal(patchClaudeCodeCompatPayload({
    metadata: { user_id: "pi-agent" },
    system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
  }, {
    config: baseConfig,
    model: { provider: "my-claude", id: "claude-sonnet" },
  }), undefined);
});

test("Codex compat support and provider registration follow provider/model selectors", () => {
  assert.equal(supportsCodexCompat({ provider: "my-codex", id: "gpt-5.5" }, codexConfig), true);
  assert.equal(supportsCodexCompat({ provider: "my-codex", id: "gpt-5.4" }, codexConfig), false);
  assert.deepEqual(getCodexCompatProviderNames(codexConfig, { provider: "active", id: "model" }), ["my-codex"]);
  assert.deepEqual(getCodexCompatProviderNames({ ...codexConfig, supportedModels: ["*"] }, { provider: "active", id: "model" }).sort(), ["active", "my-codex"]);
});

test("Codex compat builds Codex CLI-like headers with turn metadata", () => {
  const headers = getCodexCompatHeaders(codexConfig, { provider: "my-codex", id: "gpt-5.5" });

  assert.equal(headers.Originator, "codex_cli_rs");
  assert.equal(headers["User-Agent"], "codex_cli_rs/test");
  assert.equal(headers["OpenAI-Beta"], "responses=experimental");
  assert.equal(headers["X-Codex-Beta-Features"], "remote_compaction_v2");
  assert.equal(headers.Session_id, "pi-agent");

  const metadata = JSON.parse(headers["X-Codex-Turn-Metadata"]);
  assert.equal(metadata.session_id, "pi-agent");
  assert.equal(metadata.thread_id, "pi-agent");
  assert.equal(metadata.request_kind, "turn");
  assert.equal(metadata.model, "gpt-5.5");
  assert.equal(typeof metadata.turn_id, "string");
  assert.equal(typeof metadata.turn_started_at_unix_ms, "number");
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
  });

  assert.deepEqual(payload, {
    model: "gpt-5.5",
    input: [{ role: "user", content: "hi" }],
    max_output_tokens: 1024,
  });
  assert.deepEqual(patched, {
    model: "gpt-5.5",
    input: [{ role: "user", content: "hi" }],
    max_output_tokens: 1024,
    prompt_cache_key: "pi-agent",
    store: false,
    instructions: "",
    client_metadata: { "x-codex-installation-id": "pi-agent" },
  });
});

test("Codex compat can prepend optional instructions and skips non-responses payloads", () => {
  assert.deepEqual(patchCodexCompatPayload({
    model: "gpt-5.5",
    instructions: "Base instructions",
    input: [{ role: "user", content: "hi" }],
  }, {
    config: { ...codexConfig, systemIdentity: true },
    model: { provider: "my-codex", id: "gpt-5.5", api: "openai-responses" },
  }), {
    model: "gpt-5.5",
    instructions: "You are Codex CLI, OpenAI's official coding agent.\nBase instructions",
    input: [{ role: "user", content: "hi" }],
    prompt_cache_key: "pi-agent",
    store: false,
    client_metadata: { "x-codex-installation-id": "pi-agent" },
  });

  assert.equal(patchCodexCompatPayload({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "hi" }],
  }, {
    config: codexConfig,
    model: { provider: "my-codex", id: "gpt-5.5", api: "openai-completions" },
  }), undefined);
});
