import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Compass, Coins, Heart, LayoutGrid, LogOut, NotebookPen, Plus, Search, Share2, ShieldCheck, Sparkles, Users, Wallet, X } from 'lucide-react';
import Logo, { CompassMark } from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import { GrainOverlay } from '@/components/Layout';
import { UserAvatar } from '@/components/UserAvatar';
import ArrivalPrompt from '@/components/geo/ArrivalPrompt';
import SupportWidget from '@/components/support/SupportWidget';
import { AuthLayoutSkeleton } from '@/components/AuthLayoutSkeleton';
import SearchPalette from '@/components/search/SearchPalette';
import NotificationBell from '@/components/NotificationBell';
import TokenBalanceChip from '@/components/TokenBalanceChip';
import { useAuth } from '@/hooks/useAuth';
import { useLogout } from '@/hooks/useLogout';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Trips', to: '/trips', icon: LayoutGrid, match: (p: string) => p.startsWith('/trips') && !p.includes('expenses') },
  // r13-entry: friends planning as a first-class destination
  { label: 'Friends', to: '/friends', icon: Users, match: (p: string) => p.startsWith('/friends') },
  { label: 'Explore', to: '/explore', icon: Compass, match: (p: string) => p.startsWith('/explore') },
  { label: 'Journal', to: '/journal', icon: NotebookPen, match: (p: string) => p.startsWith('/journal') },
  { label: 'Expenses', to: '/expenses', icon: Wallet, match: (p: string) => p.startsWith('/expenses') || p.includes('expenses') },
];

/* r20-responsive: all 5 sections in the mobile bottom tab bar (Friends used to
   be desktop-only, which left it unreachable on phones). The center New-trip
   FAB stays; the Admin item remains sidebar-only. */
const MOBILE_NAV_ITEMS = NAV_ITEMS;

/** Admin-only entry - appended to the sidebar when the signed-in user is an admin. */
const ADMIN_NAV_ITEM = { label: 'Admin', to: '/admin', icon: ShieldCheck, match: (p: string) => p.startsWith('/admin') };

/* r24-smart: sidebar-only extras (the mobile bottom bar stays at 5 tabs +
   FAB; on phones these are reachable from the Trips page pill and the token
   chip in the top bar). */
const SIDEBAR_EXTRA_ITEMS = [
  { label: 'Wishlist', to: '/wishlist', icon: Heart, match: (p: string) => p.startsWith('/wishlist') },
  { label: 'Rewards', to: '/rewards', icon: Coins, match: (p: string) => p.startsWith('/rewards') },
];

function pageTitle(pathname: string): string {
  if (pathname === '/trips') return 'Your trips';
  if (pathname.startsWith('/friends')) return 'Plan with friends'; // r13-entry
  if (pathname.startsWith('/trips/') && pathname.endsWith('/expenses')) return 'Trip expenses';
  if (pathname.startsWith('/trips/')) return 'Trip workspace';
  if (pathname.startsWith('/expenses')) return 'Expenses';
  if (pathname.startsWith('/explore')) return 'Explore';
  if (pathname === '/journal/new') return 'New journal entry';
  if (pathname.startsWith('/journal/') && pathname.endsWith('/edit')) return 'Edit journal entry';
  if (pathname.startsWith('/journal')) return 'Travel journal';
  if (pathname.startsWith('/profile')) return 'Profile';
  if (pathname.startsWith('/wishlist')) return 'Trip wishlist';
  if (pathname.startsWith('/rewards')) return 'Tokens & rewards';
  if (pathname.startsWith('/admin')) return 'Admin';
  if (pathname.startsWith('/onboarding')) return 'Welcome to Wayfare';
  return 'Wayfare';
}

/**
 * In-app top bar (§10.2): 64px, page title left; ⌘K chip, share, avatar right.
 * Sticky, turns to glass with a hairline once scrolled.
 */
export function PageTopBar({ title, onOpenSearch }: { title?: string; onOpenSearch?: () => void }) {
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className={cn(
        'sticky top-0 z-40 flex h-16 items-center justify-between px-4 transition-all duration-[250ms] md:px-6',
        scrolled ? 'glass-strong border-b border-border shadow-sm' : 'border-b border-transparent',
      )}
    >
      <h1 className="type-h3 min-w-0 truncate text-ink">{title ?? pageTitle(pathname)}</h1>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="type-small hidden items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-ink-3 transition-colors duration-fast hover:border-border-strong hover:text-ink sm:inline-flex"
          aria-label="Open search (⌘K)"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Search</span>
          <kbd className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">⌘K</kbd>
        </button>
        {/* compact search entry for small screens (the ⌘K chip is sm+) */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Open search"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink sm:hidden"
        >
          <Search className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Share"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
        >
          <Share2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        {/* r24-smart: token balance + notification bell before the avatar */}
        <TokenBalanceChip />
        <NotificationBell />
        <TopBarAvatar />
      </div>
    </div>
  );
}

