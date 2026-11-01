import type { JwtAccessPayload, JwtRefreshPayload, Role } from "@smart-speed/shared";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { config, isProd } from "../config";
import { AppError } from "../errors";
import type { IUser } from "../models";

const REFRESH_COOKIE = "ssd_refresh";

export function signAccessToken(user: IUser): string {
  const payload: JwtAccessPayload = {
    sub: user.id,
    role: user.role,
    name: user.name,
    jti: randomUUID(),
  };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: `${config.JWT_LIFETIME_MINUTES}m`,
  });
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  try {
    return jwt.verify(token, config.JWT_ACCESS_SECRET) as JwtAccessPayload;
  } catch {
    throw new AppError("UNAUTHORIZED", "invalid access token");
  }
}

export function signRefreshToken(user: IUser): string {
  const payload: JwtRefreshPayload = { sub: user.id, tokenVersion: user.tokenVersion };
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: `${config.JWT_REFRESH_DAYS}d`,
  });
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  try {
    return jwt.verify(token, config.JWT_REFRESH_SECRET) as JwtRefreshPayload;
  } catch {
    throw new AppError("UNAUTHORIZED", "invalid refresh token");
  }
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/api/auth",
    maxAge: config.JWT_REFRESH_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}

export function readRefreshCookie(cookies: Record<string, string | undefined>): string {
  const token = cookies[REFRESH_COOKIE];
  if (!token) throw new AppError("UNAUTHORIZED", "missing refresh token");
  return token;
}

export function issueTokens(res: Response, user: IUser): { accessToken: string } {
  const accessToken = signAccessToken(user);
  setRefreshCookie(res, signRefreshToken(user));
  return { accessToken };
}

export type { Role };
