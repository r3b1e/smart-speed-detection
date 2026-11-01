import type { DeviceCommand } from "@smart-speed/shared";

export interface SourceStatus {
  connected: boolean;
  port: string | null;
}

/**
 * Physical USB serial producer of NDJSON lines from the Arduino gate.
 */
export interface LineSource {
  start(onLine: (raw: string) => void): void;
  write(command: DeviceCommand): void;
  status(): SourceStatus;
  stop(): Promise<void>;
}
