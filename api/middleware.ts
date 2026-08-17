import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

/**
 * r15-access: only deliberate, non-Error causes (e.g. `{ shareToken }` on
 * the trips.get 403) may be serialized into `error.data.cause`. Error
 * instances (DB/driver failures wrapped into INTERNAL_SERVER_ERROR) are
 * NEVER exposed - they'd leak internals.
 */
export function safeErrorCause(cause: unknown): unknown {
  if (cause == null) return undefined;
  if (cause instanceof Error) {
    // tRPC wraps deliberate NON-Error causes (our `{ shareToken }` payload)
    // in an internal UnknownCauseError via Object.assign - recover the
    // payload from its own enumerable props. Genuine failure causes
    // (DB/driver errors wrapped into INTERNAL_SERVER_ERROR) stay hidden.
    if (cause.constructor?.name === "UnknownCauseError") {
      return { ...cause };
    }
    return undefined;
  }
  return cause;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        cause: safeErrorCause(error.cause),
      },
    };
  },
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/**
 * r24-smart: canonical server-side premium gate. Voyager-only procedures use
 * `premiumQuery`; feature code that needs a soft check uses `isPremium(ctx)`.
 */
const requirePremium = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }
  const { getTier } = await import("./queries/subscriptions");
  const tier = await getTier(ctx.user.id);
  if (tier !== "voyager") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "UPGRADE_REQUIRED",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user, tier } });
});

/** Soft premium check for procedures that branch instead of blocking. */
export async function isPremium(ctx: TrpcContext): Promise<boolean> {
  if (!ctx.user) return false;
  const { getTier } = await import("./queries/subscriptions");
  return (await getTier(ctx.user.id)) === "voyager";
}

export const authedQuery = t.procedure.use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));
export const premiumQuery = t.procedure.use(requirePremium);
