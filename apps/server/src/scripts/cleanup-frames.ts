/**
 * Cleanup script to remove orphaned frames from GridFS.
 * Orphaned frames are those not linked to any detection record.
 * 
 * Usage: pnpm tsx src/scripts/cleanup-frames.ts [--dry-run]
 */

import mongoose from "mongoose";
import { config } from "../config";
import { logger } from "../logger";

const { GridFSBucket } = mongoose.mongo;

async function cleanupOrphanedFrames(dryRun: boolean = true): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  logger.info("Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    logger.error("Database connection not available");
    process.exit(1);
  }

  const bucket = new GridFSBucket(db, { bucketName: "frames" });
  const filesCollection = db.collection("frames.files");

  // Get all frame IDs linked to detections
  const Detection = mongoose.model("Detection");
  const linkedFrameIds = await Detection.distinct("frame.fileId");
  const linkedThumbIds = await Detection.distinct("frame.thumbFileId");
  const allLinkedIds = [...new Set([...linkedFrameIds, ...linkedThumbIds])].filter(
    (id) => id !== null
  );

  logger.info(`Found ${allLinkedIds.length} frames linked to detections`);

  // Find orphaned frames
  const orphanedFrames = await filesCollection
    .find({
      _id: { $nin: allLinkedIds.map((id) => new mongoose.Types.ObjectId(id.toString())) },
    })
    .toArray();

  if (orphanedFrames.length === 0) {
    logger.info("✓ No orphaned frames found. GridFS is clean!");
    return;
  }

  logger.info(`Found ${orphanedFrames.length} orphaned frames`);

  if (dryRun) {
    logger.info("\n🔍 DRY RUN MODE - No files will be deleted\n");
    logger.info("Orphaned frames that would be deleted:");
    let totalSize = 0;
    for (const frame of orphanedFrames.slice(0, 10)) {
      logger.info(`  ${frame.filename} (${(frame.length / 1024).toFixed(2)} KB)`);
      totalSize += frame.length;
    }
    if (orphanedFrames.length > 10) {
      logger.info(`  ... and ${orphanedFrames.length - 10} more`);
      totalSize = orphanedFrames.reduce((sum, f) => sum + f.length, 0);
    }
    logger.info(`\nTotal size to be freed: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    logger.info("\nRun without --dry-run to actually delete these frames");
  } else {
    logger.info("\n⚠️  DELETING orphaned frames...\n");
    let deleted = 0;
    let totalSize = 0;

    for (const frame of orphanedFrames) {
      try {
        await bucket.delete(frame._id);
        deleted++;
        totalSize += frame.length;
        if (deleted % 10 === 0) {
          logger.info(`Deleted ${deleted}/${orphanedFrames.length} frames...`);
        }
      } catch (err) {
        logger.error({ err, frameId: frame._id.toString() }, "Failed to delete frame");
      }
    }

    logger.info(`\n✓ Cleanup complete!`);
    logger.info(`  Deleted: ${deleted} frames`);
    logger.info(`  Space freed: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  }
}

const isDryRun = !process.argv.includes("--no-dry-run");

cleanupOrphanedFrames(isDryRun)
  .catch((err) => {
    logger.error({ err }, "Cleanup failed");
    process.exit(1);
  })
  .finally(() => {
    void mongoose.disconnect();
  });
