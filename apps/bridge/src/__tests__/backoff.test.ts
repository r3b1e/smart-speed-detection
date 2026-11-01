import { describe, expect, it } from "vitest";
import { backoffDelay } from "../backoff";

describe("backoffDelay", () => {
  const rngZero = () => 0;
  const rngOne = () => 0.999999;

  it("attempt 1 always returns exactly min, independent of jitter", () => {
    expect(backoffDelay(1, 1000, 30_000, rngZero)).toBe(1000);
    expect(backoffDelay(1, 1000, 30_000, rngOne)).toBe(1000);
  });

  it("grows exponentially toward min * 2^(attempt-1)", () => {
    // rng 0 -> floor of the step is minMs (decorrelated jitter keeps a floor)
    expect(backoffDelay(2, 1000, 30_000, rngZero)).toBe(1000);
    expect(backoffDelay(5, 1000, 30_000, rngZero)).toBe(1000);
    // rng ~1 -> ceiling of the step: 2^(attempt-1) * min
    expect(backoffDelay(2, 1000, 30_000, rngOne)).toBe(2000);
    expect(backoffDelay(5, 1000, 30_000, rngOne)).toBe(16_000);
  });

  it("never exceeds the ceiling", () => {
    expect(backoffDelay(20, 1000, 30_000, rngOne)).toBe(30_000);
    expect(backoffDelay(20, 1000, 30_000, rngZero)).toBe(1000);
    const mid = backoffDelay(30, 1000, 30_000, () => 0.5);
    expect(mid).toBeLessThanOrEqual(30_000);
    expect(mid).toBeGreaterThanOrEqual(1000);
  });

  it("keeps jitter within [min, ceiling] of each step", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const delay = backoffDelay(4, 1000, 30_000, () => r);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(8000);
    }
  });

  it("clamps weird inputs instead of throwing", () => {
    expect(backoffDelay(0, 1000, 30_000, () => 0.5)).toBe(1000);
    expect(backoffDelay(-5, 1000, 30_000, () => 0.5)).toBe(1000);
    // min > max -> ceiling = max, floor = min(ceiling, min) = max -> always max
    expect(backoffDelay(3, 50_000, 30_000, () => 0.5)).toBe(30_000);
  });
});
