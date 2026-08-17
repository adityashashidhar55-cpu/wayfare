import { useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck,
  Crown,
  LogOut,
  Mail,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Preference, User } from '@contracts/types';
import { CURRENCY_SYMBOLS, FX_PER_USD } from '@contracts/fx';
import { trpc } from '@/providers/trpc';
import { useLogout } from '@/hooks/useLogout';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EASE_EXPO } from '@/lib/motion';
import { formatSingleDay } from '@/components/trips/utils';
import { cn } from '@/lib/utils';

type PanelKey = 'membership' | 'preferences' | 'account';

const PANELS: { key: PanelKey; label: string; icon: typeof Crown }[] = [
  { key: 'membership', label: 'Membership', icon: Crown },
  { key: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { key: 'account', label: 'Account', icon: UserRound },
];

const THEME_KEY = 'wayfare-theme';
type ThemeMode = 'system' | 'light' | 'dark';

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/* ------------------------------ Membership ------------------------------ */

function MembershipPanel() {
  const utils = trpc.useUtils();
  const billingQ = trpc.billing.status.useQuery();
  const [cancelOpen, setCancelOpen] = useState(false);

  const cancel = trpc.billing.cancel.useMutation({
    onSuccess: () => {
      utils.billing.status.invalidate();
      utils.trips.list.invalidate();
      setCancelOpen(false);
      toast.success('You’re back on Wanderer, your trips aren’t going anywhere.');
    },
    onError: (e) => toast.error(e.message),
  });

  if (billingQ.isLoading) {
    return <div className="h-48 animate-pulse rounded-xl bg-surface-2" aria-label="Loading membership" />;
  }

  const sub = billingQ.data?.subscription;
  const prices = billingQ.data?.prices;
  const voyager = sub?.tier === 'voyager';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8">
        {voyager ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-ochre-soft text-ochre">
                  <Crown className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div>
                  <h4 className="type-h4 text-ink">Wayfare Voyager</h4>
                  <p className="type-caption text-ink-3">
                    {sub.currentPeriodEnd
                      ? `Renews ${formatSingleDay(sub.currentPeriodEnd, { withYear: true })}`
                      : 'Active membership'}
                  </p>
                </div>
              </div>
              <span className="type-caption rounded-pill bg-pine-soft px-3 py-1 font-semibold text-pine">Active</span>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
              <Button variant="ghost" asChild>
                <Link to="/pricing">Manage billing</Link>
              </Button>
              <Button variant="danger-ghost" onClick={() => setCancelOpen(true)}>
                Cancel subscription
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="type-h4 text-ink">Wayfare Wanderer</h4>
                <p className="type-small mt-1 text-ink-2">Free forever: 3 active trips, 3 collaborators per trip.</p>
              </div>
              <span className="type-caption rounded-pill bg-surface-2 px-3 py-1 font-semibold text-ink-2">
                Current plan
              </span>
            </div>
            {/* Voyager upsell mini-card */}
            <div className="mt-6 rounded-lg bg-ochre-soft p-5">
              <div className="flex items-center gap-2">
                <Crown className="h-[18px] w-[18px] text-ochre" strokeWidth={1.75} />
                <span className="type-h4 text-ink">Wayfare Voyager</span>
              </div>
              <p className="type-small mt-1.5 max-w-[52ch] text-ink-2">
                Unlimited trips, route optimization, price-drop hints, and unlimited collaborators.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="type-numeral tnum text-[20px] leading-7 text-ink">
                  {prices?.yearly.label ?? '$39.99/yr'}
                </span>
                <Button variant="premium" asChild>
                  <Link to="/pricing">
                    <Crown className="h-4 w-4" strokeWidth={1.75} />
                    Upgrade to Voyager
                  </Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Cancel confirm */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">Cancel Voyager?</AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              You’ll drop back to the Wanderer limits (3 active trips, 3 collaborators). Your trips,
              places, and notes stay exactly where they are, and you can re-upgrade anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Voyager</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancel.mutate()}
              className="bg-danger text-white hover:brightness-110"
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel subscription'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------ Preferences ----------------------------- */

function PreferencesPanel({ pref }: { pref?: Preference }) {
  const utils = trpc.useUtils();
  const { setTheme } = useTheme();
  const [mode, setMode] = useState<ThemeMode>(readMode);

  const upsert = trpc.preferences.upsert.useMutation({
    onSuccess: () => {
      utils.preferences.get.invalidate();
      toast.success('Preference saved');
    },
    onError: (e) => toast.error(e.message),
  });

  const chooseTheme = (m: ThemeMode) => {
    setMode(m);
    if (m === 'system') {
      // Clear the stored preference; follow the OS from here on.
      try {
        localStorage.removeItem(THEME_KEY);
      } catch {
        /* storage unavailable */
      }
      document.documentElement.classList.toggle(
        'dark',
        window.matchMedia('(prefers-color-scheme: dark)').matches,
      );
    } else {
      setTheme(m);
    }
  };

  const themeOptions: { key: ThemeMode; label: string; icon: typeof Sun }[] = [
    { key: 'system', label: 'System', icon: Monitor },
    { key: 'light', label: 'Light', icon: Sun },
    { key: 'dark', label: 'Dark', icon: Moon },
  ];

  return (
    <div className="rounded-xl border border-border bg-surface px-6 shadow-sm md:px-8">
      {/* Theme */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-5">
        <div>
          <span className="type-small block font-semibold text-ink">Theme</span>
          <span className="type-caption text-ink-3">Warm paper by day, warm charcoal by night.</span>
        </div>
        <div className="inline-flex rounded-pill bg-surface-2 p-1" role="radiogroup" aria-label="Theme">
          {themeOptions.map((t) => (
            <button
              key={t.key}
              role="radio"
              aria-checked={mode === t.key}
              onClick={() => chooseTheme(t.key)}
              className={cn(
                'relative inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-semibold transition-colors duration-fast',
                mode === t.key ? 'text-ink' : 'text-ink-2 hover:text-ink',
              )}
            >
              {mode === t.key && (
                <motion.span
                  layoutId="theme-pill"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                />
              )}
              <t.icon className="relative z-[1] h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="relative z-[1]">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Home currency */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div>
          <span className="type-small block font-semibold text-ink">Home currency</span>
          <span className="type-caption text-ink-3">New trips default to this; expenses convert back to it.</span>
        </div>
        <Select
          value={pref?.homeCurrency ?? 'USD'}
          onValueChange={(v) => upsert.mutate({ homeCurrency: v })}
        >
          <SelectTrigger className="h-10 w-[170px] rounded-md border-border-strong bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(FX_PER_USD).map((code) => (
              <SelectItem key={code} value={code}>
                {code} ({CURRENCY_SYMBOLS[code] ?? code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/* -------------------------------- Account ------------------------------- */

function AccountPanel({ user }: { user: User }) {
  const { logout, isPending } = useLogout();

  /* Instant logout: fire the mutation right away - useLogout() wipes the
     cache/local state and hard-redirects to /login. No farewell screen. */
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface px-6 shadow-sm md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-2 text-ink-3">
              <Mail className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <span className="type-small block font-semibold text-ink">{user.email ?? 'No email on file'}</span>
              <span className="type-caption text-ink-3">Sign-in email</span>
            </div>
          </div>
          {user.email && (
            <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-pine-soft px-2.5 py-1 font-semibold text-pine">
              <BadgeCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
              Verified
            </span>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-danger/40 bg-surface p-6 shadow-sm md:p-8">
        <h4 className="type-h4 text-ink">Danger zone</h4>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="type-small block font-semibold text-ink">Log out</span>
            <span className="type-caption text-ink-3">Your trips sync to the cloud, nothing is lost.</span>
          </div>
          <Button variant="secondary" onClick={() => logout()} disabled={isPending}>
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            {isPending ? 'Logging out…' : 'Log out'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Section -------------------------------- */

/**
 * Settings (profile §S6, scoped to real backends): sticky nav + crossfading
 * panels - Membership (billing), Preferences (theme, home currency),
 * Account (email, instant logout).
 */
export function SettingsSection({ user, pref }: { user: User; pref?: Preference }) {
  const [panel, setPanel] = useState<PanelKey>('membership');

  return (
    <section id="settings" aria-label="Settings" className="scroll-mt-24">
      <h3 className="type-h3 mb-5 text-ink">Settings</h3>
      <div className="md:grid md:grid-cols-[240px_1fr] md:gap-8">
        {/* Nav, vertical sticky on desktop, horizontal chips on mobile */}
        <nav aria-label="Settings sections" className="mb-5 self-start md:sticky md:top-24 md:mb-0">
          <div className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-col md:pb-0 [&::-webkit-scrollbar]:hidden">
            {PANELS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPanel(p.key)}
                aria-current={panel === p.key}
                className={cn(
                  'type-small flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2.5 font-medium transition-colors duration-fast',
                  panel === p.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )}
              >
                <p.icon
                  className={cn('h-4 w-4', panel === p.key ? 'text-brand' : 'text-ink-3')}
                  strokeWidth={1.75}
                />
                {p.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Panels, crossfade + 8px rise, 200ms */}
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panel}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_EXPO }}
            >
              {panel === 'membership' && <MembershipPanel />}
              {panel === 'preferences' && <PreferencesPanel pref={pref} />}
              {panel === 'account' && <AccountPanel user={user} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
