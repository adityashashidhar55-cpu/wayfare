import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { motion } from "framer-motion";
import { ArrowLeft, Apple as AppleIcon, Sparkles, Loader2, Mail } from "lucide-react";
import Logo from "@/components/Logo";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { safeNextPath } from "@/lib/safe-next";
import { apiBase } from "@/lib/apiBase";
import { captureReferralParam } from "@/lib/referral";

/** Which social OAuth providers the backend has credentials for. */
type ProviderAvailability = { google: boolean; apple: boolean; microsoft?: boolean; kimi?: boolean };

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

/** Google "G", drawn inline. */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** The four-square Microsoft mark, drawn inline (no external asset). */
function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="h-[16px] w-[16px]" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

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
  // r35: the OAuth callbacks redirect to /login?error=<provider> on failure;
  // that used to be silent, so a failed sign-in looked like nothing happened.
  const [oauthError] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search).get("error");
    if (!p) return null;
    const name = p === "google" ? "Google" : p === "microsoft" ? "Microsoft" : p === "apple" ? "Apple" : "that provider";
    return `Signing in with ${name} did not complete. Please try again, or use email below.`;
  });
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
            A ready-made Japan trip with friends, expenses and a packing list. Sign in afterwards to keep it.
          </p>
          {oauthError && (
            <p className="type-small mt-3 rounded-md bg-ochre-soft px-3 py-2 text-center text-ink" role="alert">
              {oauthError}
            </p>
          )}
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
              icon={<GoogleLogo />}
              label="Continue with Google"
              href={providers?.google ? `${apiBase()}/api/oauth/google/start` : undefined}
              disabled={!providers?.google}
              soon={!providers?.google}
            />
            <ProviderButton
              icon={<MicrosoftLogo />}
              label="Continue with Microsoft"
              href={providers?.microsoft ? `${apiBase()}/api/oauth/microsoft/start` : undefined}
              disabled={!providers?.microsoft}
              soon={!providers?.microsoft}
            />
            {/* r35: Apple needs a paid developer account; only shown once it is set up. */}
            {providers?.apple && (
              <ProviderButton
                icon={<AppleIcon className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.75} />}
                label="Continue with Apple"
                href={`${apiBase()}/api/oauth/apple/start`}
              />
            )}
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
