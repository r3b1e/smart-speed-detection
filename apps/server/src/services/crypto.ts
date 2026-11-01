import { createHash, randomBytes, randomUUID } from "node:crypto";

/** Device API keys: ssd_<48 hex>. Only the SHA-256 hash is stored. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `ssd_${randomBytes(24).toString("hex")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newVehicleUid(): string {
  return randomUUID();
}