function SidebarNavItem({
  item,
  active,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        'group relative flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors duration-fast',
        'max-[1100px]:justify-center max-[1100px]:px-0',
        active ? 'bg-surface shadow-sm' : 'hover:bg-surface-2',
      )}
    >
      {/* brand left notch on active */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand transition-opacity duration-fast',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Icon
        className={cn('h-5 w-5 shrink-0 transition-colors duration-fast', active ? 'text-brand' : 'text-ink-3 group-hover:text-ink')}
        strokeWidth={1.75}
      />
      <span
        className={cn(
          'text-[14px] font-medium max-[1100px]:hidden',
          active ? 'text-ink' : 'text-ink-2 group-hover:text-ink',
        )}
      >
        {item.label}
      </span>
      {/* tooltip in icon-rail mode */}
      <span className="type-small pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-ink opacity-0 shadow-md transition-opacity duration-fast group-hover:opacity-100 max-[1100px]:block">
        {item.label}
      </span>
    </Link>
  );
}

const GUEST_BANNER_KEY = 'wayfare-guest-banner-dismissed';

/**
 * Guest session banner - slim clay-tinted glass strip below the top bar for
 * ephemeral demo accounts (unionId "guest-…"). Dismissal lasts the session.
 */
function GuestBanner({ user }: { user: { unionId: string; name: string | null } }) {
  const isGuest = user.unionId.startsWith('guest-') || user.name === 'Guest Explorer';
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(GUEST_BANNER_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (!isGuest || dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(GUEST_BANNER_KEY, '1');
    } catch {
      // storage unavailable, dismiss for this render only
    }
    setDismissed(true);
  };

  return (
    <div
      className="glass relative z-30 flex min-h-10 flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-brand/20 px-10 py-2 text-center"
      style={{ background: 'color-mix(in srgb, var(--brand-soft) 78%, var(--glass))' }}
      role="status"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={1.75} />
      <p className="type-small text-ink">
        You’re exploring a fresh demo, {' '}
        <Link to="/login" className="font-semibold text-brand underline-offset-2 transition-colors duration-fast hover:underline">
          sign in
        </Link>{' '}
        to keep your trips.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss demo banner"
        className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** Top-bar avatar - reflects the signed-in user. */
function TopBarAvatar() {
  const { user } = useAuth();
  return (
    <Link to="/profile" aria-label="Your profile" className="transition-transform duration-fast hover:scale-105">
      <UserAvatar name={user?.name} avatar={user?.avatar} />
    </Link>
  );
}

/** Sidebar user chip with tier + logout. */
function SidebarUserChip() {
  const { user } = useAuth();
  const { logout, isPending } = useLogout();
  const { data: billing } = trpc.billing.status.useQuery(undefined, { retry: false });
  const tier = billing?.subscription?.tier === 'voyager' ? 'Voyager' : 'Wanderer';
  return (
    <div className="flex items-center justify-between gap-2 max-[1100px]:justify-center">
      <Link
        to="/profile"
        className="group flex min-w-0 items-center gap-2.5 rounded-md px-1 py-1 transition-colors duration-fast hover:bg-surface-2 max-[1100px]:px-0"
      >
        <UserAvatar name={user?.name} avatar={user?.avatar} />
        <span className="min-w-0 max-[1100px]:hidden">
          <span className="type-small block truncate text-ink">{user?.name ?? 'Traveler'}</span>
          <span className="type-caption block text-ink-3">{tier}</span>
        </span>
      </Link>
      <button
        type="button"
        aria-label="Log out"
        title="Log out"
        disabled={isPending}
        onClick={() => logout()}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-danger max-[1100px]:hidden"
      >
        <LogOut className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * In-app shell (§10.2): 248px desktop sidebar (72px icon rail under 1100px),
 * 64px mobile glass bottom nav with center "New trip" FAB, sticky top bar.
 * Renders <Outlet/> for nested routes. Auth-guarded: redirects to /login.
 */
export default function AppShell() {
  const { pathname } = useLocation();
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  const [searchOpen, setSearchOpen] = useState(false);

  /* ⌘K / Ctrl+K toggles the global search palette (standard palette idiom -
     re-pressing while open closes it). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Admin nav item: sidebar + icon rail only (mobile bottom nav stays at 4 + FAB).
  const navItems = user?.role === 'admin' ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  if (isLoading) return <AuthLayoutSkeleton />;
  if (!user) return null;

  return (
    <div className="relative min-h-[100dvh] bg-bg text-ink">
      <GrainOverlay />

      {/* ---------- Desktop / tablet sidebar ---------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-border bg-bg-subtle max-[1100px]:w-[72px] md:flex">
        <div className="flex h-16 items-center px-5 max-[1100px]:justify-center max-[1100px]:px-0">
          <Link to="/trips" aria-label="Wayfare · your trips">
            <span className="max-[1100px]:hidden">
              <Logo />
            </span>
            <span className="hidden max-[1100px]:block">
              <CompassMark className="h-7 w-7 text-brand" />
            </span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 pt-2" aria-label="App">
          {navItems.map((item) => (
            <SidebarNavItem key={item.to} item={item} active={item.match(pathname)} />
          ))}
          {/* r24-smart: wishlist + rewards (desktop sidebar) */}
          {SIDEBAR_EXTRA_ITEMS.map((item) => (
            <SidebarNavItem key={item.to} item={item} active={item.match(pathname)} />
          ))}
        </nav>

        <div className="space-y-3 border-t border-border p-3">
          <Link
            to="/trips"
            className="type-small flex h-10 items-center justify-center gap-2 rounded-full bg-wayfare-dark font-semibold text-[#fafafa] shadow-sm transition-all duration-fast hover:bg-[#333] hover:shadow-md active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            <span className="max-[1100px]:hidden">New trip</span>
          </Link>
          <div className="flex items-center justify-between max-[1100px]:justify-center">
            <span className="max-[1100px]:hidden">
              <ThemeToggle />
            </span>
            <SidebarUserChip />
          </div>
        </div>
      </aside>

      {/* ---------- Main column ---------- */}
      <div className="relative z-[2] flex min-h-[100dvh] flex-col md:pl-[248px] md:max-[1100px]:pl-[72px]">
        <PageTopBar onOpenSearch={() => setSearchOpen(true)} />
        <GuestBanner user={user} />
        <main className="flex-1 pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* ---------- Mobile bottom nav (5 items + center FAB; Profile lives in
          the top bar). Safe-area padding keeps the tabs clear of the iOS home
          indicator. ---------- */}
      <nav
        className="glass-strong fixed inset-x-0 bottom-0 z-40 flex h-[calc(64px+env(safe-area-inset-bottom))] items-stretch justify-around border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="App"
      >
        {MOBILE_NAV_ITEMS.slice(0, 2).map((item) => (
          <MobileTab key={item.to} item={item} active={item.match(pathname)} />
        ))}
        {/* Center New-trip FAB */}
        <div className="relative flex w-14 shrink-0 items-center justify-center">
          <Link
            to="/trips"
            aria-label="New trip"
            className="absolute -top-7 flex h-14 w-14 items-center justify-center rounded-full bg-wayfare-dark text-[#fafafa] shadow-lg transition-transform duration-fast hover:scale-105 active:scale-95"
          >
            <Plus className="h-6 w-6" strokeWidth={2} />
          </Link>
        </div>
        {MOBILE_NAV_ITEMS.slice(2).map((item) => (
          <MobileTab key={item.to} item={item} active={item.match(pathname)} />
        ))}
      </nav>

      {/* ---------- Arrival expense prompt (geo watcher; guests included) ----------
          Rendered below content in DOM order, z-50 sits it above the z-40
          mobile nav. Self-hides when there's no arrival. */}
      <ArrivalPrompt />

      {/* ---------- Global search palette (⌘K) ---------- */}
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
      {/* ---------- Support widget (r10-support): floating help button, fixed
          above the mobile bottom nav. FAQ shortcuts for everyone; the ticket
          form unlocks for Voyager members inside the panel. */}
      <SupportWidget />
    </div>
  );
}

function MobileTab({
  item,
  active,
}: {
  item: { label: string; to: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; match: (p: string) => boolean };
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1"
      aria-label={item.label}
    >
      <Icon
        className={cn('h-5 w-5 transition-all duration-[240ms] ease-spring-soft', active ? 'scale-110 text-brand' : 'text-ink-3')}
        strokeWidth={1.75}
      />
      <span className={cn('max-w-full truncate px-0.5 text-[10px] font-medium', active ? 'text-brand' : 'text-ink-3')}>{item.label}</span>
      <span className={cn('absolute bottom-1 h-1 w-1 rounded-full bg-brand transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
    </Link>
  );
}
