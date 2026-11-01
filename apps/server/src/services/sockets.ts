import type {
  Detection as DetectionDto,
  DetectionFramePayload,
  Device as DeviceDto,
  OverspeedAlert,
  SessionNewPayload,
  SessionUpdatedPayload,
  SystemStatus,
} from "@smart-speed/shared";
import { SOCKET_EVENTS } from "@smart-speed/shared";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { corsOrigins } from "../config";
import { AppError } from "../errors";
import { logger } from "../logger";
import { Device, User } from "../models";
import { hashApiKey } from "./crypto";
import { verifyAccessToken } from "./token";

interface SocketData {
  user?: { id: string; role: string; name: string };
  deviceId?: string;
}

let io: Server | null = null;

/**
 * Socket.IO with a JWT handshake for dashboards (join `role:<role>` rooms) and
 * an API-key handshake for bridges (join `device:<id>` for commands).
 */
export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
  });

  io.use(async (socket: Socket<{ data?: SocketData }>, next) => {
    try {
      const auth = socket.handshake.auth as { token?: string; deviceKey?: string };
      const header = socket.handshake.headers.authorization;
      const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      const data: SocketData = {};

      if (auth.deviceKey) {
        const device = await Device.findOne({ apiKeyHash: hashApiKey(auth.deviceKey) });
        if (!device) throw new AppError("INVALID_DEVICE_KEY", "unknown device key");
        data.deviceId = device.id;
      } else {
        const token = auth.token ?? bearer;
        if (!token) throw new AppError("UNAUTHORIZED", "missing access token");
        const payload = verifyAccessToken(token);
        const user = await User.findById(payload.sub);
        if (!user || !user.isActive) throw new AppError("UNAUTHORIZED", "invalid access token");
        data.user = { id: user.id, role: user.role, name: user.name };
      }
      socket.data = data;
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : "unauthorized";
      next(new Error(message));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    if (data.user) {
      void socket.join(`role:${data.user.role}`);
      logger.debug({ userId: data.user.id, role: data.user.role }, "socket connected");
    } else if (data.deviceId) {
      void socket.join(`device:${data.deviceId}`);
      logger.debug({ deviceId: data.deviceId }, "bridge socket connected");
    }
  });

  return io;
}

export function closeSocket(): void {
  io?.close();
  io = null;
}

function emit(event: string, payload: unknown): void {
  io?.emit(event, payload);
}

export const sockets = {
  detectionNew: (detection: DetectionDto) => emit(SOCKET_EVENTS.detectionNew, detection),
  detectionUpdated: (detection: DetectionDto) => emit(SOCKET_EVENTS.detectionUpdated, detection),
  detectionFrame: (payload: DetectionFramePayload) => emit(SOCKET_EVENTS.detectionFrame, payload),
  overspeedAlert: (alert: OverspeedAlert) => emit(SOCKET_EVENTS.alertOverspeed, alert),
  systemStatus: (status: SystemStatus) => emit(SOCKET_EVENTS.systemStatus, status),
  deviceUpdated: (device: DeviceDto) => emit(SOCKET_EVENTS.deviceUpdated, device),
  sessionNew: (payload: SessionNewPayload) => emit(SOCKET_EVENTS.sessionNew, payload),
  sessionUpdated: (payload: SessionUpdatedPayload) => emit(SOCKET_EVENTS.sessionUpdated, payload),
  /** server -> bridge: forward a command to the Arduino over serial */
  deviceCommand: (deviceId: string, command: unknown) =>
    emitToDevice(deviceId, SOCKET_EVENTS.deviceCommand, { deviceId, command }),
  /** current socket server (tests / diagnostics) */
  current: () => io,
};

function emitToDevice(deviceId: string, event: string, payload: unknown): void {
  io?.to(`device:${deviceId}`).emit(event, payload);
}
