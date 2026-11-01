import { LoginInputSchema, RegisterInputSchema } from "@smart-speed/shared";
import { Router } from "express";
import bcrypt from "bcrypt";
import { AppError, ah } from "../errors";
import { authLimiter } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { User, toPublicUser } from "../models";
import { audit } from "../services/audit";
import {
  clearRefreshCookie,
  issueTokens,
  readRefreshCookie,
  verifyRefreshToken,
} from "../services/token";

export const authRouter = Router();

const BCRYPT_ROUNDS = 10;

authRouter.post(
  "/register",
  authLimiter,
  validate({ body: RegisterInputSchema }),
  ah(async (req, res) => {
    const { name, email, password } = req.body as { name: string; email: string; password: string };
    const existing = await User.findOne({ email });
    if (existing) throw new AppError("CONFLICT", "an account with this email already exists");
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ name, email, passwordHash, role: "user" });
    await audit({ actor: user, action: "user.register", entity: "user", entityId: user.id });
    res.status(201).json({ user: toPublicUser(user), ...issueTokens(res, user) });
  })
);

authRouter.post(
  "/login",
  authLimiter,
  validate({ body: LoginInputSchema }),
  ah(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user) throw new AppError("UNAUTHORIZED", "invalid email or password");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new AppError("UNAUTHORIZED", "invalid email or password");
    if (!user.isActive) throw new AppError("FORBIDDEN", "account is deactivated");
    user.lastLoginAt = new Date();
    await user.save();
    await audit({ actor: user, action: "user.login", entity: "user", entityId: user.id });
    res.json({ user: toPublicUser(user), ...issueTokens(res, user) });
  })
);

authRouter.post(
  "/refresh",
  ah(async (req, res) => {
    const token = readRefreshCookie(req.cookies as Record<string, string | undefined>);
    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.sub);
    if (!user) throw new AppError("UNAUTHORIZED", "account no longer exists");
    if (!user.isActive) throw new AppError("FORBIDDEN", "account is deactivated");
    if (user.tokenVersion !== payload.tokenVersion) {
      clearRefreshCookie(res);
      throw new AppError("UNAUTHORIZED", "session was revoked, please log in again");
    }
    res.json({ user: toPublicUser(user), ...issueTokens(res, user) });
  })
);

authRouter.post(
  "/logout",
  ah(async (req, res) => {
    try {
      const token = readRefreshCookie(req.cookies as Record<string, string | undefined>);
      const payload = verifyRefreshToken(token);
      const user = await User.findById(payload.sub);
      if (user && user.tokenVersion === payload.tokenVersion) {
        user.tokenVersion += 1;
        await user.save();
      }
    } catch {
      // already invalid — clearing the cookie is enough
    }
    clearRefreshCookie(res);
    res.status(204).end();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  })
);
