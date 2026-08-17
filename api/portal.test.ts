import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./context";
import { portalRouter, resetPortalRateLimits } from "./portal-router";

/**
 * r17-portal unit tests - everything that does NOT touch the DB:
 * the three-factor login gate (wrong path → NOT_FOUND, wrong creds →
 * UNAUTHORIZED, 5 failures → 15-min lockout), the wf_portal cookie guard,
 * and the "no nav links to the portal" invariant. DB-level flows
 * (images.set/remove, dishes.update, stats) live in scripts/verify-portal.mts.
 */

const PATH_SECRET = "test-path-secret-aaa";
const PORTAL_ID = "test-owner-id";
const PASSWORD = "test-password-123";
const SESSION_SECRET = "test-session-secret-at-least-32-chars!!";

beforeAll(() => {
  process.env.PORTAL_PATH_SECRET = PATH_SECRET;
  process.env.PORTAL_ID = PORTAL_ID;
  process.env.PORTAL_PASSWORD = PASSWORD;
  process.env.PORTAL_SESSION_SECRET = SESSION_SECRET;
});

beforeEach(() => resetPortalRateLimits());

const ctxFor = (headers: Record<string, string> = {}): TrpcContext => ({
  req: new Request("http://localhost/api/trpc", { headers }),
  resHeaders: new Headers(),
});

const ipCtx = (ip: string) => ctxFor({ "x-forwarded-for": ip });

const good = { pathSecret: PATH_SECRET, portalId: PORTAL_ID, password: PASSWORD };

