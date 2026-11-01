import { AuditQuerySchema } from "@smart-speed/shared";
import { Router } from "express";
import { ah } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AuditLogModel, toPublicAuditLog } from "../models";

export const auditRouter = Router();

auditRouter.use(requireAuth, requireRole("admin"));

auditRouter.get(
  "/",
  validate({ query: AuditQuerySchema }),
  ah(async (req, res) => {
    const { page, limit, action, entity, actorId } = req.query as unknown as {
      page: number;
      limit: number;
      action?: string;
      entity?: string;
      actorId?: string;
    };
    const filter: Record<string, unknown> = {};
    if (action) filter.action = { $regex: action, $options: "i" };
    if (entity) filter.entity = entity;
    if (actorId) filter.actorId = actorId;
    const [items, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ at: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      AuditLogModel.countDocuments(filter),
    ]);
    res.json({
      items: items.map(toPublicAuditLog),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);
