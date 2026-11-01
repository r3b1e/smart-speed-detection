import rateLimit from "express-rate-limit";
import { config } from "../config";

const skipHealth = (path: string): boolean => path === "/health" || path.startsWith("/api/docs");

/** Rate limits are disabled under test so suites do not self-throttle. */
const enabled = config.NODE_ENV !== "test";

/** Generous global limiter — protects against runaway clients, not users. */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !enabled || skipHealth(req.path),
  message: { error: { code: "RATE_LIMITED", message: "too many requests" } },
});

/** Strict limiter for credential endpoints. */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !enabled,
  message: { error: { code: "RATE_LIMITED", message: "too many auth attempts, slow down" } },
});

/** Device ingest: bursts of detections are normal, but bounded. */
export const ingestLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !enabled,
  message: { error: { code: "RATE_LIMITED", message: "ingest rate limit exceeded" } },
});
