/**
 * Utility script to verify GridFS bucket setup and frame storage organization.
 * Usage: pnpm tsx src/scripts/verify-gridfs.ts
 */

import mongoose from "mongoose";
import { config } from "../config";
import { logger } from "../logger";

const { GridFSBucket } = mongoose.mongo;

async function verifyGridFS(): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  logger.info("Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    logger.error("Database connection not available");
    process.exit(1);
  }

  const bucket = new GridFSBucket(db, { bucketName: "frames" });

  // Check if frames bucket exists and count files
  const collections = await db.listCollections().toArray();
  const hasFramesFiles = collections.some((c) => c.name === "frames.files");
  const hasFramesChunks = collections.some((c) => c.name === "frames.chunks");

  logger.info("GridFS Bucket Status:");
  logger.info(`  frames.files collection: ${hasFramesFiles ? "✓ exists" : "✗ missing"}`);
  logger.info(`  frames.chunks collection: ${hasFramesChunks ? "✓ exists" : "✗ missing"}`);

  if (!hasFramesFiles || !hasFramesChunks) {
    logger.info(
      "\nNote: Collections will be created automatically when first frame is uploaded."
    );
  }

  // Count total frames
  const filesCollection = db.collection("frames.files");
  const totalFrames = await filesCollection.countDocuments();
  logger.info(`\nTotal frames stored: ${totalFrames}`);

  if (totalFrames > 0) {
    // Sample frame metadata
    const sampleFrames = await filesCollection.find({}).limit(5).toArray();
    logger.info("\nSample frames:");
    for (const frame of sampleFrames) {
      logger.info(`  File: ${frame.filename}`);
      logger.info(`    ID: ${frame._id}`);
      logger.info(`    Size: ${(frame.length / 1024).toFixed(2)} KB`);
      logger.info(`    Upload: ${frame.uploadDate.toISOString()}`);
      logger.info(`    Metadata: ${JSON.stringify(frame.metadata)}`);
      logger.info("");
    }

    // Count by kind
    const frameCount = await filesCollection.countDocuments({ "metadata.kind": "frame" });
    const thumbCount = await filesCollection.countDocuments({ "metadata.kind": "thumb" });
    logger.info("Frame breakdown:");
    logger.info(`  Full frames: ${frameCount}`);
    logger.info(`  Thumbnails: ${thumbCount}`);

    // Check for orphaned frames (no longer linked to any detection)
    const Detection = mongoose.model("Detection");
    const linkedFrameIds = await Detection.distinct("frame.fileId");
    const linkedThumbIds = await Detection.distinct("frame.thumbFileId");
    const allLinkedIds = [...new Set([...linkedFrameIds, ...linkedThumbIds])].filter(
      (id) => id !== null
    );

    const orphanedFrames = await filesCollection.countDocuments({
      _id: { $nin: allLinkedIds.map((id) => new mongoose.Types.ObjectId(id.toString())) },
    });

    logger.info(`\nOrphaned frames (not linked to detections): ${orphanedFrames}`);
    if (orphanedFrames > 0) {
      logger.info("  (These can be cleaned up with a maintenance script)");
    }
  }

  // Verify indexes on frames.files
  const indexes = await filesCollection.indexes();
  logger.info("\nGridFS indexes:");
  for (const index of indexes) {
    logger.info(`  ${index.name}: ${JSON.stringify(index.key)}`);
  }

  // Check storage size
  const statsCmd = await db.command({ collStats: "frames.files" }).catch(() => null);
  if (statsCmd) {
    logger.info(`\nStorage statistics:`);
    logger.info(`  Total size: ${((statsCmd.size as number) / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`  Average frame size: ${totalFrames > 0 ? ((statsCmd.avgObjSize as number) / 1024).toFixed(2) : 0} KB`);
  }

  logger.info("\n✓ GridFS verification complete");
}

verifyGridFS()
  .catch((err) => {
    logger.error({ err }, "GridFS verification failed");
    process.exit(1);
  })
  .finally(() => {
    void mongoose.disconnect();
  });
