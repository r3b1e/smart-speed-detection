import type { IUser } from "../models";
import { AuditLogModel } from "../models";

export interface AuditEntry {
  actor: IUser | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Fire-and-forget audit trail (failures are logged, never block the request). */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: entry.actor ? entry.actor._id : null,
      actorName: entry.actor ? entry.actor.name : null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      meta: entry.meta ?? null,
      at: new Date(),
    });
  } catch (err) {
    console.error("[audit] failed to write entry", err);
  }
}
