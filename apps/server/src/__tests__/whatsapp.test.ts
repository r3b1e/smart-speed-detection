import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredUser, TestCtx } from "./helpers";
import {
  TINY_JPEG,
  api,
  clearDb,
  createDevice,
  createUserWithRole,
  setupCtx,
  teardownCtx,
} from "./helpers";
import { config } from "../config";
import {
  adminNumbers,
  overspeedCaption,
  resetWhatsAppDedupe,
  sendOverspeedAlert,
  setWhatsAppFetch,
  type OverspeedFacts,
} from "../services/whatsapp";

interface GraphCall {
  url: string;
  body: unknown;
}

/** Shape of the JSON message payloads asserted below. */
interface SentMessage {
  type: string;
  to: string;
  image: { id: string; caption: string };
  template: {
    name: string;
    components: [
      { parameters: [{ type: string; image: { id: string } }] },
      { parameters: { text: string }[] },
    ];
  };
}

/** Fake Graph API: records calls, answers media uploads with an id. */
function fakeGraph(fail: { messages?: { code: number; message: string } } = {}) {
  const calls: GraphCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body =
      init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body });
    if (url.endsWith("/media")) return Response.json({ id: "media-123" });
    if (fail.messages) return Response.json({ error: fail.messages }, { status: 400 });
    return Response.json({ messages: [{ id: "wamid.x" }] });
  });
  setWhatsAppFetch(fn as unknown as typeof fetch);
  return calls;
}

const saved = { ...config };
function enableWhatsApp(over: Partial<typeof config> = {}) {
  Object.assign(config, {
    WHATSAPP_ENABLED: true,
    WHATSAPP_ACCESS_TOKEN: "test-token",
    WHATSAPP_PHONE_NUMBER_ID: "1112223334",
    WHATSAPP_ADMIN_NUMBERS: "+91 98765-43210",
    WHATSAPP_TEMPLATE_NAME: "",
    ...over,
  });
}

const facts: OverspeedFacts = {
  detectionId: "6ae77d77fa469dd11b23776f",
  scaledSpeedKmh: 48,
  measuredSpeedKmh: 4.8,
  limitKmh: 40,
  severity: "medium",
  direction: "fwd",
  stationName: "Gate Station 01",
  detectedAt: new Date("2026-11-01T18:38:34Z"),
};

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterEach(() => {
  Object.assign(config, saved);
  setWhatsAppFetch(null);
  resetWhatsAppDedupe();
});

describe("whatsapp message building", () => {
  it("normalises admin numbers to international digits", () => {
    expect(adminNumbers("+91 98765-43210, 919812345678,  , 12")).toEqual([
      "919876543210",
      "919812345678",
    ]);
  });

  it("captions speed, limit, excess, station and local time", () => {
    const text = overspeedCaption(facts, true);
    expect(text).toContain("48.0 km/h");
    expect(text).toContain("limit 40 km/h, +20%");
    expect(text).toContain("Station: Gate Station 01");
    expect(text).toContain("IN → OUT");
    expect(text).toContain("2 Nov 2026"); // 18:38 UTC = 00:08 IST next day
    expect(text).toContain("Gate reading: 4.80 km/h");
    expect(text).not.toContain("could not be captured");
    expect(overspeedCaption(facts, false)).toContain("could not be captured");
  });
});

describe("sendOverspeedAlert", () => {
  it("uploads the photo once and sends it as an image with caption", async () => {
    enableWhatsApp({ WHATSAPP_ADMIN_NUMBERS: "919876543210,919812345678" });
    const calls = fakeGraph();
    const sent = await sendOverspeedAlert(facts, TINY_JPEG);
    expect(sent).toBe(2);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/1112223334/media");
    expect(calls).toHaveLength(3); // 1 upload + 2 messages, media id reused
    const msg = calls[1]!.body as SentMessage;
    expect(msg).toMatchObject({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "image",
      image: { id: "media-123" },
    });
    expect(msg.image.caption).toContain("Overspeed detected");
  });

  it("sends text only when there is no photo", async () => {
    enableWhatsApp();
    const calls = fakeGraph();
    await sendOverspeedAlert(facts, null);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ type: "text", to: "919876543210" });
  });

  it("uses the approved template (image header + 5 variables) when configured", async () => {
    enableWhatsApp({ WHATSAPP_TEMPLATE_NAME: "overspeed_alert" });
    const calls = fakeGraph();
    await sendOverspeedAlert(facts, TINY_JPEG);
    const msg = calls[1]!.body as SentMessage;
    expect(msg.type).toBe("template");
    expect(msg.template.name).toBe("overspeed_alert");
    expect(msg.template.components[0].parameters[0]).toEqual({
      type: "image",
      image: { id: "media-123" },
    });
    expect(msg.template.components[1].parameters.map((p) => p.text)).toEqual([
      "48.0",
      "40",
      "+20%",
      "Gate Station 01",
      expect.stringContaining("2026"),
    ]);
  });

  it("counts a rejected message as not delivered instead of throwing", async () => {
    enableWhatsApp();
    fakeGraph({ messages: { code: 131047, message: "Re-engagement message" } });
    await expect(sendOverspeedAlert(facts, TINY_JPEG)).resolves.toBe(0);
  });
});

describe("overspeed photo upload -> WhatsApp alert", () => {
  let ctx: TestCtx;
  let admin: RegisteredUser;
  let apiKey: string;
  let visionSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    ctx = await setupCtx();
  });
  afterAll(async () => {
    await teardownCtx(ctx);
  });
  beforeEach(async () => {
    await clearDb();
    admin = await createUserWithRole(ctx.app, "admin");
    apiKey = (await createDevice(ctx.app, admin.accessToken, "Alert Gate")).apiKey;
    // the vision /capture call goes through global fetch; keep it offline
    visionSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "ok" }));
  });
  afterEach(() => visionSpy.mockRestore());

  const ingest = (speed: number, seq: number) =>
    api(ctx.app)
      .post("/api/ingest/detections")
      .set("x-device-key", apiKey)
      .send({
        seq,
        bootId: "77",
        dtMicros: 8500,
        measuredSpeedKmh: speed,
        deviceOver: speed > 40,
        direction: "fwd",
        deviceLimitKmh: 40,
        receivedAt: new Date().toISOString(),
        source: "arduino",
      });

  const uploadFrame = (id: string) =>
    api(ctx.app)
      .post(`/api/ingest/detections/${id}/frame`)
      .set("x-vision-secret", config.VISION_SHARED_SECRET)
      .attach("frame", TINY_JPEG, { contentType: "image/jpeg", filename: "frame.jpg" });

  it("sends the stored photo to the admin exactly once", async () => {
    enableWhatsApp();
    const calls = fakeGraph();
    const res = await ingest(52.5, 1);
    expect((await uploadFrame(res.body.id)).status).toBe(201);
    await until(() => calls.length >= 2, "media upload + message");

    const media = calls[0]!.body as FormData;
    expect(media.get("messaging_product")).toBe("whatsapp");
    expect((media.get("file") as Blob).size).toBe(TINY_JPEG.length);
    const msg = calls[1]!.body as SentMessage;
    expect(msg.image.caption).toContain("52.5 km/h");
    expect(msg.image.caption).toContain("Alert Gate");

    await uploadFrame(res.body.id); // a retry must not alert twice
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toHaveLength(2);
  });

  it("stays silent when WhatsApp is not configured", async () => {
    const calls = fakeGraph();
    const res = await ingest(52.5, 2);
    await uploadFrame(res.body.id);
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toHaveLength(0);
  });
});
