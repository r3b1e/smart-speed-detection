import { describe, expect, it } from "vitest";
import {
  DeviceCommandSchema,
  IngestDetectionSchema,
  SerialLineSchema,
  applyScale,
  severityFor,
  speedKmhFromDtUs,
  dtUsFromSpeedKmh,
  gateTripLimitKmh,
} from "../index";

describe("serial protocol contract", () => {
  it("accepts a hello line", () => {
    const parsed = SerialLineSchema.parse({
      t: "hello",
      fw: "1.0.0",
      limit: 40.0,
      boot: 305419896,
    });
    expect(parsed.t).toBe("hello");
  });

  it("accepts a detection line exactly as the firmware emits it", () => {
    const parsed = SerialLineSchema.parse({
      t: "detection",
      dt_us: 8500,
      speed_kmh: 42.35,
      dir: "fwd",
      over: true,
      limit: 40.0,
      seq: 17,
    });
    expect(parsed.t).toBe("detection");
  });

  it("accepts hb and ack lines", () => {
    expect(SerialLineSchema.parse({ t: "hb", seq: 17 }).t).toBe("hb");
    expect(SerialLineSchema.parse({ t: "ack", cmd: "set_limit" }).t).toBe("ack");
  });

  it("rejects unknown line kinds", () => {
    expect(SerialLineSchema.safeParse({ t: "nope" }).success).toBe(false);
    expect(SerialLineSchema.safeParse("garbage").success).toBe(false);
  });

  it("round-trips device commands", () => {
    expect(DeviceCommandSchema.parse({ cmd: "set_limit", kmh: 40 })).toEqual({
      cmd: "set_limit",
      kmh: 40,
    });
    expect(DeviceCommandSchema.parse({ cmd: "buzzer_test" }).cmd).toBe("buzzer_test");
    expect(DeviceCommandSchema.parse({ cmd: "ping" }).cmd).toBe("ping");
    expect(DeviceCommandSchema.safeParse({ cmd: "set_limit", kmh: 0.1 }).success).toBe(true);
    expect(DeviceCommandSchema.safeParse({ cmd: "set_limit", kmh: 0.05 }).success).toBe(false);
    expect(DeviceCommandSchema.safeParse({ cmd: "set_limit", kmh: 999 }).success).toBe(false);
  });
});

describe("bridge -> server ingest payload", () => {
  const base = {
    seq: 17,
    bootId: "305419896",
    dtMicros: 8500,
    measuredSpeedKmh: 42.35,
    deviceOver: true,
    direction: "fwd" as const,
    deviceLimitKmh: 40,
    receivedAt: "2025-11-05T10:20:30.123Z",
    source: "arduino" as const,
  };

  it("accepts a valid payload", () => {
    const parsed = IngestDetectionSchema.parse(base);
    expect(parsed.bootId).toBe("305419896");
  });

  it("rejects non-Arduino provenance", () => {
    expect(IngestDetectionSchema.safeParse({ ...base, source: "simulator" }).success).toBe(false);
  });

  it("rejects missing fields and bad dates", () => {
    const { receivedAt: _r, ...missing } = base;
    expect(IngestDetectionSchema.safeParse(missing).success).toBe(false);
    expect(IngestDetectionSchema.safeParse({ ...base, receivedAt: "yesterday" }).success).toBe(
      false
    );
    expect(IngestDetectionSchema.safeParse({ ...base, dtMicros: -1 }).success).toBe(false);
  });
});

describe("physics", () => {
  it("converts dt_us to km/h per spec (360000 / dt_us)", () => {
    expect(speedKmhFromDtUs(8500)).toBeCloseTo(42.3529, 3);
    expect(speedKmhFromDtUs(9000)).toBe(40);
  });

  it("round-trips speed and gate timing", () => {
    expect(dtUsFromSpeedKmh(40)).toBe(9000);
    expect(speedKmhFromDtUs(dtUsFromSpeedKmh(72.5))).toBeCloseTo(72.5, 1); // integer dt rounding
  });

  it("applies the scale factor", () => {
    expect(applyScale(10, 1)).toBe(10);
    expect(applyScale(10, 10.5)).toBe(105);
    expect(applyScale(12.34, 1)).toBe(12.3);
  });

  it("converts the real-world limit into the buzzer's raw gate threshold", () => {
    expect(gateTripLimitKmh(30, 5)).toBe(6);
    expect(gateTripLimitKmh(40, 1)).toBe(40);
    expect(gateTripLimitKmh(5, 1000)).toBe(0.1);
  });
});

describe("severity buckets", () => {
  it("classifies percent-over-limit into low/medium/high", () => {
    expect(severityFor(40, 40)).toBe("low");
    expect(severityFor(45, 40)).toBe("low"); // +12.5%
    expect(severityFor(50, 40)).toBe("medium"); // +25%
    expect(severityFor(60, 40)).toBe("high"); // +50%
    expect(severityFor(100, 40)).toBe("high");
  });
});
