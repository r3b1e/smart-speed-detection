import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../app";
import { AuditLogModel, Device, Detection, Settings, User, Vehicle } from "../models";

export interface TestCtx {
  app: Express;
  mongod: MongoMemoryServer;
}

/** Boots an isolated in-memory MongoDB + fresh Express app for one suite. */
export async function setupCtx(): Promise<TestCtx> {
  let mongod: MongoMemoryServer | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      mongod = await MongoMemoryServer.create();
      break;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await mongoose.connect(mongod!.getUri());
  await Promise.all([
    User.syncIndexes(),
    Device.syncIndexes(),
    Detection.syncIndexes(),
    Vehicle.syncIndexes(),
    Settings.syncIndexes(),
    AuditLogModel.syncIndexes(),
  ]);
  return { app: createApp(), mongod };
}

export async function teardownCtx(ctx: TestCtx): Promise<void> {
  await mongoose.disconnect();
  await ctx.mongod.stop();
}

export async function clearDb(): Promise<void> {
  await Promise.all([
    User.deleteMany({}),
    Device.deleteMany({}),
    Detection.deleteMany({}),
    Vehicle.deleteMany({}),
    Settings.deleteMany({}),
    AuditLogModel.deleteMany({}),
  ]);
}

export const api = (app: Express) => request.agent(app);

export interface RegisteredUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  role: string;
}

export async function registerUser(
  app: Express,
  overrides: Partial<{ name: string; email: string; password: string }> = {}
): Promise<RegisteredUser> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2)}@test.local`;
  const password = overrides.password ?? "Test1234";
  const res = await api(app)
    .post("/api/auth/register")
    .send({ name: overrides.name ?? "Test User", email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return {
    id: res.body.user.id as string,
    email,
    password,
    accessToken: res.body.accessToken as string,
    role: res.body.user.role as string,
  };
}

/** Creates a user with a specific role directly in the DB, then logs in. */
export async function createUserWithRole(
  app: Express,
  role: "admin" | "authority" | "user"
): Promise<RegisteredUser> {
  const email = `${role}-${Math.random().toString(36).slice(2)}@test.local`;
  const password = "Test1234";
  const bcrypt = await import("bcrypt");
  await User.create({
    name: `${role} user`,
    email,
    passwordHash: await bcrypt.hash(password, 4),
    role,
    isActive: true,
  });
  const res = await api(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
  return {
    id: res.body.user.id as string,
    email,
    password,
    accessToken: res.body.accessToken as string,
    role,
  };
}

export async function createDevice(app: Express, adminToken: string, name = "Test Gate") {
  const res = await api(app)
    .post("/api/devices")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name,
      location: { coordinates: [72.8777, 19.076] },
      scaleFactor: 1,
      speedLimitKmh: 40,
      status: "active",
    });
  if (res.status !== 201) throw new Error(`device create failed: ${res.status} ${res.text}`);
  return { device: res.body.device as { id: string }, apiKey: res.body.apiKey as string };
}

/** 1×1 pixel JPEG used by frame upload tests. */
export const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB" +
    "AxxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9" +
    "AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6" +
    "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip" +
    "qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIR" +
    "AxAPwD3+iiigD//2Q==",
  "base64"
);

let seqCounter = 0;

/** Inserts a detection directly (faster than full ingest) with sane defaults. */
export async function insertDetection(
  deviceId: string,
  overrides: Partial<{
    seq: number;
    bootId: string;
    source: "arduino";
    measuredSpeedKmh: number;
    scaledSpeedKmh: number;
    limitKmh: number;
    overspeed: boolean;
    deviceOver: boolean;
    severity: "low" | "medium" | "high";
    direction: "fwd" | "rev";
    dtMicros: number;
    detectedAt: Date;
    receivedAt: Date;
    location: { type: "Point"; coordinates: [number, number] };
    plate: string | null;
    reviewStatus: "pending" | "confirmed" | "dismissed";
    frameStatus?: "pending" | "ready" | "failed" | "skipped";
    fine: { amount: number; status: "unpaid" | "paid" | "waived" } | null;
  }> = {}
) {
  const { Detection } = await import("../models");
  const now = overrides.detectedAt ?? new Date();
  const measured = overrides.measuredSpeedKmh ?? 20;
  return Detection.create({
    deviceId,
    bootId: overrides.bootId ?? "test-boot",
    seq: overrides.seq ?? seqCounter++,
    source: overrides.source ?? "arduino",
    vehicleUid: `uid-${Math.random().toString(36).slice(2)}`,
    measuredSpeedKmh: measured,
    scaledSpeedKmh: overrides.scaledSpeedKmh ?? measured,
    limitKmh: overrides.limitKmh ?? 40,
    overspeed: overrides.overspeed ?? false,
    deviceOver: overrides.deviceOver ?? overrides.overspeed ?? false,
    severity: overrides.severity ?? "low",
    direction: overrides.direction ?? "fwd",
    dtMicros: overrides.dtMicros ?? Math.round(360000 / measured),
    detectedAt: now,
    receivedAt: overrides.receivedAt ?? now,
    location: overrides.location ?? { type: "Point", coordinates: [72.8777, 19.076] },
    frame: { status: overrides.frameStatus ?? "failed" },
    plate: overrides.plate ?? null,
    review: { status: overrides.reviewStatus ?? "pending" },
    fine: overrides.fine ?? null,
  });
}
