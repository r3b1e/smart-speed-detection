import type { ErrorCode } from "@smart-speed/shared";
import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_DEVICE_KEY: 401,
  DUPLICATE_DETECTION: 409,
  INTERNAL_ERROR: 500,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (details !== undefined) this.details = details;
    Error.captureStackTrace(this, AppError);
  }
}

export function zodDetails(err: ZodError): unknown {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));
}

/** Wraps async route handlers so rejections reach the error middleware. */
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
export function ah(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("NOT_FOUND", `No route for ${req.method} ${req.path}`));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === "LIMIT_FILE_SIZE") {
    res
      .status(413)
      .json({ error: { code: "PAYLOAD_TOO_LARGE", message: "frame exceeds size limit" } });
    return;
  }
  if (anyErr?.code === "LIMIT_UNEXPECTED_FILE") {
    res
      .status(415)
      .json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "unexpected file field" } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "internal server error" } });
}
