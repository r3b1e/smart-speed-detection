import mongoose from "mongoose";
import { AppError } from "../errors";

const { GridFSBucket, ObjectId } = mongoose.mongo;
type GridFSFile = NonNullable<
  Awaited<ReturnType<ReturnType<InstanceType<typeof GridFSBucket>["find"]>["next"]>>
>;

function bucket(): InstanceType<typeof GridFSBucket> {
  const database = mongoose.connection.db;
  if (!database) throw new AppError("INTERNAL_ERROR", "database is not connected");
  return new GridFSBucket(database, { bucketName: "frames" });
}

export interface StoredFile {
  id: string;
  contentType: string;
}

/** Streams a buffer into GridFS and resolves with the file id. */
export function saveFrame(
  buffer: Buffer,
  opts: { filename: string; contentType: string; detectionId: string; kind: "frame" | "thumb" }
): Promise<StoredFile> {
  return new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(opts.filename, {
      contentType: opts.contentType,
      metadata: { detectionId: opts.detectionId, kind: opts.kind },
    });
    stream.on("error", reject);
    stream.on("finish", () =>
      resolve({ id: stream.id.toHexString(), contentType: opts.contentType })
    );
    stream.end(buffer);
  });
}

export async function findFile(fileId: string): Promise<GridFSFile | null> {
  if (!ObjectId.isValid(fileId)) return null;
  return bucket().find(new ObjectId(fileId)).next();
}

export function downloadStream(fileId: string) {
  return bucket().openDownloadStream(new ObjectId(fileId));
}
