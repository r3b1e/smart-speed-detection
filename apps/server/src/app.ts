import { Router } from "express";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { corsOrigins, config } from "./config";
import { errorHandler, notFoundHandler } from "./errors";
import { logger } from "./logger";
import { globalLimiter } from "./middleware/rateLimit";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { devicesRouter } from "./routes/devices";
import { settingsRouter } from "./routes/settings";
import { auditRouter } from "./routes/audit";
import { vehiclesRouter } from "./routes/vehicles";
import { ingestRouter } from "./routes/ingest";
import { detectionsRouter } from "./routes/detections";
import { analyticsRouter } from "./routes/analytics";
import { mapRouter } from "./routes/map";
import { exportRouter } from "./routes/export";
import { framesRouter } from "./routes/frames";
import { sessionsRouter } from "./routes/sessions";

export function createApp(): express.Express {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || corsOrigins.includes(origin)) cb(null, true);
        else cb(new Error("origin not allowed by CORS"));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/health",
      },
    })
  );
  app.use(globalLimiter);

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "server",
      env: config.NODE_ENV,
      at: new Date().toISOString(),
    });
  });

  const api = Router();
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use("/devices", devicesRouter);
  api.use("/settings", settingsRouter);
  api.use("/audit", auditRouter);
  api.use("/vehicles", vehiclesRouter);
  api.use("/ingest", ingestRouter);
  api.use("/detections", detectionsRouter);
  api.use("/analytics", analyticsRouter);
  api.use("/map", mapRouter);
  api.use("/export", exportRouter);
  api.use("/frames", framesRouter);
  api.use("/sessions", sessionsRouter);
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
