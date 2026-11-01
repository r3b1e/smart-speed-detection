import { describe, expect, it } from "vitest";
import { parseSerialLine } from "../protocol";

describe("parseSerialLine", () => {
  it("returns empty for blank lines", () => {
    expect(parseSerialLine("")).toEqual({ kind: "empty" });
    expect(parseSerialLine("   ")).toEqual({ kind: "empty" });
    expect(parseSerialLine("\n")).toEqual({ kind: "empty" });
  });

  it("passes debug lines through untouched", () => {
    expect(parseSerialLine("# debug boot")).toEqual({ kind: "debug" });
    expect(parseSerialLine("#listening")).toEqual({ kind: "debug" });
  });

  it("parses a valid detection line", () => {
    const raw = JSON.stringify({
      t: "detection",
      dt_us: 125000,
      speed_kmh: 28.8,
      dir: "fwd",
      over: false,
      limit: 40,
      seq: 7,
    });
    const result = parseSerialLine(raw);
    expect(result.kind).toBe("line");
    if (result.kind !== "line") throw new Error("unreachable");
    expect(result.line).toMatchObject({ t: "detection", seq: 7, speed_kmh: 28.8 });
  });

  it("parses hello, heartbeat and ack lines", () => {
    const hello = parseSerialLine(
      JSON.stringify({ t: "hello", fw: "1.0.0", limit: 50, boot: 123456 })
    );
    expect(hello.kind).toBe("line");
    const hb = parseSerialLine(JSON.stringify({ t: "hb", seq: 9 }));
    expect(hb.kind).toBe("line");
    if (hb.kind !== "line") throw new Error("unreachable");
    expect(hb.line).toMatchObject({ t: "hb", seq: 9 });
    const ack = parseSerialLine(JSON.stringify({ t: "ack", cmd: "set_limit" }));
    expect(ack.kind).toBe("line");
  });

  it("flags malformed JSON as malformed", () => {
    expect(parseSerialLine("{not json")).toEqual({ kind: "malformed", line: "{not json" });
    expect(parseSerialLine('"just a string"')).toEqual({
      kind: "malformed",
      line: '"just a string"',
    });
  });

  it("flags schema-violating lines as malformed", () => {
    // negative speed
    const bad1 = parseSerialLine(
      JSON.stringify({
        t: "detection",
        dt_us: 1,
        speed_kmh: -5,
        dir: "fwd",
        over: false,
        limit: 40,
        seq: 1,
      })
    );
    expect(bad1.kind).toBe("malformed");
    // unknown type
    const bad2 = parseSerialLine(JSON.stringify({ t: "mystery" }));
    expect(bad2.kind).toBe("malformed");
    // missing seq
    const bad3 = parseSerialLine(
      JSON.stringify({
        t: "detection",
        dt_us: 1,
        speed_kmh: 10,
        dir: "rev",
        over: false,
        limit: 40,
      })
    );
    expect(bad3.kind).toBe("malformed");
  });

  it("flags out-of-range values as malformed", () => {
    const tooFast = parseSerialLine(
      JSON.stringify({
        t: "detection",
        dt_us: 100,
        speed_kmh: 1500,
        dir: "fwd",
        over: true,
        limit: 40,
        seq: 1,
      })
    );
    expect(tooFast.kind).toBe("malformed");
    const badDir = parseSerialLine(
      JSON.stringify({
        t: "detection",
        dt_us: 1000,
        speed_kmh: 30,
        dir: "sideways",
        over: false,
        limit: 40,
        seq: 1,
      })
    );
    expect(badDir.kind).toBe("malformed");
  });
});
