import type { DeviceCommand, IngestDetection, SerialLine } from "@smart-speed/shared";
import { backoffDelay } from "./backoff";
import type { BridgeConfig } from "./config";
import type { Logger } from "./logger";
import { parseSerialLine } from "./protocol";
import { OutboxQueue } from "./queue";
import type { ServerClient } from "./serverClient";
import type { LineSource } from "./source";

export interface BridgeDeps {
  config: BridgeConfig;
  logger: Logger;
  source: LineSource;
  client: ServerClient;
  /** Own device id (from GET /api/ingest/device); null until fetched. */
  deviceId: string | null;
  /** Server-authoritative limit to push over serial on (re)connect. */
  desiredLimitKmh: number | null;
}

/**
 * Orchestrates: serial line -> validate -> durable outbox -> ordered flush to
 * the server, plus heartbeat, malformed accounting and incoming commands.
 */
export class Bridge {
  private readonly queue: OutboxQueue;
  private onLine: ((raw: string) => void) | null = null;
  private bootId: string | null = null;
  private fw: string | null = null;
  private lastSeq: number | null = null;
  private malformedCount = 0;
  private malformedLogged = 0;
  private flushRun: Promise<void> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushAttempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: BridgeDeps) {
    this.queue = new OutboxQueue(deps.config.queueFile, deps.config.queueMax);
  }

  async start(): Promise<void> {
    await this.queue.load();
    this.running = true;
    this.onLine = (raw) => this.handleLine(raw);
    this.deps.source.start(this.onLine);
    this.heartbeatTimer = setInterval(() => void this.beat(), this.deps.config.heartbeatMs);
    void this.beat();
    this.deps.logger.info(
      { queued: this.queue.size(), serialPort: this.deps.config.serialPort ?? "auto-detect" },
      "bridge started"
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.heartbeatTimer = null;
    this.flushTimer = null;
    await this.deps.source.stop();
    await this.flush().catch(() => undefined);
    await this.queue.flushPersist();
    this.deps.logger.info({ remaining: this.queue.size() }, "bridge stopped");
  }

  queueDepth(): number {
    return this.queue.size();
  }

  malformed(): number {
    return this.malformedCount;
  }

  /** Exposed for tests: the exact handler wired to the line source. */
  handleLine(raw: string): void {
    const result = parseSerialLine(raw);
    switch (result.kind) {
      case "empty":
      case "debug":
        return;
      case "malformed":
        this.malformedCount += 1;
        if (this.malformedLogged < 3 || this.malformedCount % 100 === 0) {
          this.malformedLogged += 1;
          this.deps.logger.warn(
            { malformed: this.malformedCount, line: result.line.slice(0, 200) },
            "malformed serial line"
          );
        }
        return;
      case "line":
        this.handleValidLine(result.line);
    }
  }

  private handleValidLine(line: SerialLine): void {
    switch (line.t) {
      case "hello": {
        this.bootId = String(line.boot);
        this.fw = line.fw;
        this.deps.logger.info(
          { bootId: this.bootId, fw: line.fw, deviceLimit: line.limit },
          "device hello"
        );
        this.pushDesiredLimit();
        return;
      }
      case "detection": {
        if (this.bootId === null) {
          this.bootId = "unknown-boot";
        }
        const payload: IngestDetection = {
          seq: line.seq,
          bootId: this.bootId,
          dtMicros: line.dt_us,
          measuredSpeedKmh: line.speed_kmh,
          deviceOver: line.over,
          direction: line.dir,
          deviceLimitKmh: line.limit,
          receivedAt: new Date().toISOString(),
          source: "arduino",
        };
        this.lastSeq = line.seq;
        const accepted = this.queue.push(payload);
        if (!accepted) {
          this.deps.logger.debug({ seq: line.seq }, "duplicate detection dropped");
        }
        void this.flush();
        return;
      }
      case "hb":
        this.lastSeq = line.seq;
        return;
      case "ack":
        this.deps.logger.debug({ cmd: line.cmd }, "device ack");
        return;
    }
  }

  /** Ordered drain: first failure pauses and retries with exponential backoff. */
  private flush(): Promise<void> {
    if (this.flushRun) return this.flushRun;
    this.flushRun = (async () => {
      for (;;) {
        const next = this.queue.peek();
        if (!next) {
          this.flushAttempt = 0;
          break;
        }
        try {
          await this.deps.client.postDetection(next);
          this.queue.shift();
          if (this.flushAttempt > 0) {
            this.deps.logger.info("server reachable again, queue draining");
          }
          this.flushAttempt = 0;
        } catch (err) {
          this.flushAttempt += 1;
          const delay = backoffDelay(
            this.flushAttempt,
            this.deps.config.reconnectMinMs,
            this.deps.config.reconnectMaxMs
          );
          if (this.flushAttempt === 1) {
            this.deps.logger.warn(
              { queued: this.queue.size(), retryInMs: delay, err: (err as Error).message },
              "ingest failed, queueing detections"
            );
          }
          if (this.running) {
            this.flushTimer = setTimeout(() => {
              void this.flush();
            }, delay);
          }
          break;
        }
      }
    })().finally(() => {
      // runs as a microtask, always after the assignment below
      this.flushRun = null;
    });
    return this.flushRun;
  }

  private pushDesiredLimit(): void {
    if (this.deps.desiredLimitKmh === null) return;
    this.deps.source.write({ cmd: "set_limit", kmh: this.deps.desiredLimitKmh });
  }

  /** Server commands arrive over the bridge's device-key socket connection. */
  handleCommand(command: DeviceCommand): void {
    if (command.cmd === "set_limit") this.deps.desiredLimitKmh = command.kmh;
    this.deps.source.write(command);
    this.deps.logger.info({ command }, "command forwarded to device");
  }

  /** Records the server's current limit (start of day / reconnect). */
  setDesiredLimit(kmh: number): void {
    this.deps.desiredLimitKmh = kmh;
    if (this.bootId !== null) this.pushDesiredLimit();
  }

  setDeviceId(id: string): void {
    this.deps.deviceId = id;
  }

  deviceId(): string | null {
    return this.deps.deviceId;
  }

  private async beat(): Promise<void> {
    const status = this.deps.source.status();
    const meta = {
      serialConnected: status.connected,
      queueDepth: this.queue.size(),
      malformedCount: this.malformedCount,
      ...(status.port !== null ? { port: status.port } : {}),
      ...(this.lastSeq !== null ? { lastSeq: this.lastSeq } : {}),
      ...(this.fw !== null ? { fw: this.fw } : {}),
    };
    try {
      await this.deps.client.postHeartbeat(meta);
    } catch {
      // server briefly down: watchdog on the server side already reports offline
    }
  }
}
