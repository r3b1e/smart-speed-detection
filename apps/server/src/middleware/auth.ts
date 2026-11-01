import type { JwtAccessPayload, Role } from "@smart-speed/shared";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";
import { verifyAccessToken } from "../services/token";
import { User, type IUser } from "../models";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: IUser;
      accessTokenPayload?: JwtAccessPayload;
    }
  }
}

/** Verifies the Bearer access token and loads the (active) user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "missing bearer access token");
    }
    const payload = verifyAccessToken(header.slice(7));
    const user = await User.findById(payload.sub);
    if (!user) throw new AppError("UNAUTHORIZED", "account no longer exists");
    if (!user.isActive) throw new AppError("FORBIDDEN", "account is deactivated");
    req.user = user;
    req.accessTokenPayload = payload;
    next();
  } catch (err) {
    if (err instanceof AppError) next(err);
    else next(new AppError("UNAUTHORIZED", "invalid or expired access token"));
  }
}

/** Role gate — always applied AFTER requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError("UNAUTHORIZED", "authentication required"));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError("FORBIDDEN", `requires role: ${roles.join(" or ")}`));
      return;
    }
    next();
  };
}
