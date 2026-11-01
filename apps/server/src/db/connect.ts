import mongoose from "mongoose";
import { config } from "../config";
import { logger } from "../logger";

export async function connectDb(uri: string = config.MONGODB_URI): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  const conn = await mongoose.connect(uri);
  logger.info({ uri: uri.replace(/\/\/[^@]*@/, "//***@") }, "mongodb connected");
  return conn;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
