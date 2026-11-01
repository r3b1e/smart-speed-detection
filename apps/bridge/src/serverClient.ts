import type { IngestAck, IngestDetection } from "@smart-speed/shared";
import axios, { type AxiosInstance } from "axios";

export interface HeartbeatMeta {
  serialConnected: boolean;
  port?: string;
  lastSeq?: number;
  queueDepth: number;
  malformedCount: number;
  /** Firmware version from the device hello line (omitted before hello). */
  fw?: string;
}

export interface ServerClient {
  postDetection(payload: IngestDetection): Promise<IngestAck>;
  postHeartbeat(meta: HeartbeatMeta): Promise<void>;
  getDevice(): Promise<{
    id: string;
    name: string;
    speedLimitKmh: number;
    scaleFactor: number;
    status: string;
  }>;
}

export function createServerClient(baseUrl: string, deviceApiKey: string): ServerClient {
  const http: AxiosInstance = axios.create({
    baseURL: baseUrl,
    timeout: 10_000,
    headers: { "x-device-key": deviceApiKey },
  });
  return {
    async postDetection(payload) {
      const { data } = await http.post<IngestAck>("/api/ingest/detections", payload);
      return data;
    },
    async postHeartbeat(meta) {
      await http.post("/api/ingest/heartbeat", { source: "bridge", status: "ok", meta });
    },
    async getDevice() {
      const { data } = await http.get("/api/ingest/device");
      return data;
    },
  };
}
