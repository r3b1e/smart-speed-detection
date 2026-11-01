import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IngestDetection } from "@smart-speed/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutboxQueue } from "../queue";

function payload(seq: number, bootId = "boot-a"): IngestDetection {
  return {
    seq,
    bootId,
    dtMicros: 100_000 + seq,
    measuredSpeedKmh: 33.5,
    direction: "fwd",
    deviceLimitKmh: 40,
    receivedAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    source: "arduino",
  };
}

describe("OutboxQueue", () => {
  let dir: string;
  let file: string;
  const live: OutboxQueue[] = [];

  const makeQueue = (max: number, path = file): OutboxQueue => {
    const queue = new OutboxQueue(path, max);
    live.push(queue);
    return queue;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ssd-queue-"));
    file = join(dir, "outbox.jsonl");
  });

  afterEach(async () => {
    for (const queue of live) await queue.flushPersist();
    live.length = 0;
    await rm(dir, { recursive: true, force: true });
  });

  it("preserves FIFO order", async () => {
    const queue = makeQueue(100);
    for (const seq of [3, 1, 4, 2]) queue.push(payload(seq));
    expect(queue.size()).toBe(4);
    expect(queue.peek()?.seq).toBe(3);
    expect(queue.shift()?.seq).toBe(3);
    expect(queue.shift()?.seq).toBe(1);
    expect(queue.shift()?.seq).toBe(4);
    expect(queue.shift()?.seq).toBe(2);
    expect(queue.shift()).toBeUndefined();
    expect(queue.size()).toBe(0);
  });

  it("dedupes by (bootId, seq) while queued", async () => {
    const queue = makeQueue(100);
    expect(queue.push(payload(1))).toBe(true);
    expect(queue.push(payload(1))).toBe(false);
    expect(queue.push(payload(1, "boot-b"))).toBe(true);
    expect(queue.size()).toBe(2);
    // after a successful flush the key may legitimately repeat (server dedupes)
    queue.shift();
    expect(queue.push(payload(1))).toBe(true);
  });

  it("drops the oldest items beyond max capacity", async () => {
    const queue = makeQueue(3);
    for (let seq = 1; seq <= 5; seq++) queue.push(payload(seq));
    expect(queue.size()).toBe(3);
    expect(queue.peek()?.seq).toBe(3);
    // the evicted key (seq 1) is no longer considered seen
    expect(queue.push(payload(1))).toBe(true);
    expect(queue.size()).toBe(3);
    // FIFO still holds: the re-pushed item is at the tail, oldest dropped
    expect(queue.shift()?.seq).toBe(4);
    expect(queue.shift()?.seq).toBe(5);
    expect(queue.shift()?.seq).toBe(1);
    expect(queue.shift()).toBeUndefined();
  });

  it("persists atomically and reloads after restart", async () => {
    const queue = makeQueue(100);
    queue.push(payload(7));
    queue.push(payload(8));
    await queue.flushPersist();
    const text = await readFile(file, "utf8");
    expect(text.trim().split("\n")).toHaveLength(2);

    const reloaded = makeQueue(100);
    await reloaded.load();
    expect(reloaded.size()).toBe(2);
    expect(reloaded.shift()?.seq).toBe(7);
    expect(reloaded.shift()?.seq).toBe(8);
  });

  it("skips corrupt lines on load and starts empty when the file is missing", async () => {
    await writeFile(file, 'garbage\n{"payload":{"bootId":"b","seq":4,"x":1}}\n', "utf8");
    const queue = makeQueue(100);
    await queue.load();
    expect(queue.size()).toBe(1);
    expect(queue.peek()?.seq).toBe(4);

    const fresh = makeQueue(100, join(dir, "nope.jsonl"));
    await fresh.load();
    expect(fresh.size()).toBe(0);
  });
});
