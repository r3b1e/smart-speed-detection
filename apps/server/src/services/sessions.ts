import { logger } from "../logger";
import { Session, type IDevice, type IDetection } from "../models";
import { sockets } from "./sockets";

/**
 * Get or create a session for the given device + bootId combination.
 * A new Arduino boot (new bootId) always starts a new session.
 */
export async function getOrCreateSession(
  device: IDevice,
  bootId: string,
  firstDetectionTime: Date
): Promise<void> {
  try {
    const existing = await Session.findOne({ deviceId: device._id, bootId });
    if (existing) return; // Already exists; stats will be updated per detection

    const session = await Session.create({
      deviceId: device._id,
      bootId,
      startedAt: firstDetectionTime,
      endedAt: null,
      location: device.location,
      detectionCount: 0,
      overspeedCount: 0,
      maxSpeed: 0,
      avgSpeed: 0,
      status: "active",
    });

    logger.info({ sessionId: session.id, deviceId: device.id, bootId }, "new scanning session");

    sockets.sessionNew({
      sessionId: session.id,
      deviceId: device.id,
      deviceName: device.name,
      bootId,
      startedAt: session.startedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err, deviceId: device.id, bootId }, "failed to create session");
  }
}

/**
 * Update session statistics after a new (non-duplicate) detection.
 */
export async function updateSessionStats(detection: IDetection): Promise<void> {
  try {
    const session = await Session.findOne({
      deviceId: detection.deviceId,
      bootId: detection.bootId,
    });

    if (!session) {
      logger.warn({ bootId: detection.bootId }, "session not found when updating stats");
      return;
    }

    const newCount = session.detectionCount + 1;
    const newOverspeed = session.overspeedCount + (detection.overspeed ? 1 : 0);
    const newMax = Math.max(session.maxSpeed, detection.scaledSpeedKmh);
    // Cumulative running average
    const newAvg =
      Math.round(
        ((session.avgSpeed * session.detectionCount + detection.scaledSpeedKmh) / newCount) * 10
      ) / 10;

    session.detectionCount = newCount;
    session.overspeedCount = newOverspeed;
    session.maxSpeed = newMax;
    session.avgSpeed = newAvg;
    session.endedAt = detection.detectedAt; // tracks last activity
    await session.save();

    sockets.sessionUpdated({
      sessionId: session.id,
      detectionCount: newCount,
      overspeedCount: newOverspeed,
      maxSpeed: newMax,
      avgSpeed: newAvg,
    });
  } catch (err) {
    logger.error({ err, detectionId: detection.id }, "failed to update session stats");
  }
}

/**
 * Mark sessions with no activity for 5+ minutes as completed.
 * Called by the health watchdog cron (every minute).
 */
export async function closeInactiveSessions(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const result = await Session.updateMany(
      { status: "active", updatedAt: { $lt: cutoff } },
      { $set: { status: "completed" } }
    );
    if (result.modifiedCount > 0) {
      logger.info({ count: result.modifiedCount }, "closed inactive sessions");
    }
  } catch (err) {
    logger.error({ err }, "failed to close inactive sessions");
  }
}
