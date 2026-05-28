import test from "node:test";
import assert from "node:assert/strict";

import {
  formatFastStatusLabel,
  getModelKey,
  parseFastCommand,
  patchFastPayload,
  supportsFast,
} from "../src/fast-mode.ts";

test("fast mode computes provider/model keys and allow-list support", () => {
  assert.equal(getModelKey({ provider: "my-openai", id: "gpt-5.5" }), "my-openai/gpt-5.5");
  assert.equal(getModelKey({ id: "gpt-5.5" }), "gpt-5.5");
  assert.equal(getModelKey(undefined), null);

  assert.equal(supportsFast({ provider: "my-openai", id: "gpt-5.5" }, ["my-openai/gpt-5.5"]), true);
  assert.equal(supportsFast({ provider: "other", id: "gpt-5.5" }, ["my-openai/gpt-5.5"]), false);
  assert.equal(supportsFast({ provider: "other", id: "gpt-5.5" }, ["gpt-5.5"]), true);
});

test("fast mode patches supported object payloads without mutating or overriding service_tier", () => {
  const payload = { model: "gpt-5.5", input: "hi" };
  const patched = patchFastPayload(payload, {
    enabled: true,
    model: { provider: "my-openai", id: "gpt-5.5" },
    supportedModels: ["my-openai/gpt-5.5"],
    serviceTier: "priority",
  });

  assert.deepEqual(patched, { model: "gpt-5.5", input: "hi", service_tier: "priority" });
  assert.deepEqual(payload, { model: "gpt-5.5", input: "hi" });

  assert.equal(patchFastPayload({ service_tier: "default" }, {
    enabled: true,
    model: { provider: "my-openai", id: "gpt-5.5" },
    supportedModels: ["my-openai/gpt-5.5"],
  }), undefined);
});

test("fast mode does not patch disabled, unsupported, or non-object payloads", () => {
  const options = {
    enabled: true,
    model: { provider: "my-openai", id: "gpt-5.5" },
    supportedModels: ["my-openai/gpt-5.5"],
  };

  assert.equal(patchFastPayload({ model: "gpt-5.5" }, { ...options, enabled: false }), undefined);
  assert.equal(patchFastPayload({ model: "gpt-5.5" }, { ...options, supportedModels: ["openai/gpt-5.5"] }), undefined);
  assert.equal(patchFastPayload(null, options), undefined);
  assert.equal(patchFastPayload([], options), undefined);
});

test("fast command parsing and status labels are stable", () => {
  assert.deepEqual(parseFastCommand(""), { action: "toggle" });
  assert.deepEqual(parseFastCommand("on"), { action: "on" });
  assert.deepEqual(parseFastCommand("disable"), { action: "off" });
  assert.deepEqual(parseFastCommand("status"), { action: "status" });
  assert.deepEqual(parseFastCommand("reload"), { action: "reload" });
  assert.deepEqual(parseFastCommand("--help"), { action: "help" });

  assert.equal(formatFastStatusLabel(false, { provider: "openai", id: "gpt-5.5" }, ["openai/gpt-5.5"]), undefined);
  assert.equal(formatFastStatusLabel(true, { provider: "openai", id: "gpt-5.5" }, ["openai/gpt-5.5"]), "⚡ fast");
  assert.equal(formatFastStatusLabel(true, { provider: "other", id: "gpt-5.5" }, ["openai/gpt-5.5"]), "⚡ fast*");
});
