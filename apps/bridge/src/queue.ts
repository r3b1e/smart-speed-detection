import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IngestDetection } from "@smart-speed/shared";

export interface QueuedItem {
  payload: IngestDetection;
}

/**
 * Ordered durable outbox: memory is the source of truth, disk is a JSONL
 * mirror rewritten atomically on every mutation. Items already flushed by a
 * previous process may be replayed after a crash — the server dedupes on
 * (deviceId, bootId, seq), so redelivery is safe.
 */
export class OutboxQueue {
  private items: QueuedItem[] = [];
  private seen = new Set<string>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly max: number
  ) {}

  /** Restore unsent items from disk (corrupt lines are skipped). */
  async load(): Promise<void> {
    try {
      const text = await readFile(this.file, "utf8");
      const restored: QueuedItem[] = [];
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const item = JSON.parse(line) as QueuedItem;
          if (item?.payload?.bootId && typeof item.payload.seq === "number") {
            restored.push(item);
          }
        } catch {
          // torn write from a crash — drop the line
        }
      }
      this.items = restored.slice(-this.max);
      this.rebuildSeen();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  /** Returns false when (bootId, seq) is already queued/seen (dedupe). */
  push(payload: IngestDetection): boolean {
    const key = `${payload.bootId}:${payload.seq}`;
    if (this.seen.has(key)) return false;
    this.items.push({ payload });
    this.seen.add(key);
    if (this.items.length > this.max) {
      const dropped = this.items.splice(0, this.items.length - this.max);
      for (const item of dropped) this.seen.delete(this.payloadKey(item));
    }
    this.persist();
    return true;
  }

  peek(): IngestDetection | undefined {
    return this.items[0]?.payload;
  }

  shift(): IngestDetection | undefined {
    const item = this.items.shift();
    if (item) {
      this.seen.delete(this.payloadKey(item));
      this.persist();
    }
    return item?.payload;
  }

  size(): number {
    return this.items.length;
  }

  /** Wait for the latest atomic rewrite to finish (shutdown/tests). */
  async flushPersist(): Promise<void> {
    await this.persistQueue;
  }

  private payloadKey(item: QueuedItem): string {
    return `${item.payload.bootId}:${item.payload.seq}`;
  }

  private rebuildSeen(): void {
    this.seen = new Set(this.items.map((item) => this.payloadKey(item)));
  }

  private persist(): void {
    const snapshot = this.items.map((item) => JSON.stringify(item)).join("\n");
    const body = snapshot === "" ? "" : `${snapshot}\n`;
    this.persistQueue = this.persistQueue
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, body, "utf8");
        await rename(tmp, this.file);
      })
      .catch(() => {
        // Best-effort mirror: memory stays authoritative and load() skips
        // torn/corrupt lines, so a failed rewrite never loses the pipeline.
      });
  }
}
