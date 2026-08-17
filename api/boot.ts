import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import {
  providerAvailability,
  googleStart,
  googleCallback,
  appleStart,
  appleCallback,
} from "./oauth-providers";
import { Paths } from "@contracts/constants";
import { handleInboundEmail } from "./bookings-router";
import { getPlaceNarration, NarrationError } from "./lib/narration";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
// r22-speed: gzip the tRPC JSON (the explore feed is ~450KB identity) so
// browsers download ~5x less. Scoped to /api/trpc - binary endpoints
// (narration MP3) and statics keep their own encoding.
app.use("/api/trpc/*", compress());
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.get("/api/oauth/providers", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(providerAvailability(origin));
});
app.get("/api/config/public", (c) =>
  c.json({ googleMapsKey: env.googleMapsKey || null }),
);
// Liveness/readiness probe. Orchestrators (Docker HEALTHCHECK, k8s, Fly,
// Railway, Render) need a cheap unauthenticated endpoint to tell "process is
// up" from "process is wedged"; there was none before.
app.get("/healthz", (c) => c.json({ ok: true, uptime: Math.round(process.uptime()) }));
app.get("/api/oauth/google/start", googleStart);
app.get("/api/oauth/google/callback", googleCallback);
app.get("/api/oauth/apple/start", appleStart);
app.post("/api/oauth/apple/callback", appleCallback);
// Inbound booking-email webhook (r9-bookings): SendGrid Inbound Parse /
// Mailgun Routes compatible - point the in.wayfare.app MX here and forwarded
// confirmations land on the token owner's active trip as reservations + stops.
app.post("/api/inbound/:token", async c => {
  let payload: {
    text?: string;
    html?: string;
    subject?: string;
    from?: string;
  } = {};
  try {
    if ((c.req.header("content-type") ?? "").includes("application/json")) {
      payload = await c.req.json();
    } else {
      // multipart/form-data (SendGrid) or urlencoded (Mailgun)
      const form = await c.req.parseBody();
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      payload = {
        text: str(form.text),
        html: str(form.html),
        subject: str(form.subject),
        from: str(form.from),
      };
    }
  } catch {
    return c.json({ error: "unparseable body" }, 400);
  }
  const { status, body } = await handleInboundEmail(
    c.req.param("token"),
    payload
  );
  return c.json(body, status);
});
// r21-detail: server-generated place narration (MP3 via open-source
// msedge-tts, cached in api_cache). The browser SpeechSynthesis path in
// src/lib/narrate.ts stays as the client-side fallback.
app.get("/api/narration/:placeId", async (c) => {
  const placeId = Number(c.req.param("placeId"));
  if (!Number.isInteger(placeId) || placeId <= 0) {
    return c.json({ error: "Invalid place id" }, 400);
  }
  try {
    const audio = await getPlaceNarration(placeId);
    return new Response(new Uint8Array(audio.bytes), {
      status: 200,
      headers: {
        "Content-Type": audio.mime,
        "Content-Length": String(audio.bytes.length),
        "Cache-Control": "public, max-age=86400",
        "X-Narration-Voice": audio.voice,
        "X-Narration-Cache": audio.cached ? "hit" : "miss",
      },
    });
  } catch (err) {
    if (err instanceof NarrationError) {
      const status =
        err.code === "not_found" ? 404 : err.code === "no_description" ? 400 : 503;
      return c.json({ error: err.message }, status);
    }
    console.error("narration endpoint failed:", err);
    return c.json({ error: "Audio narration is temporarily unavailable" }, 503);
  }
});
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Graceful shutdown. Without this, every deploy killed in-flight requests
  // and dropped the DB pool mid-query.
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[boot] ${signal} received, draining...`);
      server.close(() => {
        console.log("[boot] closed cleanly");
        process.exit(0);
      });
      // Don't hang forever if a request never finishes.
      setTimeout(() => {
        console.warn("[boot] drain timed out, forcing exit");
        process.exit(0);
      }, 10_000).unref();
    });
  }

  // Surface crashes instead of dying silently with no stack in the logs.
  process.on("unhandledRejection", (reason) => {
    console.error("[boot] unhandledRejection:", reason);
  });

  // r22-speed: pre-warm the default explore feed (and keep active feeds
  // warm) so users rarely hit a cold scored-feed fill. Non-blocking.
  const { prewarmExploreFeeds } = await import("./lib/explore-feed");
  prewarmExploreFeeds();

  // r24-smart: 6h weather-threshold + wishlist-highlight checks (unref'd).
  const { startSmartChecks } = await import("./lib/smart-cron");
  startSmartChecks();
}
