import { SerialLineSchema, type SerialLine } from "@smart-speed/shared";

export type ParseResult =
  | { kind: "empty" }
  | { kind: "debug" }
  | { kind: "malformed"; line: string }
  | { kind: "line"; line: SerialLine };

/**
 * One NDJSON serial line -> typed protocol event.
 * `#` lines are firmware debug output (ignored), everything else must validate.
 */
export function parseSerialLine(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  if (trimmed.startsWith("#")) return { kind: "debug" };
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { kind: "malformed", line: trimmed };
  }
  const parsed = SerialLineSchema.safeParse(json);
  if (!parsed.success) return { kind: "malformed", line: trimmed };
  return { kind: "line", line: parsed.data };
}
