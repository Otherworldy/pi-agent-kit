import test from "node:test";
import assert from "node:assert/strict";

import { formatTtftLabel, TtftMeter } from "../src/ttft.ts";

test("ttft meter averages completed request-to-first-token spans", () => {
  const meter = new TtftMeter();
  assert.equal(meter.getAverageMs(), 0);

  meter.markRequest(0);
  meter.markFirstToken(400);
  assert.equal(meter.getAverageMs(), 400);

  meter.markRequest(1000);
  meter.markFirstToken(1800);
  assert.equal(meter.getAverageMs(), 600);
});

test("ttft meter ignores extra tokens and tokens without a request", () => {
  const meter = new TtftMeter();
  meter.markFirstToken(50);
  assert.equal(meter.getAverageMs(), 0);

  meter.markRequest(100);
  meter.markFirstToken(300);
  meter.markFirstToken(900);
  assert.equal(meter.getAverageMs(), 200);
});

test("ttft meter drops in-flight request on clear, reset zeroes average", () => {
  const meter = new TtftMeter();
  meter.markRequest(0);
  meter.markFirstToken(400);
  meter.markRequest(500);
  meter.clearPending();
  meter.markFirstToken(900);
  assert.equal(meter.getAverageMs(), 400);

  meter.reset();
  assert.equal(meter.getAverageMs(), 0);
});

test("ttft meter later request replaces a pending start", () => {
  const meter = new TtftMeter();
  meter.markRequest(0);
  meter.markRequest(100);
  meter.markFirstToken(250);
  assert.equal(meter.getAverageMs(), 150);
});

test("formatTtftLabel formats ms/s and shows 0 when empty", () => {
  assert.equal(formatTtftLabel(0), "0ms ttft");
  assert.equal(formatTtftLabel(-1), "0ms ttft");
  assert.equal(formatTtftLabel(450.4), "450ms ttft");
  assert.equal(formatTtftLabel(1000), "1s ttft");
  assert.equal(formatTtftLabel(1500), "1.5s ttft");
  assert.equal(formatTtftLabel(10500), "11s ttft");
});
