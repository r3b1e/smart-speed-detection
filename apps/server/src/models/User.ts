import type { User as UserDto } from "@smart-speed/shared";
import { Schema, model, type Document, type Model } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: "admin" | "authority" | "user";
  isActive: boolean;
  lastLoginAt: Date | null;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "authority", "user"], required: true, default: "user" },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, isActive: 1 });

export function toPublicUser(u: IUser): UserDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

export const User: Model<IUser> = model<IUser>("User", userSchema);
