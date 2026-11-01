import { backoffDelay } from "../backoff";
import type { Logger } from "../logger";
import type { LineSource, SourceStatus } from "../source";
import type { DeviceCommand } from "@smart-speed/shared";
import { serializeCommand } from "@smart-speed/shared";

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  pnpId?: string;
  vendorId?: string;
  productId?: string;
}

const ARDUINO_VENDOR_IDS = new Set([
  "2341", // Arduino LLC
  "2a03", // Arduino.org
  "1b4f", // SparkFun
  "0403", // FTDI
  "1d50", // OpenMoko (ManyKey/serial)
  "2341",
]);

/** Pure port choice: SERIAL_PORT override wins, else Arduino-ish USB serial. */
export function pickPort(ports: SerialPortInfo[], override: string | null): string | null {
  if (override) return override;
  const usable = ports.filter(
    (p) =>
      /\/dev\/(cu|tty)\.(usbmodem|usbserial)/i.test(p.path) ||
      (p.vendorId !== undefined && ARDUINO_VENDOR_IDS.has(p.vendorId.toLowerCase()))
  );
  // macOS exposes two nodes per device; prefer the callout (cu.*) node because
  // tty.* blocks while another process has it open.
  const callout = usable.find((p) => p.path.startsWith("/dev/cu."));
  return (callout ?? usable[0])?.path ?? null;
}

export interface SerialLinkOptions {
  baudRate: number;
  serialPort: string | null;
  reconnectMinMs: number;
  reconnectMaxMs: number;
}

type ListFn = () => Promise<SerialPortInfo[]>;

/**
 * USB serial line source: auto-detect, NDJSON split, exponential-backoff
 * reconnect with exactly one concise log line per attempt.
 */
export class SerialLink implements LineSource {
  private onLine: ((raw: string) => void) | null = null;
  private port: {
    close(cb: (err?: Error | null) => void): void;
    write(data: string, cb: (err?: Error | null) => void): void;
    isOpen: boolean;
  } | null = null;
  private currentPath: string | null = null;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private buffer = "";

  constructor(
    private readonly logger: Logger,
    private readonly opts: SerialLinkOptions,
    private readonly listPorts: ListFn = defaultListPorts
  ) {}

  start(onLine: (raw: string) => void): void {
    this.onLine = onLine;
    this.stopped = false;
    void this.openLoop();
  }

  write(command: DeviceCommand): void {
    if (!this.port?.isOpen) {
      this.logger.warn({ cmd: command.cmd }, "serial not connected, command dropped");
      return;
    }
    this.port.write(serializeCommand(command), (err) => {
      if (err) this.logger.warn({ err, cmd: command.cmd }, "serial write failed");
    });
  }

  status(): SourceStatus {
    return { connected: Boolean(this.port?.isOpen), port: this.currentPath };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const open = this.port;
    this.port = null;
    if (open?.isOpen) {
      await new Promise<void>((resolve) => open.close(() => resolve()));
    }
  }

  private async openLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const ports = await this.listPorts();
        const path = pickPort(ports, this.opts.serialPort);
        if (!path) {
          this.attempt += 1;
          const delay = backoffDelay(
            this.attempt,
            this.opts.reconnectMinMs,
            this.opts.reconnectMaxMs
          );
          this.logger.warn(
            { attempt: this.attempt, delayMs: delay },
            "no Arduino serial port found, retrying"
          );
          await this.sleep(delay);
          continue;
        }
        await this.openOnce(path);
        return; // connected — reopen is driven by the disconnect handler
      } catch (err) {
        this.attempt += 1;
        const delay = backoffDelay(
          this.attempt,
          this.opts.reconnectMinMs,
          this.opts.reconnectMaxMs
        );
        this.logger.warn(
          { attempt: this.attempt, delayMs: delay, err: (err as Error).message },
          "serial open failed, retrying"
        );
        await this.sleep(delay);
      }
    }
  }

  private async openOnce(path: string): Promise<void> {
    const { SerialPort } = await import("serialport");
    const port = new SerialPort({ path, baudRate: this.opts.baudRate, autoOpen: false });
    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });
    const parser = port.pipe(
      new (await import("@serialport/parser-readline")).ReadlineParser({ delimiter: "\n" })
    );
    parser.on("data", (raw: string) => this.onLine?.(raw));
    port.on("close", () => this.handleDisconnect(path));
    port.on("error", (err: Error) => this.logger.warn({ err: err.message }, "serial error"));
    this.port = port;
    this.currentPath = path;
    this.attempt = 0;
    this.logger.info({ path, baud: this.opts.baudRate }, "serial connected");
  }

  private handleDisconnect(path: string): void {
    if (this.stopped) return;
    this.port = null;
    this.currentPath = null;
    this.attempt = 0;
    this.logger.warn({ port: path }, "serial disconnected, reconnecting");
    void this.openLoop();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.reconnectTimer = setTimeout(resolve, ms);
    });
  }
}

async function defaultListPorts(): Promise<SerialPortInfo[]> {
  const { SerialPort } = await import("serialport");
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    pnpId: p.pnpId,
    vendorId: p.vendorId,
    productId: p.productId,
  }));
}
