import { z } from "zod";
import { RoleSchema } from "./common";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);
export const PasswordSchema = z
  .string()
  .min(8, "password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "password must contain a letter")
  .regex(/[0-9]/, "password must contain a number");

export const RegisterInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: EmailSchema,
  password: PasswordSchema,
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: EmailSchema,
  role: RoleSchema,
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const AdminUserCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: EmailSchema,
  password: PasswordSchema,
  role: RoleSchema.default("user"),
  isActive: z.boolean().default(true),
});
export type AdminUserCreate = z.infer<typeof AdminUserCreateSchema>;

export const AdminUserUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: EmailSchema.optional(),
  password: PasswordSchema.optional(),
  role: RoleSchema.optional(),
  isActive: z.boolean().optional(),
});
export type AdminUserUpdate = z.infer<typeof AdminUserUpdateSchema>;

export const UserQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().max(80).optional(),
  role: RoleSchema.optional(),
});
export type UserQuery = z.infer<typeof UserQuerySchema>;

export interface JwtAccessPayload {
  sub: string;
  role: z.infer<typeof RoleSchema>;
  name: string;
  /** unique token id — keeps two tokens issued in the same second distinct */
  jti: string;
}

export interface JwtRefreshPayload {
  sub: string;
  tokenVersion: number;
}

/* ---------------- vehicles ---------------- */

export const VehicleCreateSchema = z.object({
  plate: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9 -]+$/, "plate may contain letters, numbers, spaces, dashes"),
  nickname: z.string().trim().max(60).optional(),
});
export type VehicleCreate = z.infer<typeof VehicleCreateSchema>;

export const VehicleUpdateSchema = z.object({
  nickname: z.string().trim().max(60).optional(),
});
export type VehicleUpdate = z.infer<typeof VehicleUpdateSchema>;

export const VehicleSchema = z.object({
  id: z.string(),
  plate: z.string(),
  nickname: z.string().nullable(),
  ownerUserId: z.string(),
  createdAt: z.string().datetime(),
  /** Detections matched to this plate (only for the owner's own vehicles). */
  matchCount: z.number().int().optional(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

/* ---------------- audit logs ---------------- */

export const AuditLogSchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  meta: z.record(z.unknown()).nullable(),
  at: z.string().datetime(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(60).optional(),
  entity: z.string().max(60).optional(),
  actorId: z.string().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
