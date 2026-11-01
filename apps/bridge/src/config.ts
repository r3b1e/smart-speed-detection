import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  SERVER_URL: z.string().url().default("http://localhost:4000"),
  DEVICE_API_KEY: z.string().default(""),
  SERIAL_PORT: z.string().default(""),
  BAUD_RATE: z.coerce.number().int().positive().default(115200),
  QUEUE_FILE: z.string().default(".data/bridge-queue.jsonl"),
  QUEUE_MAX: z.coerce.number().int().positive().default(5000),
  HEARTBEAT_MS: z.coerce.number().int().positive().default(5000),
  RECONNECT_MIN_MS: z.coerce.number().int().positive().default(1000),
  RECONNECT_MAX_MS: z.coerce.number().int().positive().default(30000),
  LOG_LEVEL: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),
});

export interface BridgeConfig {
  serverUrl: string;
  deviceApiKey: string;
  serialPort: string | null;
  baudRate: number;
  queueFile: string;
  queueMax: number;
  heartbeatMs: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  logLevel: z.infer<typeof EnvSchema>["LOG_LEVEL"];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const parsed = EnvSchema.parse(env);
  return {
    serverUrl: parsed.SERVER_URL.replace(/\/$/, ""),
    deviceApiKey: parsed.DEVICE_API_KEY,
    serialPort: parsed.SERIAL_PORT || null,
    baudRate: parsed.BAUD_RATE,
    queueFile: parsed.QUEUE_FILE,
    queueMax: parsed.QUEUE_MAX,
    heartbeatMs: parsed.HEARTBEAT_MS,
    reconnectMinMs: parsed.RECONNECT_MIN_MS,
    reconnectMaxMs: parsed.RECONNECT_MAX_MS,
    logLevel: parsed.LOG_LEVEL,
  };
}
