import pino from "pino";

export type Logger = pino.Logger;

/** Pretty console output on a TTY, plain JSON otherwise (tests/CI stay silent). */
export function createLogger(level: string): Logger {
  const pretty =
    process.stdout.isTTY && process.env.LOG_PRETTY !== "false"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined;
  return pino({ level, ...(pretty ? { transport: pretty } : {}) });
}
