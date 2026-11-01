import { AdminUserCreateSchema, AdminUserUpdateSchema, UserQuerySchema } from "@smart-speed/shared";
import { Router } from "express";
import bcrypt from "bcrypt";
import { AppError, ah } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { User, toPublicUser, type IUser } from "../models";
import { audit } from "../services/audit";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole("admin"));

usersRouter.get(
  "/",
  validate({ query: UserQuerySchema }),
  ah(async (req, res) => {
    const { page, limit, q, role } = req.query as unknown as {
      page: number;
      limit: number;
      q?: string;
      role?: string;
    };
    const filter: Record<string, unknown> = {};
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];
    }
    if (role) filter.role = role;
    const [items, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({
      items: items.map(toPublicUser),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);

usersRouter.post(
  "/",
  validate({ body: AdminUserCreateSchema }),
  ah(async (req, res) => {
    const input = req.body as {
      name: string;
      email: string;
      password: string;
      role: string;
      isActive: boolean;
    };
    const existing = await User.findOne({ email: input.email });
    if (existing) throw new AppError("CONFLICT", "an account with this email already exists");
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await User.create({ ...input, passwordHash });
    await audit({
      actor: req.user!,
      action: "user.create",
      entity: "user",
      entityId: user.id,
      meta: { role: user.role },
    });
    res.status(201).json({ user: toPublicUser(user) });
  })
);

usersRouter.get(
  "/:id",
  ah(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError("NOT_FOUND", "user not found");
    res.json({ user: toPublicUser(user) });
  })
);

usersRouter.patch(
  "/:id",
  validate({ body: AdminUserUpdateSchema }),
  ah(async (req, res) => {
    const patch = req.body as Partial<{
      name: string;
      email: string;
      password: string;
      role: "admin" | "authority" | "user";
      isActive: boolean;
    }>;
    const user = await User.findById(req.params.id).select("+passwordHash");
    if (!user) throw new AppError("NOT_FOUND", "user not found");
    if (patch.email && patch.email !== user.email) {
      const clash = await User.findOne({ email: patch.email });
      if (clash) throw new AppError("CONFLICT", "an account with this email already exists");
    }
    if (patch.email) user.email = patch.email;
    if (patch.name) user.name = patch.name;
    if (patch.role) user.role = patch.role;
    if (patch.isActive !== undefined) user.isActive = patch.isActive;
    if (patch.password) user.passwordHash = await bcrypt.hash(patch.password, 10);
    if (patch.isActive === false && req.user!.id === user.id) {
      throw new AppError("CONFLICT", "you cannot deactivate your own account");
    }
    await user.save();
    await audit({
      actor: req.user!,
      action: "user.update",
      entity: "user",
      entityId: user.id,
      meta: { fields: Object.keys(patch) },
    });
    res.json({ user: toPublicUser(user) });
  })
);

usersRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const user = (await User.findById(req.params.id)) as IUser | null;
    if (!user) throw new AppError("NOT_FOUND", "user not found");
    if (req.user!.id === user.id)
      throw new AppError("CONFLICT", "you cannot deactivate your own account");
    user.isActive = false;
    user.tokenVersion += 1;
    await user.save();
    await audit({ actor: req.user!, action: "user.deactivate", entity: "user", entityId: user.id });
    res.json({ user: toPublicUser(user) });
  })
);
