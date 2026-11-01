/**
 * Apply retention policy: delete detections older than the configured retentionDays
 * and their associated frames from GridFS.
 * 
 * This should be run as a cron job (e.g., daily at 2 AM).
 * Usage: pnpm tsx src/scripts/apply-retention.ts [--dry-run]
 */

import mongoose from "mongoose";
import { config } from "../config";
import { logger } from "../logger";
import { Detection, getSettings } from "../models";

const { GridFSBucket } = mongoose.mongo;

async function applyRetentionPolicy(dryRun: boolean = true): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  logger.info("Connected to MongoDB");

  const settings = await getSettings();
  const retentionDays = settings.retentionDays;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info(`Retention policy: ${retentionDays} days`);
  logger.info(`Cutoff date: ${cutoffDate.toISOString()}`);

  // Find detections older than retention period
  const oldDetections = await Detection.find({
    detectedAt: { $lt: cutoffDate },
    source: "arduino",
  }).select("id frame");

  if (oldDetections.length === 0) {
    logger.info("✓ No detections to delete. All data is within retention period.");
    return;
  }

  logger.info(`Found ${oldDetections.length} detections older than ${retentionDays} days`);

  // Collect frame IDs to delete
  const frameIds: mongoose.Types.ObjectId[] = [];
  for (const detection of oldDetections) {
    if (detection.frame.fileId) frameIds.push(detection.frame.fileId);
    if (detection.frame.thumbFileId) frameIds.push(detection.frame.thumbFileId);
  }

  const uniqueFrameIds = [...new Set(frameIds.map((id) => id.toString()))];
  logger.info(`Associated frames to delete: ${uniqueFrameIds.length}`);

  if (dryRun) {
    logger.info("\n🔍 DRY RUN MODE - No data will be deleted\n");
    logger.info("Would delete:");
    logger.info(`  ${oldDetections.length} detections`);
    logger.info(`  ${uniqueFrameIds.length} frames from GridFS`);
    logger.info("\nSample detections (first 5):");
    for (const detection of oldDetections.slice(0, 5)) {
      const det = await Detection.findById(detection.id).populate("deviceId", "name");
      if (det) {
        logger.info(
          `  ${det.id} - ${det.detectedAt.toISOString()} - ${det.scaledSpeedKmh.toFixed(1)} km/h`
        );
      }
    }
    logger.info("\nRun without --dry-run to actually delete this data");
  } else {
    logger.info("\n⚠️  DELETING old data...\n");

    const db = mongoose.connection.db;
    if (!db) {
      logger.error("Database connection not available");
      process.exit(1);
    }

    const bucket = new GridFSBucket(db, { bucketName: "frames" });

    // Delete frames from GridFS
    let framesDeleted = 0;
    for (const frameIdStr of uniqueFrameIds) {
      try {
        await bucket.delete(new mongoose.Types.ObjectId(frameIdStr));
        framesDeleted++;
        if (framesDeleted % 50 === 0) {
          logger.info(`Deleted ${framesDeleted}/${uniqueFrameIds.length} frames...`);
        }
      } catch (err) {
        logger.error({ err, frameId: frameIdStr }, "Failed to delete frame");
      }
    }

    // Delete detection records
    const deleteResult = await Detection.deleteMany({
      detectedAt: { $lt: cutoffDate },
      source: "arduino",
    });

    logger.info(`\n✓ Retention policy applied!`);
    logger.info(`  Detections deleted: ${deleteResult.deletedCount}`);
    logger.info(`  Frames deleted: ${framesDeleted}`);
    logger.info(`  Data retained from: ${cutoffDate.toISOString()} onwards`);
  }
}

const isDryRun = !process.argv.includes("--no-dry-run");

applyRetentionPolicy(isDryRun)
  .catch((err) => {
    logger.error({ err }, "Retention policy failed");
    process.exit(1);
  })
  .finally(() => {
    void mongoose.disconnect();
  });
