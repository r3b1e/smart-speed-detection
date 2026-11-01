import { SettingsUpdateSchema } from "@smart-speed/shared";
import { Router } from "express";
import { ah } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { getSettings, toPublicSettings } from "../models";
import { audit } from "../services/audit";

export const settingsRouter = Router();

settingsRouter.get(
  "/",
  requireAuth,
  ah(async (_req, res) => {
    res.json({ settings: toPublicSettings(await getSettings()) });
  })
);

settingsRouter.patch(
  "/",
  requireAuth,
  requireRole("admin"),
  validate({ body: SettingsUpdateSchema }),
  ah(async (req, res) => {
    const patch = req.body as Record<string, unknown>;
    const settings = await getSettings();
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (settings as unknown as Record<string, unknown>)[k] = v;
    }
    settings.updatedAt = new Date();
    await settings.save();
    await audit({
      actor: req.user!,
      action: "settings.update",
      entity: "settings",
      entityId: "singleton",
      meta: patch,
    });
    res.json({ settings: toPublicSettings(settings) });
  })
);
