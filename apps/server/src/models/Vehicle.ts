import type { Vehicle as VehicleDto } from "@smart-speed/shared";
import { Schema, model, type Types, type Document, type Model } from "mongoose";

export interface IVehicle extends Document {
  ownerUserId: Types.ObjectId;
  plate: string;
  nickname: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const vehicleSchema = new Schema<IVehicle>(
  {
    ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plate: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
    },
    nickname: { type: String, default: null, maxlength: 60 },
  },
  { timestamps: true }
);

export function toPublicVehicle(v: IVehicle, matchCount?: number): VehicleDto {
  return {
    id: v.id,
    plate: v.plate,
    nickname: v.nickname,
    ownerUserId: v.ownerUserId.toString(),
    createdAt: v.createdAt.toISOString(),
    ...(matchCount !== undefined ? { matchCount } : {}),
  };
}

export const Vehicle: Model<IVehicle> = model<IVehicle>("Vehicle", vehicleSchema);
