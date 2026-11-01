/**
 * Seeds operator accounts, one gate, settings and audit metadata.
 * Sensor detections are never fabricated by the seed script.
 *
 * Run: pnpm seed
 */
import bcrypt from "bcrypt";
import { connectDb, disconnectDb } from "../db/connect";
import { logger } from "../logger";
import { AuditLogModel, Device, Settings, SETTINGS_KEY, DEFAULT_SETTINGS, User } from "../models";
import { generateApiKey } from "../services/crypto";

const SEED_EMAILS = {
  admin: "admin@smartspeed.local",
  authority: "authority@smartspeed.local",
  user: "driver@smartspeed.local",
};
const SEED_PASSWORD = "Demo@1234";
const DEVICE_NAME = "Gate Station 01 — Bandra";

interface SeedResult {
  adminEmail: string;
  authorityEmail: string;
  userEmail: string;
  password: string;
  deviceApiKey: string;
  detections: number;
  users: number;
}

export async function runSeed(log = logger): Promise<SeedResult> {
  const [admin, authority] = await Promise.all([
    User.findOneAndUpdate(
      { email: SEED_EMAILS.admin },
      {
        name: "Ops Admin",
        email: SEED_EMAILS.admin,
        passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
        role: "admin",
        isActive: true,
        lastLoginAt: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    User.findOneAndUpdate(
      { email: SEED_EMAILS.authority },
      {
        name: "Traffic Authority",
        email: SEED_EMAILS.authority,
        passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
        role: "authority",
        isActive: true,
        lastLoginAt: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
  ]);
  await User.findOneAndUpdate(
    { email: SEED_EMAILS.user },
    {
      name: "Demo Driver",
      email: SEED_EMAILS.user,
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
      role: "user",
      isActive: true,
      lastLoginAt: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY, ...DEFAULT_SETTINGS } },
    { upsert: true }
  );

  const { key: deviceApiKey, hash, prefix } = generateApiKey();
  const existingGate =
    (await Device.findOne({ gateSlot: "primary" }).select("_id")) ??
    (await Device.findOne().sort({ createdAt: 1 }).select("_id"));
  const device = await Device.findOneAndUpdate(
    existingGate ? { _id: existingGate._id } : { gateSlot: "primary" },
    {
      $set: {
        gateSlot: "primary",
        name: DEVICE_NAME,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        location: { type: "Point", coordinates: [72.8777, 19.076] },
        address: "Bandra West, Mumbai, Maharashtra 400050, India",
        scaleFactor: 1,
        speedLimitKmh: 40,
        status: "active",
        bridgeOnline: false,
        cameraStatus: "waiting",
      },
      $setOnInsert: { firmwareVersion: null, lastSeenAt: null },
    },
    { upsert: !existingGate, new: true }
  );
  if (!device) throw new Error("failed to create or update the primary gate");

  await AuditLogModel.deleteMany({ entity: "seed" });
  await AuditLogModel.create({
    actorId: admin._id,
    actorName: admin.name,
    action: "seed.run",
    entity: "seed",
    entityId: null,
    meta: { detections: 0, device: device.name },
    at: new Date(),
  });

  log.info(
    { users: 3, device: device.name, detections: 0 },
    "seed complete (credentials printed to stdout only)"
  );

  return {
    adminEmail: admin.email,
    authorityEmail: authority.email,
    userEmail: SEED_EMAILS.user,
    password: SEED_PASSWORD,
    deviceApiKey,
    detections: 0,
    users: 3,
  };
}

async function main(): Promise<void> {
  await connectDb();
  try {
    const result = await runSeed(logger);
    const line = "─".repeat(64);
    console.log(`\n${line}\n SEED COMPLETE — these credentials are shown ONCE\n${line}`);
    console.log(` admin    : ${result.adminEmail} / ${result.password}`);
    console.log(` authority: ${result.authorityEmail} / ${result.password}`);
    console.log(` user     : ${result.userEmail} / ${result.password}`);
    console.log(` device   : ${DEVICE_NAME}`);
    console.log(` api key  : ${result.deviceApiKey}`);
    console.log(` sensor readings stored: ${result.detections}`);
    console.log(`${line}\n`);
  } finally {
    await disconnectDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, "seed failed");
    process.exit(1);
  });
}

export { SEED_EMAILS, SEED_PASSWORD, DEVICE_NAME };
