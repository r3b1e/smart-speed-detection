import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestCtx } from "./helpers";
import { setupCtx, teardownCtx } from "./helpers";
import { runSeed, SEED_EMAILS } from "../seed/seed";
import { Device, Detection, Settings, User, Vehicle } from "../models";

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await setupCtx();
});

afterAll(async () => {
  await teardownCtx(ctx);
});

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<typeof runSeed>[0];

describe("seed script", () => {
  it("creates operator accounts and one gate without fabricating sensor readings", async () => {
    const result = await runSeed(silentLogger);

    const users = await User.find();
    expect(users.map((u) => u.role).sort()).toEqual(["admin", "authority", "user"]);
    expect(result.detections).toBe(0);

    const device = await Device.findOne({ name: "Gate Station 01 — Bandra" });
    expect(device).toBeTruthy();
    expect(device!.location.coordinates).toEqual([72.8777, 19.076]);
    expect(device!.scaleFactor).toBe(1);
    expect(result.deviceApiKey).toMatch(/^ssd_[0-9a-f]{48}$/);

    const vehicles = await Vehicle.find();
    expect(vehicles).toHaveLength(0);

    const detections = await Detection.find({ deviceId: device!._id });
    expect(detections).toHaveLength(0);

    // idempotent re-run does not duplicate anything
    const again = await runSeed(silentLogger);
    expect(again.detections).toBe(0);
    expect(await Detection.countDocuments()).toBe(0);
    expect(await User.countDocuments()).toBe(3);
    expect(await Vehicle.countDocuments()).toBe(0);

    const settings = await Settings.findOne({ key: "singleton" });
    expect(settings).toBeTruthy();
  }, 60_000);

  it("exposes seed emails for the documented demo accounts", () => {
    expect(SEED_EMAILS.admin).toBe("admin@smartspeed.local");
    expect(SEED_EMAILS.authority).toBe("authority@smartspeed.local");
    expect(SEED_EMAILS.user).toBe("driver@smartspeed.local");
  });
});
