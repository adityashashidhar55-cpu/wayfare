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
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { verifyWebhookSignature } from "./lib/razorpay";
import { injectOg, tripCard } from "./lib/og";
import { activateVoyager, markPaymentFailed } from "./lib/entitlement";

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
/**
 * r27: Razorpay payment webhook - the AUTHORITATIVE activation path.
 *
 * The client `billing.confirm` handoff only fires if the browser survives the
 * redirect back from the payment page. Plenty of real payments finish after
 * the user has closed the tab, switched to their UPI app and never come back;
 * without this endpoint those customers pay and get nothing.
 *
 * The signature is HMAC-SHA256 over the RAW body with RAZORPAY_WEBHOOK_SECRET
 * (a different secret from the API key). We must read the body as text and
 * verify BEFORE parsing - re-serialising parsed JSON changes the bytes and the
 * HMAC would never match.
 */
app.post("/api/webhooks/razorpay", async (c) => {
  const signature = c.req.header("x-razorpay-signature") ?? "";
  const raw = await c.req.text();
  if (!verifyWebhookSignature(raw, signature)) {
    // 400, not 401: Razorpay retries on 5xx, and a bad signature will never
    // become good on retry.
    return c.json({ error: "invalid signature" }, 400);
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(raw) as RazorpayWebhookPayload;
  } catch {
    return c.json({ error: "invalid payload" }, 400);
  }

  const entity = payload.payload?.payment?.entity;
  const orderId = entity?.order_id;
  if (!orderId) return c.json({ ok: true, ignored: payload.event ?? "unknown" });

  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId))
      .limit(1);
    if (!row) return c.json({ ok: true, ignored: "unknown order" });

    if (payload.event === "payment.captured" || entity?.status === "captured") {
      await activateVoyager({
        userId: row.userId,
        orderId,
        paymentId: entity?.id ?? "",
        interval: row.interval,
        source: "webhook",
        raw: entity,
      });
    } else if (payload.event === "payment.failed") {
      await markPaymentFailed(orderId, entity);
    }
    return c.json({ ok: true });
  } catch (e) {
    console.error("razorpay webhook", e);
    // 500 so Razorpay retries - a transient DB blip must not lose a payment.
    return c.json({ error: "processing failed" }, 500);
  }
});

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; status?: string };
    };
  };
}

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



/**
 * r29: SERVER-RENDERED SOCIAL PREVIEW CARDS.
 *
 * Wayfare is a Vite SPA and social crawlers do not run JavaScript, so every
 * shared itinerary previewed as the one static card in index.html: the brand
 * banner, no trip name, no destination, no dates. Sharing a trip into a group
 * chat looked like posting an ad for the app rather than inviting people to
 * your trip, which quietly broke the whole share-to-join loop.
 *
 * These routes serve the SAME SPA shell with the <head> rewritten from real
 * trip data. Humans get the identical app; crawlers get the truth. Not SSR -
 * nothing else about the page is rendered here.
 *
 * PRODUCTION ONLY, and registered before serveStaticFiles so they win over the
 * static/notFound handlers. In dev there is no dist/ to read, and returning a
 * 404 here would break /shared/:token locally - Vite's own middleware serves
 * index.html there and must be left alone.
 *
 * Every handler falls through to the plain shell on any error: a broken
 * preview card must never take down the page itself.
 */
