#!/usr/bin/env node
/**
 * Public gateway for the WhatsApp webhook ONLY.
 *
 * Meta needs a public HTTPS "Callback URL", but the server also serves the
 * login page, dashboard API and photos. Tunnelling port 4000 directly would
 * expose all of that, so this tiny proxy listens on :4100, forwards only
 * /api/webhooks/whatsapp to the server, and answers 404 to everything else.
 *
 *   pnpm webhook:gateway     # this proxy on 127.0.0.1:4100
 *   pnpm webhook:tunnel      # cloudflared quick tunnel -> https://<random>.trycloudflare.com
 *
 * Callback URL for Meta = <tunnel URL>/api/webhooks/whatsapp
 */
import http from "node:http";

const PORT = Number(process.env.WEBHOOK_GATEWAY_PORT ?? 4100);
const TARGET_PORT = Number(process.env.SERVER_PORT ?? 4000);
const ALLOWED = "/api/webhooks/whatsapp";

const server = http.createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (path !== ALLOWED || (req.method !== "GET" && req.method !== "POST")) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${TARGET_PORT}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("server unavailable");
  });
  req.pipe(upstream);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[webhook-gateway] http://127.0.0.1:${PORT}${ALLOWED} -> :${TARGET_PORT} (all other paths 404)`
  );
});
