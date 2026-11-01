import { DeviceCommandSchema, gateTripLimitKmh, type DeviceCommand } from "@smart-speed/shared";
import { io } from "socket.io-client";
import { Bridge } from "./bridge";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { createServerClient } from "./serverClient";
import { SerialLink } from "./sources/serial";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (!config.deviceApiKey) {
    logger.error("DEVICE_API_KEY is missing — run `pnpm seed` and copy the printed key");
    process.exit(1);
  }

  const client = createServerClient(config.serverUrl, config.deviceApiKey);
  const source = new SerialLink(logger, {
    baudRate: config.baudRate,
    serialPort: config.serialPort,
    reconnectMinMs: config.reconnectMinMs,
    reconnectMaxMs: config.reconnectMaxMs,
  });

  const bridge = new Bridge({
    config,
    logger,
    source,
    client,
    deviceId: null,
    desiredLimitKmh: null,
  });

  const resolveDevice = (): void => {
    void client
      .getDevice()
      .then((device) => {
        bridge.setDeviceId(device.id);
        bridge.setDesiredLimit(
          gateTripLimitKmh(device.speedLimitKmh, device.scaleFactor),
          device.scaleFactor
        );
        logger.info({ device: device.name, limit: device.speedLimitKmh }, "station resolved");
      })
      .catch(() => {
        logger.warn("server unreachable for station lookup, retrying in 15s");
        setTimeout(resolveDevice, 15_000);
      });
  };

  await bridge.start();
  resolveDevice();

  const socket = io(config.serverUrl, {
    auth: { deviceKey: config.deviceApiKey },
    reconnectionDelay: config.reconnectMinMs,
    reconnectionDelayMax: config.reconnectMaxMs,
  });
  socket.on("connect", () => logger.info("command channel connected"));
  socket.on("server:device-command", (payload: { deviceId?: string; command?: unknown }) => {
    const parsed = DeviceCommandSchema.safeParse(payload?.command);
    if (!parsed.success) {
      logger.warn("ignoring malformed device command");
      return;
    }
    const command: DeviceCommand = parsed.data;
    if (bridge.deviceId() && payload.deviceId !== bridge.deviceId()) return;
    bridge.handleCommand(command);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down bridge");
    socket.close();
    void bridge
      .stop()
      .catch((err: unknown) => logger.error({ err }, "shutdown error"))
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
