import test from "node:test";
import assert from "node:assert/strict";

import type { ClaudeCodeCompatConfig } from "../src/config.ts";
import {
  getClaudeCodeCompatProviderNames,
  matchesCompatModelSelector,
  patchClaudeCodeCompatPayload,
  supportsClaudeCodeCompat,
} from "../src/provider-compat.ts";

const baseConfig: ClaudeCodeCompatConfig = {
  enabled: true,
  providers: ["my-claude"],
  supportedModels: ["my-claude/claude-sonnet", "other/*"],
  headers: { "User-Agent": "claude-cli/test", "X-App": "cli" },
  metadataUserId: "pi-agent",
  systemIdentity: true,
  systemText: "You are Claude Code, Anthropic's official CLI for Claude.",
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
