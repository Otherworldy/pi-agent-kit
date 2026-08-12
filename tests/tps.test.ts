import test from "node:test";
import assert from "node:assert/strict";

import { estimateDeltaTokens, formatTpsLabel, TpsMeter } from "../src/tps.ts";

test("tps meter computes rate from a sliding window", () => {
  const meter = new TpsMeter(5000);
  let now = 0;

  // 100 tokens in the first 1000ms → 100 t/s
  meter.record(100, now);
  meter.record(100, now + 1000);
  assert.equal(meter.getTps(now + 1000), 200);
});

test("tps meter drops samples outside the window", () => {
  const meter = new TpsMeter(1000);
  let now = 0;

  meter.record(100, now);
  meter.record(100, now + 500);
  meter.record(100, now + 2000);
  // old samples dropped → single sample → no rate
  assert.equal(meter.getTps(now + 2000), 0);
});

test("tps meter clear keeps last rate, reset zeroes it", () => {
  const meter = new TpsMeter(5000);
  meter.record(50, 0);
  meter.record(50, 1000);
  const live = meter.getTps(1000);
  assert.ok(live > 0);

  // stream ends → freeze last rate
  meter.clear();
  assert.equal(meter.getTps(2000), live);

  // new session → back to zero
  meter.reset();
  assert.equal(meter.getTps(2000), 0);
});

test("estimateDeltaTokens uses chars/4 heuristic", () => {
  assert.equal(estimateDeltaTokens(""), 0);
  assert.equal(estimateDeltaTokens("abcd"), 1);
  assert.equal(estimateDeltaTokens("abcdef"), 2);
});

test("formatTpsLabel formats rates and shows 0 when idle", () => {
  assert.equal(formatTpsLabel(0), "0 t/s");
  assert.equal(formatTpsLabel(-1), "0 t/s");
  assert.equal(formatTpsLabel(45.7), "45.7 t/s");
  assert.equal(formatTpsLabel(45.0), "45 t/s");
  assert.equal(formatTpsLabel(123), "123 t/s");
});
