#!/usr/bin/env node
/**
 * Dev MongoDB fallback for machines without Docker.
 * Starts a real mongod (binary downloaded by mongodb-memory-server) bound to
 * 127.0.0.1:27017 with ./.data/dev-mongo as the data directory so data
 * survives restarts. Ctrl+C stops it.
 *
 * Primary path remains `docker compose up mongo`.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dbPath = join(root, ".data", "dev-mongo");
mkdirSync(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({
  instance: { ip: "127.0.0.1", port: 27017, dbPath, storageEngine: "wiredTiger" },
});

console.log(`[dev-mongo] mongod ready at ${server.getUri("smart-speed")}`);
console.log("[dev-mongo] press Ctrl+C to stop");

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
