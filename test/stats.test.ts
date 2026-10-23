import { test } from "node:test";
import assert from "node:assert/strict";
import { diffProportions, mean, wilson } from "../src/stats.js";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("wilson matches reference values", () => {
  const w = wilson(8, 10);
  close(w.low, 0.4902);
  close(w.high, 0.9433);
  const z = wilson(0, 10);
  assert.equal(z.low, 0);
  close(z.high, 0.2775);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
});

test("diffProportions uses Newcombe's interval", () => {
  // Newcombe (1998), example (a): 56/70 vs 48/80 -> 0.2 [0.0524, 0.3339]
  const d = diffProportions(56, 70, 48, 80);
  close(d.diff, 0.2);
  close(d.interval.low, 0.0524);
  close(d.interval.high, 0.3339);
  assert.equal(d.significant, true);
  const small = diffProportions(3, 5, 2, 5);
  assert.equal(small.significant, false);
  assert.ok(small.interval.low < 0 && small.interval.high > 0);
});

test("mean handles empty input", () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
});
