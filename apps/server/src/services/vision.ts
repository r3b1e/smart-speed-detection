import { config } from "../config";
import { logger } from "../logger";
import { Detection } from "../models";
import { sockets } from "./sockets";
import { notifyOverspeed } from "./whatsapp";

/** While vision is unreachable we log one warning, then stay quiet until it recovers. */
let downSince: number | null = null;

/**
 * Marks a still-pending frame failed immediately instead of waiting for the
 * 60 s watchdog. No-op if the frame already reached another state (e.g. the
 * upload landed just before a late failure response).
 */
async function markCaptureFailed(detectionId: string): Promise<void> {
  try {
    const detection = await Detection.findById(detectionId).select("frame.status");
    if (!detection || detection.frame.status !== "pending") return;
    detection.frame.status = "failed";
    await detection.save();
    notifyOverspeed(detectionId, null); // text-only alert: the violation still gets reported
    sockets.detectionFrame({
      detectionId,
      status: "failed",
      thumbUrl: null,
      frameUrl: null,
      capturedAt: null,
    });
  } catch (err) {
    logger.warn(
      { detectionId, err: err instanceof Error ? err.message : String(err) },
      "could not mark capture failed"
    );
  }
}

/**
 * Asks the vision service to capture the camera frame for a detection.
 * Fire-and-forget: ingest never waits on the camera. Any outcome other than
 * a successful capture marks the frame `failed` right away so the UI can
 * offer retry without waiting for the watchdog.
 */
export function triggerCapture(detectionId: string, eventTs: Date, offsetMs: number): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  fetch(`${config.VISION_URL}/capture`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vision-secret": config.VISION_SHARED_SECRET,
    },
    body: JSON.stringify({ detectionId, eventTs: eventTs.toISOString(), offsetMs }),
    signal: controller.signal,
  })
    .then(async (res) => {
      const body = (await res.json().catch(() => null)) as
        | { status?: string; reason?: string }
        | null;
      if (!res.ok || body?.status !== "ok") {
        logger.warn(
          { detectionId, status: res.status, reason: body?.reason },
          "vision did not capture a frame"
        );
        await markCaptureFailed(detectionId);
        return;
      }
      if (downSince !== null) {
        logger.info({ downtimeMs: Date.now() - downSince }, "vision service recovered");
        downSince = null;
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (downSince === null) {
        downSince = Date.now();
        logger.warn({ err: message }, "vision unreachable — will not log again until it recovers");
      }
      void markCaptureFailed(detectionId);
    })
    .finally(() => clearTimeout(timer));
}
