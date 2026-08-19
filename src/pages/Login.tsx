import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { motion } from "framer-motion";
import { ArrowLeft, Chrome, Apple as AppleIcon, Sparkles, Loader2, Mail } from "lucide-react";
import Logo from "@/components/Logo";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { safeNextPath } from "@/lib/safe-next";
import { apiBase } from "@/lib/apiBase";
import { captureReferralParam } from "@/lib/referral";

/** Which social OAuth providers the backend has credentials for. */
type ProviderAvailability = { google: boolean; apple: boolean; kimi?: boolean };

// ── OAuth entry (backend graft contract - do not alter) ─────────────────────
function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}
// ─────────────────────────────────────────────────────────────────────────────

function ProviderButton({
  icon,
  label,
  onClick,
  disabled,
  soon,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  soon?: boolean;
  /** Server-managed OAuth start URL - renders the button as a plain link. */
  href?: string;
}) {
  const className =
    "type-small relative flex h-11 w-full items-center justify-center gap-2.5 rounded-md border border-border-strong bg-surface font-medium text-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-surface-2 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-sm";
  const inner = (
    <>
      {icon}
      <span>{label}</span>
      {soon && (
        <span className="type-caption absolute right-3 rounded-pill bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-ink-3">
          Soon
        </span>
      )}
    </>
  );
  if (href) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {inner}
    </button>
  );
}

/** Resolve ?next= against the real origin. See src/lib/safe-next.ts. */
function safeNext(): string {
  return safeNextPath(
    new URLSearchParams(window.location.search).get("next"),
    window.location.origin,
  );
}

