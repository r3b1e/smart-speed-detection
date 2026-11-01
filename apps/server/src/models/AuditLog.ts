import type { AuditLog as AuditLogDto } from "@smart-speed/shared";
import { Schema, model, type Types, type Document, type Model } from "mongoose";

export interface IAuditLog extends Document {
  actorId: Types.ObjectId | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  at: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  actorName: { type: String, default: null },
  action: { type: String, required: true, maxlength: 60 },
  entity: { type: String, required: true, maxlength: 60 },
  entityId: { type: String, default: null, maxlength: 120 },
  meta: { type: Schema.Types.Mixed, default: null },
  at: { type: Date, required: true, default: Date.now },
});

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ actorId: 1, at: -1 });
auditLogSchema.index({ entity: 1, entityId: 1 });

export function toPublicAuditLog(a: IAuditLog): AuditLogDto {
  return {
    id: a.id,
    actorId: a.actorId ? a.actorId.toString() : null,
    actorName: a.actorName,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId,
    meta: a.meta,
    at: a.at.toISOString(),
  };
}

export const AuditLogModel: Model<IAuditLog> = model<IAuditLog>("AuditLog", auditLogSchema);
