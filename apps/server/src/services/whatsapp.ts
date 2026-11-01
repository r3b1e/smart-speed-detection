/**
 * WhatsApp overspeed alerts through the Meta WhatsApp Cloud API.
 *
 * For every overspeed detection the admin(s) get ONE message: the camera
 * photo with a caption (speed, limit, % over, station, time) once the frame
 * is stored, or a text-only alert if the capture failed. Sending is
 * fire-and-forget: a WhatsApp problem is logged and never affects ingest.
 *
 * Delivery modes:
 * - plain (default): image message with caption. WhatsApp only allows this
 *   while the admin has messaged the business number in the last 24 h.
 * - template (WHATSAPP_TEMPLATE_NAME set): an approved template with an IMAGE
 *   header and 5 body variables — allowed at any time. See README.
 */
import { config } from "../config";
import { logger } from "../logger";
import { Detection, Device } from "../models";

export interface OverspeedFacts {
  detectionId: string;
  scaledSpeedKmh: number;
  measuredSpeedKmh: number;
  limitKmh: number;
  severity: string;
  direction: "fwd" | "rev";
  stationName: string;
  detectedAt: Date;
}

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (...args) => fetch(...args);

/** Test hook: replace the HTTP client. */
export function setWhatsAppFetch(fn: FetchFn | null): void {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

/* ---------------- configuration ---------------- */

export function adminNumbers(raw: string = config.WHATSAPP_ADMIN_NUMBERS): string[] {
  return raw
    .split(",")
    .map((n) => n.replace(/\D/g, "")) // "+91 98765-43210" -> "919876543210"
    .filter((n) => n.length >= 8);
}

export function whatsappConfigured(): boolean {
  return (
    config.WHATSAPP_ENABLED &&
    Boolean(config.WHATSAPP_ACCESS_TOKEN) &&
    Boolean(config.WHATSAPP_PHONE_NUMBER_ID) &&
    adminNumbers().length > 0
  );
}

/* ---------------- message text ---------------- */

function formatTime(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: config.NOTIFY_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(at);
}

function excessPct(f: OverspeedFacts): number {
  return f.limitKmh > 0 ? ((f.scaledSpeedKmh - f.limitKmh) / f.limitKmh) * 100 : 0;
}

export function overspeedCaption(f: OverspeedFacts, withPhoto: boolean): string {
  const lines = [
    "🚨 *Overspeed detected*",
    `Speed: *${f.scaledSpeedKmh.toFixed(1)} km/h* (limit ${f.limitKmh} km/h, +${excessPct(f).toFixed(0)}%)`,
    `Severity: ${f.severity}`,
    `Direction: ${f.direction === "fwd" ? "IN → OUT" : "OUT → IN"}`,
    `Station: ${f.stationName}`,
    `Time: ${formatTime(f.detectedAt)}`,
  ];
  if (f.measuredSpeedKmh !== f.scaledSpeedKmh) {
    lines.push(`Gate reading: ${f.measuredSpeedKmh.toFixed(2)} km/h (scaled)`);
  }
  if (!withPhoto) lines.push("📷 Camera photo could not be captured for this vehicle.");
  if (config.PUBLIC_WEB_URL) {
    lines.push(`Details: ${config.PUBLIC_WEB_URL.replace(/\/$/, "")}/detections`);
  }
  lines.push(`Ref: ${f.detectionId}`);
  return lines.join("\n");
}

/* ---------------- Graph API calls ---------------- */

class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message);
  }
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/${path}`;
}

async function graphCall(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchImpl(graphUrl(path), {
    ...init,
    headers: { authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (body.error ?? {}) as { message?: string; code?: number };
    throw new WhatsAppError(err.message ?? `HTTP ${res.status}`, err.code);
  }
  return body;
}

/** Uploads the JPEG once; the returned media id is reused for every recipient. */
async function uploadPhoto(jpeg: Buffer): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/jpeg");
  form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "overspeed.jpg");
  const body = await graphCall("media", { method: "POST", body: form });
  if (typeof body.id !== "string") throw new WhatsAppError("media upload returned no id");
  return body.id;
}

function messagePayload(
  to: string,
  f: OverspeedFacts,
  mediaId: string | null
): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (config.WHATSAPP_TEMPLATE_NAME && mediaId) {
    const text = (value: string) => ({ type: "text", text: value });
    return {
      ...base,
      type: "template",
      template: {
        name: config.WHATSAPP_TEMPLATE_NAME,
        language: { code: config.WHATSAPP_TEMPLATE_LANG },
        components: [
          { type: "header", parameters: [{ type: "image", image: { id: mediaId } }] },
          {
            type: "body",
            parameters: [
              text(f.scaledSpeedKmh.toFixed(1)),
              text(String(f.limitKmh)),
              text(`+${excessPct(f).toFixed(0)}%`),
              text(f.stationName),
              text(formatTime(f.detectedAt)),
            ],
          },
        ],
      },
    };
  }
  if (mediaId) {
    return { ...base, type: "image", image: { id: mediaId, caption: overspeedCaption(f, true) } };
  }
  return { ...base, type: "text", text: { body: overspeedCaption(f, false) } };
}

/** Sends the alert to every admin number. Returns how many were accepted by WhatsApp. */
export async function sendOverspeedAlert(f: OverspeedFacts, jpeg: Buffer | null): Promise<number> {
  const mediaId = jpeg ? await uploadPhoto(jpeg) : null;
  let sent = 0;
  for (const to of adminNumbers()) {
    try {
      await graphCall("messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(messagePayload(to, f, mediaId)),
      });
      sent += 1;
    } catch (err) {
      const e = err as WhatsAppError;
      logger.warn(
        {
          to: `…${to.slice(-4)}`,
          code: e.code,
          err: e.message,
          hint:
            e.code === 131047 || e.code === 131026
              ? "outside the 24 h window: admin must message the WhatsApp number first, or set WHATSAPP_TEMPLATE_NAME"
              : undefined,
        },
        "whatsapp alert not delivered"
      );
    }
  }
  return sent;
}

/* ---------------- trigger (fire-and-forget, once per detection) ---------------- */

const notified = new Map<string, "photo" | "text">(); // detectionId -> what was sent
const NOTIFIED_CAP = 1000;

function remember(id: string, kind: "photo" | "text"): void {
  notified.set(id, kind);
  if (notified.size > NOTIFIED_CAP) {
    const oldest = notified.keys().next().value;
    if (oldest !== undefined) notified.delete(oldest);
  }
}

/** Test hook. */
export function resetWhatsAppDedupe(): void {
  notified.clear();
}

/**
 * Notify admins about an overspeed detection. `jpeg` = the stored camera
 * frame, or null when capture failed. Sends at most one photo alert and one
 * text alert per detection (a photo that arrives after a text-only alert —
 * e.g. a manual retry — is still delivered).
 */
export function notifyOverspeed(detectionId: string, jpeg: Buffer | null): void {
  if (!whatsappConfigured()) return;
  const kind = jpeg ? "photo" : "text";
  const previous = notified.get(detectionId);
  if (previous === "photo" || previous === kind) return;
  remember(detectionId, kind);

  void (async () => {
    const detection = await Detection.findById(detectionId).lean();
    if (!detection || !detection.overspeed) return;
    const device = await Device.findById(detection.deviceId).select("name").lean();
    const facts: OverspeedFacts = {
      detectionId,
      scaledSpeedKmh: detection.scaledSpeedKmh,
      measuredSpeedKmh: detection.measuredSpeedKmh,
      limitKmh: detection.limitKmh,
      severity: detection.severity,
      direction: detection.direction,
      stationName: device?.name ?? "Unknown station",
      detectedAt: detection.detectedAt,
    };
    const sent = await sendOverspeedAlert(facts, jpeg);
    if (sent > 0) logger.info({ detectionId, kind, recipients: sent }, "whatsapp alert sent");
  })().catch((err: unknown) => {
    logger.warn(
      { detectionId, err: err instanceof Error ? err.message : String(err) },
      "whatsapp alert failed"
    );
  });
}