describe("portal.login, path secret gate", () => {
  it("wrong pathSecret → generic NOT_FOUND (portal existence not revealed)", async () => {
    const caller = portalRouter.createCaller(ipCtx("10.0.0.1"));
    await expect(caller.login({ ...good, pathSecret: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Not found",
    });
  });

  it("empty pathSecret env fails closed (NOT_FOUND even for the 'right' guess)", async () => {
    const saved = process.env.PORTAL_PATH_SECRET;
    process.env.PORTAL_PATH_SECRET = "";
    try {
      const caller = portalRouter.createCaller(ipCtx("10.0.0.2"));
      await expect(caller.login(good)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      process.env.PORTAL_PATH_SECRET = saved;
    }
  });
});

describe("portal.checkPath, render gate", () => {
  it("wrong pathSecret → NOT_FOUND (page renders plain 404)", async () => {
    const caller = portalRouter.createCaller(ipCtx("10.1.0.1"));
    await expect(caller.checkPath({ pathSecret: "wrong-path-12345" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Not found",
    });
  });

  it("right pathSecret → ok", async () => {
    const caller = portalRouter.createCaller(ipCtx("10.1.0.2"));
    await expect(caller.checkPath({ pathSecret: PATH_SECRET })).resolves.toEqual({ ok: true });
  });

  it("empty pathSecret env fails closed", async () => {
    const saved = process.env.PORTAL_PATH_SECRET;
    process.env.PORTAL_PATH_SECRET = "";
    try {
      const caller = portalRouter.createCaller(ipCtx("10.1.0.3"));
      await expect(caller.checkPath({ pathSecret: PATH_SECRET })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      process.env.PORTAL_PATH_SECRET = saved;
    }
  });

  it("repeated wrong guesses do NOT consume login attempts (no lockout side effects)", async () => {
    const caller = portalRouter.createCaller(ipCtx("10.1.0.4"));
    for (let i = 0; i < 6; i++) {
      await expect(caller.checkPath({ pathSecret: "nope" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    // login still allowed - first failure count is 1, not 7
    await expect(caller.login({ ...good, password: "wrong" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      cause: { attemptsLeft: 4 },
    });
  });
});

describe("portal.login, credentials + rate limit", () => {
  it("wrong portalId or password → generic UNAUTHORIZED 'Invalid credentials'", async () => {
    const caller = portalRouter.createCaller(ipCtx("10.0.1.1"));
    await expect(caller.login({ ...good, portalId: "wrong" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid credentials",
    });
    await expect(caller.login({ ...good, password: "wrong" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid credentials",
    });
  });

  it("5 failures → 15-minute lockout, even for correct credentials", async () => {
    const caller = portalRouter.createCaller(ipCtx("10.0.2.1"));
    for (let i = 0; i < 5; i++) {
      await expect(caller.login({ ...good, password: `bad-${i}` })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }
    // 6th attempt: locked - message changes, and even the right password is refused.
    await expect(caller.login({ ...good, password: "bad-5" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Too many attempts, try again later",
    });
    await expect(caller.login(good)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Too many attempts, try again later",
    });
  });

  it("lockout is keyed on ip+pathSecret (another IP still works)", async () => {
    const locked = portalRouter.createCaller(ipCtx("10.0.3.1"));
    for (let i = 0; i < 5; i++) {
      await locked.login({ ...good, password: `bad-${i}` }).catch(() => {});
    }
    const other = portalRouter.createCaller(ipCtx("10.0.3.2"));
    const res = await other.login(good);
    expect(res.ok).toBe(true);
    expect(res.token.length).toBeGreaterThan(20);
  });

  it("success sets the httpOnly SameSite=Lax wf_portal cookie and returns the token", async () => {
    const ctx = ipCtx("10.0.4.1");
    const caller = portalRouter.createCaller(ctx);
    const res = await caller.login(good);
    expect(res.ok).toBe(true);
    const setCookie = ctx.resHeaders.get("set-cookie") ?? "";
    expect(setCookie).toContain("wf_portal=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toMatch(/samesite=lax/i);
    expect(setCookie).toContain(`wf_portal=${res.token}`);
  });

  it("missing session secret fails closed even with correct credentials", async () => {
    const saved = process.env.PORTAL_SESSION_SECRET;
    process.env.PORTAL_SESSION_SECRET = "";
    try {
      const caller = portalRouter.createCaller(ipCtx("10.0.5.1"));
      await expect(caller.login(good)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      process.env.PORTAL_SESSION_SECRET = saved;
    }
  });
});

describe("portalProcedure, cookie guard", () => {
  it("rejects requests without the wf_portal cookie (FORBIDDEN)", async () => {
    const caller = portalRouter.createCaller(ctxFor());
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.places.search({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.images.remove({ placeId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.dishes.cities()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a forged cookie signed with the wrong secret", async () => {
    const caller = portalRouter.createCaller(ctxFor({ cookie: "wf_portal=forged.token.here" }));
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("portal.session reports the cookie state without throwing", async () => {
    const anon = portalRouter.createCaller(ctxFor());
    await expect(anon.session()).resolves.toEqual({ ok: false });

    const loginCtx = ipCtx("10.0.6.1");
    const { token } = await portalRouter.createCaller(loginCtx).login(good);
    const authed = portalRouter.createCaller(ctxFor({ cookie: `wf_portal=${token}` }));
    await expect(authed.session()).resolves.toEqual({ ok: true });
  });

  it("logout clears the cookie (maxAge=0)", async () => {
    const ctx = ctxFor();
    await portalRouter.createCaller(ctx).logout();
    const setCookie = ctx.resHeaders.get("set-cookie") ?? "";
    expect(setCookie).toContain("wf_portal=");
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires/);
  });
});

describe("portal route stays unlinked", () => {
  it("no nav/shell/layout/footer component references /portal", () => {
    const roots = ["src/components", "src/pages"];
    const offenders: string[] = [];
    const scan = (file: string) => {
      const text = readFileSync(file, "utf8");
      // OwnerPortal itself + App.tsx may mention the route; nothing else may.
      if (/["'`]\/portal/.test(text) && !/OwnerPortal\.tsx$|App\.tsx$/.test(file)) {
        offenders.push(file);
      }
    };
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) scan(full);
      }
    };
    for (const root of roots) walk(path.resolve(import.meta.dirname, "..", root));
    expect(offenders).toEqual([]);
  });
});
