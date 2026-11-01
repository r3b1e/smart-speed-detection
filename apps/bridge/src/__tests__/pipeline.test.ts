import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IngestDetectionSchema,
  type DeviceCommand,
  type IngestDetection,
} from "@smart-speed/shared";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bridge } from "../bridge";
import type { BridgeConfig } from "../config";
import { createServerClient, type HeartbeatMeta } from "../serverClient";
import type { LineSource, SourceStatus } from "../source";

const logger = pino({ level: "silent" });

const testConfig = (queueFile: string): BridgeConfig => ({
  serverUrl: "",
  deviceApiKey: "ssd_pipeline_test_key",
  serialPort: null,
  baudRate: 115200,
  queueFile,
  queueMax: 100,
  heartbeatMs: 40,
  reconnectMinMs: 10,
  reconnectMaxMs: 40,
  logLevel: "silent",
});

interface MockState {
  received: IngestDetection[];
  heartbeats: { source?: string; status?: string; meta?: Partial<HeartbeatMeta> }[];
  keys: string[];
  rejected: string[];
  down: boolean;
}

async function startMockServer(): Promise<{
  url: string;
  state: MockState;
  close: () => Promise<void>;
}> {
  const state: MockState = { received: [], heartbeats: [], keys: [], rejected: [], down: false };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      state.keys.push(String(req.headers["x-device-key"] ?? ""));
      if (state.down) {
        res.writeHead(503).end(JSON.stringify({ error: "down" }));
        return;
      }
      const body =
        chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown) : null;
      if (req.method === "POST" && req.url === "/api/ingest/detections") {
        const parsed = IngestDetectionSchema.safeParse(body);
        if (!parsed.success) {
          state.rejected.push(JSON.stringify(body));
          res
            .writeHead(400, { "content-type": "application/json" })
            .end(JSON.stringify({ error: "invalid", issues: parsed.error.issues }));
          return;
        }
        state.received.push(parsed.data);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `d${state.received.length}`, duplicate: false }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/ingest/heartbeat") {
        state.heartbeats.push(body as HeartbeatMeta);
        res.writeHead(204).end();
        return;
      }
      res
        .writeHead(404, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "nf" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

class FakeSource implements LineSource {
  readonly written: DeviceCommand[] = [];
  private cb: ((raw: string) => void) | null = null;
  private up = true;

  start(onLine: (raw: string) => void): void {
    this.cb = onLine;
  }
  write(command: DeviceCommand): void {
    this.written.push(command);
  }
  status(): SourceStatus {
    return { connected: this.up, port: this.up ? "fake" : null };
  }
  stop(): Promise<void> {
    this.up = false;
    return Promise.resolve();
  }
  emit(raw: string): void {
    this.cb?.(raw);
  }

  disconnect(): void {
    this.up = false;
  }
}

const detectionLine = (seq: number, boot = 4242): string =>
  JSON.stringify({
    t: "detection",
    dt_us: 90_000,
    speed_kmh: 40,
    dir: "fwd",
    over: false,
    limit: 40,
    seq,
    boot,
  });

describe("bridge pipeline (Arduino serial -> queue -> HTTP)", () => {
  let dir: string;
  let mock: Awaited<ReturnType<typeof startMockServer>>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ssd-pipeline-"));
    mock = await startMockServer();
  });

  afterEach(async () => {
    await mock.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("streams serial sensor detections and heartbeats into the server", async () => {
    const source = new FakeSource();
    const config = testConfig(join(dir, "q.jsonl"));
    const client = createServerClient(mock.url, config.deviceApiKey);
    const bridge = new Bridge({
      config,
      logger,
      source,
      client,
      deviceId: null,
      desiredLimitKmh: null,
    });
    await bridge.start();
    try {
      source.emit(JSON.stringify({ t: "hello", fw: "1.0.0", limit: 40, boot: 4242 }));
      for (let seq = 1; seq <= 4; seq += 1) source.emit(detectionLine(seq));
      await waitFor(() => mock.state.received.length >= 4, "4 serial detections ingested");
      await waitFor(() => mock.state.heartbeats.length >= 1, "heartbeat ingested");

      expect(mock.state.rejected).toEqual([]);
      expect(mock.state.keys.every((k) => k === "ssd_pipeline_test_key")).toBe(true);

      const seqs = mock.state.received.map((d) => d.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
      expect(new Set(mock.state.received.map((d) => d.bootId)).size).toBe(1);
      expect(mock.state.received.every((d) => d.source === "arduino")).toBe(true);

      const beat = mock.state.heartbeats[0];
      expect(beat.source).toBe("bridge");
      expect(beat.status).toBe("ok");
      expect(beat.meta?.serialConnected).toBe(true);
      expect(beat.meta?.port).toBe("fake");
      expect(beat.meta?.queueDepth).toBe(0);
      await waitFor(
        () => mock.state.heartbeats.some((b) => b.meta?.fw === "1.0.0"),
        "firmware version reported in heartbeat meta"
      );
    } finally {
      await bridge.stop();
    }
  });

  it("queues during an outage and drains in order when the server returns", async () => {
    const source = new FakeSource();
    const config = testConfig(join(dir, "q.jsonl"));
    const client = createServerClient(mock.url, config.deviceApiKey);
    const bridge = new Bridge({
      config,
      logger,
      source,
      client,
      deviceId: null,
      desiredLimitKmh: null,
    });
    await bridge.start();
    try {
      source.emit(JSON.stringify({ t: "hello", fw: "1.0.0", limit: 40, boot: 4242 }));
      source.emit(detectionLine(1));
      source.emit(detectionLine(2));
      await waitFor(() => mock.state.received.length >= 2, "initial deliveries");

      mock.state.down = true;
      source.emit(detectionLine(3));
      source.emit(detectionLine(4));
      await waitFor(() => bridge.queueDepth() >= 2, "queue building during outage");
      const receivedDuringOutage = mock.state.received.length;
      await new Promise((r) => setTimeout(r, 80));
      expect(mock.state.received.length).toBe(receivedDuringOutage);
      expect(bridge.queueDepth()).toBeGreaterThanOrEqual(2);

      mock.state.down = false;
      await waitFor(() => bridge.queueDepth() === 0, "queue fully drained");

      for (let seq = 5; seq <= 8; seq += 1) source.emit(detectionLine(seq));
      await waitFor(
        () => mock.state.received.length >= receivedDuringOutage + 4,
        "post-outage deliveries"
      );
      const seqs = mock.state.received.map((d) => d.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
      expect(mock.state.rejected).toEqual([]);
    } finally {
      await bridge.stop();
    }
  });

  it("dedupes repeated (bootId, seq) frames while they sit in the queue", async () => {
    const source = new FakeSource();
    const config = testConfig(join(dir, "q.jsonl"));
    const client = createServerClient(mock.url, config.deviceApiKey);
    const bridge = new Bridge({
      config,
      logger,
      source,
      client,
      deviceId: null,
      desiredLimitKmh: null,
    });
    mock.state.down = true;
    await bridge.start();
    try {
      source.emit(JSON.stringify({ t: "hello", fw: "1.0.0", limit: 40, boot: 4242 }));
      source.emit(detectionLine(1));
      source.emit(detectionLine(1));
      source.emit(detectionLine(1));
      expect(bridge.queueDepth()).toBe(1);

      mock.state.down = false;
      await waitFor(() => bridge.queueDepth() === 0, "duplicate flushed once");
      await new Promise((r) => setTimeout(r, 60));
      expect(mock.state.received).toHaveLength(1);
      expect(mock.state.received[0]).toMatchObject({ seq: 1, bootId: "4242" });
    } finally {
      await bridge.stop();
    }
  });

  it("counts malformed lines and forwards set_limit commands to the device", async () => {
    const source = new FakeSource();
    const config = testConfig(join(dir, "q.jsonl"));
    const client = createServerClient(mock.url, config.deviceApiKey);
    const bridge = new Bridge({
      config,
      logger,
      source,
      client,
      deviceId: null,
      desiredLimitKmh: 55,
    });
    await bridge.start();
    try {
      source.emit("# debug noise");
      source.emit("");
      source.emit("{broken json");
      source.emit(JSON.stringify({ t: "detection", dt_us: 1, speed_kmh: -1 }));
      expect(bridge.malformed()).toBe(2);

      source.emit(JSON.stringify({ t: "hello", fw: "1.0.0", limit: 40, boot: 7 }));
      // hello pushes the server-authoritative limit to the device
      await waitFor(() => source.written.length >= 1, "set_limit pushed on hello");
      expect(source.written[0]).toEqual({ cmd: "set_limit", kmh: 55 });

      bridge.handleCommand({ cmd: "buzzer_test" });
      expect(source.written.at(-1)).toEqual({ cmd: "buzzer_test" });
    } finally {
      await bridge.stop();
    }
  });

  it("omits absent serial metadata from disconnected heartbeats", async () => {
    const source = new FakeSource();
    source.disconnect();
    const config = testConfig(join(dir, "q.jsonl"));
    const bridge = new Bridge({
      config,
      logger,
      source,
      client: createServerClient(mock.url, config.deviceApiKey),
      deviceId: null,
      desiredLimitKmh: null,
    });
    await bridge.start();
    try {
      await waitFor(() => mock.state.heartbeats.length > 0, "offline heartbeat ingested");
      expect(mock.state.heartbeats[0]?.meta).toMatchObject({ serialConnected: false });
      expect(mock.state.heartbeats[0]?.meta?.port).toBeUndefined();
      expect(mock.state.heartbeats[0]?.meta?.lastSeq).toBeUndefined();
      expect(mock.state.rejected).toEqual([]);
    } finally {
      await bridge.stop();
    }
  });
});