function registerSocialPreviewRoutes(): void {
  async function readShell(): Promise<string | null> {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const p = path.resolve(import.meta.dirname, "../dist/public/index.html");
      return await fs.readFile(p, "utf-8");
    } catch {
      return null;
    }
  }

  app.get("/shared/:token", async (c) => {
    const shell = await readShell();
    if (!shell) return c.notFound();
    const origin = new URL(c.req.url).origin;
    try {
      const token = c.req.param("token");
      const db = getDb();
      const [trip] = await db
        .select({
          title: schema.trips.title, destination: schema.trips.destination,
          startDate: schema.trips.startDate, endDate: schema.trips.endDate,
          coverImage: schema.trips.coverImage, id: schema.trips.id,
        })
        .from(schema.trips)
        .where(eq(schema.trips.shareToken, token))
        .limit(1);
      if (!trip) return c.html(shell);

      const [counts] = await db
        .select({
          stops: sql<number>`(SELECT COUNT(*) FROM stops WHERE stops.tripId = ${trip.id})`,
          members: sql<number>`(SELECT COUNT(*) FROM trip_members WHERE trip_members.tripId = ${trip.id})`,
          days: sql<number>`(SELECT COUNT(*) FROM trip_days WHERE trip_days.tripId = ${trip.id})`,
        })
        .from(schema.trips)
        .where(eq(schema.trips.id, trip.id))
        .limit(1);

      const card = tripCard({
        title: trip.title, destination: trip.destination,
        startDate: trip.startDate, endDate: trip.endDate, coverImage: trip.coverImage,
        stopCount: Number(counts?.stops ?? 0), memberCount: Number(counts?.members ?? 0),
        dayCount: Number(counts?.days ?? 0),
        url: `${origin}/shared/${token}`,
      });
      return c.html(injectOg(shell, card, origin));
    } catch (e) {
      console.warn("og /shared failed", e);
      return c.html(shell);
    }
  });

  app.get("/p/:slug", async (c) => {
    const shell = await readShell();
    if (!shell) return c.notFound();
    const origin = new URL(c.req.url).origin;
    try {
      const slug = c.req.param("slug");
      const db = getDb();
      const [pub] = await db
        .select({
          title: schema.publishedTrips.title, summary: schema.publishedTrips.summary,
          isOpen: schema.publishedTrips.isOpen, tripId: schema.publishedTrips.tripId,
        })
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.slug, slug))
        .limit(1);
      if (!pub) return c.html(shell);

      const [trip] = await db
        .select({
          destination: schema.trips.destination, startDate: schema.trips.startDate,
          endDate: schema.trips.endDate, coverImage: schema.trips.coverImage,
        })
        .from(schema.trips)
        .where(eq(schema.trips.id, pub.tripId))
        .limit(1);

      const [counts] = await db
        .select({
          stops: sql<number>`(SELECT COUNT(*) FROM stops WHERE stops.tripId = ${pub.tripId})`,
          members: sql<number>`(SELECT COUNT(*) FROM trip_members WHERE trip_members.tripId = ${pub.tripId})`,
          days: sql<number>`(SELECT COUNT(*) FROM trip_days WHERE trip_days.tripId = ${pub.tripId})`,
        })
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.tripId, pub.tripId))
        .limit(1);

      const card = tripCard({
        title: pub.title, destination: trip?.destination ?? null,
        startDate: trip?.startDate ?? null, endDate: trip?.endDate ?? null,
        coverImage: trip?.coverImage ?? null,
        stopCount: Number(counts?.stops ?? 0), memberCount: Number(counts?.members ?? 0),
        dayCount: Number(counts?.days ?? 0),
        url: `${origin}/p/${slug}`, joinable: pub.isOpen,
      });
      // A published summary is the owner's own words - prefer it.
      if (pub.summary) card.description = pub.summary.slice(0, 200);
      return c.html(injectOg(shell, card, origin));
    } catch (e) {
      console.warn("og /p failed", e);
      return c.html(shell);
    }
  });

  /** Let crawlers in, and point them at the published trips that want traffic. */
  app.get("/robots.txt", (c) =>
    c.text(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /trips/\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`),
  );

  app.get("/sitemap.xml", async (c) => {
    const origin = new URL(c.req.url).origin;
    try {
      const rows = await getDb()
        .select({ slug: schema.publishedTrips.slug, at: schema.publishedTrips.createdAt })
        .from(schema.publishedTrips)
        .where(eq(schema.publishedTrips.isOpen, true))
        .limit(5000);
      const urls = [
        `<url><loc>${origin}/</loc><priority>1.0</priority></url>`,
        `<url><loc>${origin}/explore</loc><priority>0.8</priority></url>`,
        `<url><loc>${origin}/pricing</loc><priority>0.5</priority></url>`,
        ...rows.map((r) => `<url><loc>${origin}/p/${r.slug}</loc><lastmod>${r.at.toISOString().slice(0, 10)}</lastmod><priority>0.6</priority></url>`),
      ];
      return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
        200, { "content-type": "application/xml" });
    } catch {
      return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`,
        200, { "content-type": "application/xml" });
    }
  });
}

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  // Order matters: our per-trip <head> rewrite must be registered before the
  // catch-all static handler, or the generic shell wins.
  registerSocialPreviewRoutes();
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
