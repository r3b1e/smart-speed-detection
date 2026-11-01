import pino from "pino";
import { config, isProd } from "./config";

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.apiKey",
      "*.accessToken",
      "*.refreshToken",
      "apiKeyHash",
    ],
    remove: true,
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }),
});

export type Logger = typeof logger;
