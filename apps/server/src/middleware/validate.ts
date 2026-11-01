import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";
import { AppError, zodDetails } from "../errors";

interface Schemas<B extends ZodTypeAny, Q extends ZodTypeAny, P extends ZodTypeAny> {
  body?: B;
  query?: Q;
  params?: P;
}

/**
 * Validates req.body / req.query / req.params with Zod and replaces them with
 * the parsed (coerced, defaulted) values.
 */
export function validate<B extends ZodTypeAny, Q extends ZodTypeAny, P extends ZodTypeAny>(
  schemas: Schemas<B, Q, P>
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body);
        if (!parsed.success)
          throw new AppError("VALIDATION_ERROR", "invalid request body", zodDetails(parsed.error));
        req.body = parsed.data;
      }
      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query);
        if (!parsed.success)
          throw new AppError(
            "VALIDATION_ERROR",
            "invalid query parameters",
            zodDetails(parsed.error)
          );
        req.query = parsed.data as Request["query"];
      }
      if (schemas.params) {
        const parsed = schemas.params.safeParse(req.params);
        if (!parsed.success)
          throw new AppError(
            "VALIDATION_ERROR",
            "invalid path parameters",
            zodDetails(parsed.error)
          );
        req.params = parsed.data as Request["params"];
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export type ParsedBody<T extends ZodTypeAny> = z.infer<T>;
