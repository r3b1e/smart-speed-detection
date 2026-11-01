import http from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { connectDb, disconnectDb } from "./db/connect";
import { logger } from "./logger";
import { resetStaleDeviceFlags, startWatchdogs, stopWatchdogs } from "./services/health";
import { initSocket, closeSocket } from "./services/sockets";

async function main(): Promise<void> {
  await connectDb();
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  await resetStaleDeviceFlags();
  startWatchdogs();

  server.listen(config.PORT, () => {
    logger.info(`server listening on http://localhost:${config.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopWatchdogs();
    closeSocket();
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "server failed to start");
  process.exit(1);
});
