/**
 * Meta WhatsApp Cloud API webhook ("Callback URL" in the Meta dashboard).
 *
 *   GET  /api/webhooks/whatsapp  — Meta's one-time verification handshake:
 *        echoes hub.challenge when hub.verify_token == WHATSAPP_VERIFY_TOKEN.
 *   POST /api/webhooks/whatsapp  — event notifications. Each body is signed
 *        (X-Hub-Signature-256 = HMAC-SHA256 of the raw body with the app
 *        secret); unsigned/forged requests are rejected when
 *        WHATSAPP_APP_SECRET is set.
 *
 * We log delivery statuses of our overspeed alerts (sent / delivered / read /
 * failed, with Meta's error reason) and incoming messages from admins — an
 * incoming message also (re)opens WhatsApp's 24 h window for plain alerts.
 * Mounted before express.json() because the signature needs the raw bytes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { config } from "../config";
import { logger } from "../logger";

interface StatusEvent {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}
interface MessageEvent {
  from?: string;
  type?: string;
  text?: { body?: string };
}
interface WebhookBody {
  object?: string;
  entry?: {
    changes?: { field?: string; value?: { statuses?: StatusEvent[]; messages?: MessageEvent[] } }[];
  }[];
}

const last4 = (n?: string) => (n ? `…${n.slice(-4)}` : undefined);

export function validSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
    "utf8"
  );
  const given = Buffer.from(header, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function logEvents(body: WebhookBody): void {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const err = s.errors?.[0];
        const fields = {
          status: s.status,
          to: last4(s.recipient_id),
          messageId: s.id,
          code: err?.code,
          reason: err?.message ?? err?.title,
        };
        if (s.status === "failed") logger.warn(fields, "whatsapp alert failed to deliver");
        else logger.info(fields, `whatsapp alert ${s.status ?? "status"}`);
      }
      for (const m of change.value?.messages ?? []) {
        logger.info(
          { from: last4(m.from), type: m.type, text: m.text?.body?.slice(0, 80) },
          "whatsapp message received (24 h alert window open)"
        );
      }
    }
  }
}

export const whatsappWebhookRouter = Router();

whatsappWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (
    mode === "subscribe" &&
    config.WHATSAPP_VERIFY_TOKEN &&
    token === config.WHATSAPP_VERIFY_TOKEN &&
    typeof challenge === "string"
  ) {
    logger.info("whatsapp webhook verified by Meta");
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  logger.warn({ mode }, "whatsapp webhook verification rejected (verify token mismatch)");
  res.sendStatus(403);
});

whatsappWebhookRouter.post("/", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (config.WHATSAPP_APP_SECRET) {
    if (!validSignature(raw, req.get("x-hub-signature-256"), config.WHATSAPP_APP_SECRET)) {
      logger.warn("whatsapp webhook: bad or missing signature, ignored");
      res.sendStatus(401);
      return;
    }
  }
  // acknowledge immediately — Meta retries slow/failed deliveries
  res.sendStatus(200);
  try {
    logEvents(JSON.parse(raw.toString("utf8")) as WebhookBody);
  } catch {
    logger.warn("whatsapp webhook: body was not JSON");
  }
});
