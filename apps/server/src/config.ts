import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/smart-speed"),
  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me"),
  JWT_REFRESH_SECRET: z.string().min(16).default("dev-refresh-secret-change-me"),
  JWT_LIFETIME_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
  VISION_URL: z.string().url().default("http://localhost:8001"),
  VISION_SHARED_SECRET: z.string().min(8).default("dev-vision-secret-change-me"),
  PUBLIC_SERVER_URL: z.string().url().default("http://localhost:4000"),
  MAX_FRAME_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 1024 * 1024),
  LOG_LEVEL: z.string().default("info"),
  // Email notifications (optional — omit to disable email)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  NOTIFY_EMAIL_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration: ${parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ")}`
  );
}

export const config = parsed.data;
export type Config = typeof config;

export const corsOrigins = config.CORS_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const isProd = config.NODE_ENV === "production";