export default function Login() {
  const { isAuthenticated, isLoading } = useAuth();
  const [guestError, setGuestError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderAvailability | null>(null);
  const [credEmail, setCredEmail] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credName, setCredName] = useState("");
  const [credError, setCredError] = useState<string | null>(null);
  /* r26: this form was sign-in only, because no sign-up existed on the
     server at all. Now it toggles, and defaults to Create account - a new
     visitor has nothing to sign in to. */
  const [credMode, setCredMode] = useState<"signup" | "signin">("signup");
  const guestLogin = trpc.auth.guestLogin.useMutation({
    onSuccess: () => {
      window.location.href = "/trips";
    },
    onError: (e) => setGuestError(e.message || "Could not start the demo. Try again."),
  });
  const passwordLogin = trpc.auth.loginWithPassword.useMutation({
    onSuccess: () => {
      // r24-social: /login?next=/p/<slug> returns the visitor to the page
      // they came from (published-trip join flow); same-origin paths only.
      window.location.href = safeNext();
    },
    onError: (e) => setCredError(e.message || "Could not sign in. Try again."),
  });
  /* Creating an account while signed in as a guest UPGRADES that guest row,
     so trips built in the demo carry over instead of being orphaned. */
  const register = trpc.auth.register.useMutation({
    onSuccess: () => {
      window.location.href = safeNext();
    },
    onError: (e) => setCredError(e.message || "Could not create the account. Try again."),
  });
  const credBusy = passwordLogin.isPending || register.isPending;

  /* Referral: stash /login?ref=<code> so it survives the OAuth round trip
     and can be claimed by useAuth once the new account is signed in. */
  useEffect(() => {
    captureReferralParam();
  }, []);

  /* Google/Apple buttons light up only when the backend has credentials -
     until the check resolves, they stay disabled with the "Soon" chip. */
  useEffect(() => {
    let alive = true;
    fetch(`${apiBase()}/api/oauth/providers`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Partial<ProviderAvailability> | null) => {
        if (alive && data && typeof data.google === "boolean" && typeof data.apple === "boolean") {
          // `kimi` must be carried through, or the Kimi button below (which
          // gates on providers?.kimi) can never render on any deployment.
          setProviders({ google: data.google, apple: data.apple, kimi: data.kimi === true });
        }
      })
      .catch(() => {
        // providers stay disabled, the demo and Kimi sign-in still work
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!isLoading && isAuthenticated) return <Navigate to="/trips" replace />;

  return (
    <div className="grid min-h-[100dvh] bg-bg lg:grid-cols-[1.05fr_1fr]">
      {/* ---------- Form side ---------- */}
      <div className="relative flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="Back to home">
            <Logo />
          </Link>
          <Link
            to="/"
            className="type-small inline-flex items-center gap-1.5 text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            Home
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12"
        >
          <p className="type-eyebrow text-brand">Welcome</p>
          <h1 className="type-display mt-3 font-serif text-ink">
            Your next trip starts{" "}
            <em className="serif-em">here</em>
          </h1>
          <p className="type-body mt-4 text-ink-2">
            Sign in to plan itineraries, split expenses, and explore places tuned to your taste.
          </p>

          {/* Guest / demo, always works, no account needed */}
          <button
            type="button"
            onClick={() => guestLogin.mutate()}
            disabled={guestLogin.isPending}
            className="btn-sheen type-small mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-brand font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.98] disabled:opacity-70"
          >
            {guestLogin.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            )}
            {guestLogin.isPending ? "Preparing your demo…" : "Try the demo, no account needed"}
          </button>
          <p className="type-caption mt-2.5 text-center text-ink-3">
            A fresh, empty atlas every time, yours to fill. Sign in afterwards to keep it.
          </p>
          {guestError && (
            <p className="type-small mt-3 rounded-md bg-ochre-soft px-3 py-2 text-center text-ink">
              {guestError}
            </p>
          )}

          <div className="my-7 flex items-center gap-4">
            <span className="h-px flex-1 bg-border" />
            <span className="type-caption uppercase tracking-[0.12em] text-ink-3">or continue with</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-3">
            {/* Only rendered when the backend reports Kimi OAuth is configured.
                Previously this was unconditional, so a non-Kimi deployment
                showed a button that built a garbage redirect URL. */}
            {providers?.kimi && (
              <ProviderButton
                icon={
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand font-serif text-[11px] font-semibold text-brand-ink">
                    K
                  </span>
                }
                label="Continue with Kimi"
                onClick={() => {
                  window.location.href = getOAuthUrl();
                }}
              />
            )}
            <ProviderButton
              icon={<Chrome className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} />}
              label="Continue with Google"
              href={providers?.google ? `${apiBase()}/api/oauth/google/start` : undefined}
              disabled={!providers?.google}
              soon={!providers?.google}
            />
            <ProviderButton
              icon={<AppleIcon className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} />}
              label="Continue with Apple"
              href={providers?.apple ? `${apiBase()}/api/oauth/apple/start` : undefined}
              disabled={!providers?.apple}
              soon={!providers?.apple}
            />
          </div>

          {/* Email account. r26: was sign-in only against a hand-seeded admin
              row; there is now a real register mutation behind this. */}
          <div className="my-7 flex items-center gap-4">
            <span className="h-px flex-1 bg-border" />
            <span className="type-caption uppercase tracking-[0.12em] text-ink-3">
              {credMode === "signup" ? "or create an account" : "or sign in with email"}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            className="rounded-lg border border-border bg-surface p-4"
            onSubmit={(e) => {
              e.preventDefault();
              setCredError(null);
              if (credMode === "signup") {
                register.mutate({
                  email: credEmail,
                  password: credPassword,
                  name: credName.trim() || undefined,
                });
              } else {
                passwordLogin.mutate({ email: credEmail, password: credPassword });
              }
            }}
          >
            <div className="space-y-2.5">
              {credMode === "signup" && (
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Your name (optional)"
                  aria-label="Your name"
                  value={credName}
                  onChange={(e) => setCredName(e.target.value)}
                  className="type-small h-10 w-full rounded-md border border-border bg-bg px-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
                />
              )}
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="Email"
                aria-label="Email"
                value={credEmail}
                onChange={(e) => setCredEmail(e.target.value)}
                className="type-small h-10 w-full rounded-md border border-border bg-bg px-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
              />
              <input
                type="password"
                required
                minLength={credMode === "signup" ? 10 : 1}
                autoComplete={credMode === "signup" ? "new-password" : "current-password"}
                placeholder={credMode === "signup" ? "Password (at least 10 characters)" : "Password"}
                aria-label="Password"
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
                className="type-small h-10 w-full rounded-md border border-border bg-bg px-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={credBusy}
              className="type-small mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-surface-2 font-medium text-ink transition-all duration-fast hover:bg-surface active:scale-[0.98] disabled:opacity-60"
            >
              {credBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Mail className="h-4 w-4" strokeWidth={1.75} />
              )}
              {credBusy
                ? credMode === "signup"
                  ? "Creating account…"
                  : "Signing in…"
                : credMode === "signup"
                  ? "Create account"
                  : "Sign in with email"}
            </button>
            {credError && (
              <p className="type-caption mt-2.5 rounded-md bg-ochre-soft px-3 py-2 text-center text-ink">
                {credError}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setCredMode(credMode === "signup" ? "signin" : "signup");
                setCredError(null);
              }}
              className="type-caption mt-3 w-full text-center text-ink-3 transition-colors hover:text-ink"
            >
              {credMode === "signup"
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </form>

          <p className="type-caption mt-8 text-center leading-relaxed text-ink-3">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </motion.div>
      </div>

      {/* ---------- Editorial photo side ---------- */}
      <div className="relative hidden overflow-hidden lg:block">
        <img
          src="/auth-side.jpg"
          alt="A paper map, camera, and passport laid out for trip planning"
          className="photo absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <motion.blockquote
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-10 bottom-12"
        >
          <p className="font-serif text-[26px] font-medium leading-snug tracking-[-0.01em] text-white">
            "I planned 10 days in Japan in one evening. My friends think I hired a travel agent."
          </p>
          <footer className="type-small mt-4 text-white/75">Maya R. · Kyoto</footer>
        </motion.blockquote>
      </div>
    </div>
  );
}
