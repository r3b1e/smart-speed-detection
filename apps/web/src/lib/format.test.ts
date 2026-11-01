import { describe, expect, it } from "vitest";
import {
  cn,
  formatDateTime,
  formatDelta,
  formatRelative,
  formatSpeed,
  toDateInput,
} from "./format";

describe("cn", () => {
  it("merges classes and lets the last conflicting tailwind class win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });
});

describe("formatSpeed", () => {
  it("renders one decimal", () => {
    expect(formatSpeed(42.345)).toBe("42.3");
    expect(formatSpeed(100)).toBe("100.0");
  });
});

describe("formatRelative", () => {
  it("renders never for null", () => {
    expect(formatRelative(null)).toBe("never");
  });

  it("renders human buckets", () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 5_000).toISOString())).toBe("just now");
    expect(formatRelative(new Date(now - 30_000).toISOString())).toBe("30s ago");
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(formatRelative(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(formatRelative(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });
});

describe("formatDelta", () => {
  it("handles null and signed percentages", () => {
    expect(formatDelta(null)).toBe("—");
    expect(formatDelta(2.56)).toBe("+2.6%");
    expect(formatDelta(-1.5)).toBe("-1.5%");
  });
});

describe("toDateInput", () => {
  it("slices the ISO date", () => {
    expect(toDateInput("2026-10-07T14:30:00Z")).toBe("2026-10-07");
  });
});

describe("formatDateTime", () => {
  it("produces a non-empty locale string", () => {
    expect(formatDateTime("2026-10-07T14:30:00Z")).toBeTruthy();
  });
});
