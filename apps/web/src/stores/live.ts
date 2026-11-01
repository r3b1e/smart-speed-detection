import {
  SOCKET_EVENTS,
  type Detection,
  type DetectionFramePayload,
  type Device,
  type OverspeedAlert,
  type SessionNewPayload,
  type SessionUpdatedPayload,
  type SystemStatus,
} from "@smart-speed/shared";
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import { SOCKET_URL } from "../lib/env";
import { getAccessToken } from "../lib/session";
import { tryRefresh } from "../lib/api";

const RECENT_CAP = 100;

export type LiveStatus = "idle" | "connecting" | "connected" | "reconnecting";

/** Lightweight session summary kept in the live store */
export interface LiveSession {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  bootId: string;
  startedAt: string;
  detectionCount: number;
  overspeedCount: number;
  maxSpeed: number;
  avgSpeed: number;
}

interface LiveState {
  status: LiveStatus;
  system: SystemStatus | null;
  /** newest first, capped at RECENT_CAP */
  recent: Detection[];
  latest: Detection | null;
  /** per-detection frame updates that arrived over the socket */
  frames: Record<string, DetectionFramePayload>;
  /** increments on every overspeed alert — subscribers react to the change */
  alertSeq: number;
  lastAlert: OverspeedAlert | null;
  /** increments whenever a device record changes (offline watchdog, limit push) */
  deviceBump: number;
  /** active sessions keyed by sessionId */
  activeSessions: Record<string, LiveSession>;
  /**
   * When non-null, live detections are filtered to plates in this list
   * (plain "user" role — mirrors the server-side plate scope).
   */
  plateScope: string[] | null;
  connect: () => void;
  disconnect: () => void;
  setPlateScope: (plates: string[] | null) => void;
}

let socket: Socket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function inScope(state: LiveState, detection: Detection): boolean {
  if (state.plateScope === null) return true;
  return detection.plate !== null && state.plateScope.includes(detection.plate);
}

export const useLive = create<LiveState>((set, get) => {
  const handleConnectError = (error: Error): void => {
    const authFailure = /token/i.test(error.message);
    if (authFailure) {
      void tryRefresh().then((token) => {
        if (token && socket) {
          socket.auth = { token };
          socket.connect();
        } else {
          set({ status: "reconnecting" });
        }
      });
      return;
    }
    set({ status: "reconnecting" });
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        socket?.connect();
      }, 3000);
    }
  };

  const bind = (instance: Socket): void => {
    instance.on("connect", () => set({ status: "connected" }));
    instance.on("disconnect", () => set({ status: "reconnecting" }));
    instance.on("connect_error", handleConnectError);

    instance.on(SOCKET_EVENTS.detectionNew, (payload: Detection) => {
      const state = get();
      if (!inScope(state, payload)) return;
      set({
        latest: payload,
        recent: [payload, ...state.recent].slice(0, RECENT_CAP),
      });
    });

    instance.on(SOCKET_EVENTS.detectionUpdated, (payload: Detection) => {
      const state = get();
      if (!inScope(state, payload)) return;
      set({
        recent: state.recent.map((d) => (d.id === payload.id ? payload : d)),
        latest: state.latest?.id === payload.id ? payload : state.latest,
      });
    });

    instance.on(SOCKET_EVENTS.detectionFrame, (payload: DetectionFramePayload) => {
      const state = get();
      set({
        frames: { ...state.frames, [payload.detectionId]: payload },
        recent: state.recent.map((d) =>
          d.id === payload.detectionId
            ? {
                ...d,
                frame: {
                  ...d.frame,
                  status: payload.status,
                  capturedAt: payload.capturedAt ?? d.frame.capturedAt,
                },
              }
            : d
        ),
      });
    });

    instance.on(SOCKET_EVENTS.systemStatus, (payload: SystemStatus) => {
      set({ system: payload });
    });

    instance.on(SOCKET_EVENTS.alertOverspeed, (payload: OverspeedAlert) => {
      const state = get();
      if (
        state.plateScope !== null &&
        (payload.plate === null || !state.plateScope.includes(payload.plate))
      ) {
        return;
      }
      set({ lastAlert: payload, alertSeq: state.alertSeq + 1 });
    });

    instance.on(SOCKET_EVENTS.deviceUpdated, (_payload: Device) => {
      set({ deviceBump: get().deviceBump + 1 });
    });

    instance.on(SOCKET_EVENTS.sessionNew, (payload: SessionNewPayload) => {
      const session: LiveSession = {
        sessionId: payload.sessionId,
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        bootId: payload.bootId,
        startedAt: payload.startedAt,
        detectionCount: 0,
        overspeedCount: 0,
        maxSpeed: 0,
        avgSpeed: 0,
      };
      set((state) => ({
        activeSessions: { ...state.activeSessions, [payload.sessionId]: session },
      }));
    });

    instance.on(SOCKET_EVENTS.sessionUpdated, (payload: SessionUpdatedPayload) => {
      set((state) => {
        const existing = state.activeSessions[payload.sessionId];
        if (!existing) return {};
        return {
          activeSessions: {
            ...state.activeSessions,
            [payload.sessionId]: {
              ...existing,
              detectionCount: payload.detectionCount,
              overspeedCount: payload.overspeedCount,
              maxSpeed: payload.maxSpeed,
              avgSpeed: payload.avgSpeed,
            },
          },
        };
      });
    });
  };

  return {
    status: "idle",
    system: null,
    recent: [],
    latest: null,
    frames: {},
    alertSeq: 0,
    lastAlert: null,
    deviceBump: 0,
    activeSessions: {},
    plateScope: null,

    connect() {
      const token = getAccessToken();
      if (!token) return;
      if (socket) {
        if (socket.connected) return;
        socket.auth = { token };
        socket.connect();
        return;
      }
      set({ status: "connecting" });
      socket = io(SOCKET_URL || window.location.origin, {
        auth: { token },
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 15000,
      });
      bind(socket);
    },

    disconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.removeAllListeners();
      socket?.disconnect();
      socket = null;
      set({
        status: "idle",
        system: null,
        recent: [],
        latest: null,
        frames: {},
        lastAlert: null,
        activeSessions: {},
        plateScope: null,
      });
    },

    setPlateScope(plates) {
      set({ plateScope: plates });
    },
  };
});
