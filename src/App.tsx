import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { TRPCProvider } from '@/providers/trpc';
import Layout from '@/components/Layout';
import AppShell from '@/components/AppShell';
import Home from '@/pages/Home';

// r21-perf: every route except the landing Home is code-split so the first
// paint only parses the chunks it actually needs (Home stays eager for LCP).
const Login = lazy(() => import('@/pages/Login'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));
const Trips = lazy(() => import('@/pages/Trips'));
const TripWorkspace = lazy(() => import('@/pages/TripWorkspace'));
const TripExpenses = lazy(() => import('@/pages/TripExpenses'));
const TripBookings = lazy(() => import('@/pages/TripBookings')); // r24-core
const Expenses = lazy(() => import('@/pages/Expenses'));
const Explore = lazy(() => import('@/pages/Explore'));
const Journal = lazy(() => import('@/pages/Journal'));
const JournalEditor = lazy(() => import('@/pages/JournalEditor'));
const JournalPost = lazy(() => import('@/pages/JournalPost'));
const Pricing = lazy(() => import('@/pages/Pricing'));
const GetApp = lazy(() => import('@/pages/GetApp'));
const KidsPortal = lazy(() => import('@/pages/KidsPortal'));
const Profile = lazy(() => import('@/pages/Profile'));
const Admin = lazy(() => import('@/pages/Admin'));
const CityBuilder = lazy(() => import('@/pages/CityBuilder'));
const Faq = lazy(() => import('@/pages/Faq'));
const SharedTrip = lazy(() => import('@/pages/SharedTrip'));
const Friends = lazy(() => import('@/pages/Friends')); // r12-friends
const FriendsHome = lazy(() => import('@/pages/FriendsHome')); // r13-entry
const PublishedTrip = lazy(() => import('@/pages/PublishedTrip')); // r24-social
const OwnerPortal = lazy(() => import('@/pages/OwnerPortal')); // r17-portal
const Wishlist = lazy(() => import('@/pages/Wishlist')); // r24-smart
const Rewards = lazy(() => import('@/pages/Rewards')); // r24-smart

// Minimal on-brand fallback shown while a lazy route chunk downloads.
function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-surface" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
    </div>
  );
}

function lazyEl(el: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{el}</Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <TRPCProvider>
        <Routes>
          {/* Marketing pages */}
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/pricing" element={lazyEl(<Pricing />)} />
            <Route path="/get-app" element={lazyEl(<GetApp />)} />
            <Route path="/kids" element={lazyEl(<KidsPortal />)} />
            <Route path="/faq" element={lazyEl(<Faq />)} />
          </Route>

          {/* Auth (backend graft owns this page) */}
          <Route path="/login" element={lazyEl(<Login />)} />

          {/* Public read-only shared itinerary (no auth) */}
          <Route path="/shared/:token" element={lazyEl(<SharedTrip />)} />
          {/* r12-friends: public guest invite page, the URL token is the credential */}
          <Route path="/friends/:token" element={lazyEl(<Friends />)} />
          {/* r24-social: public published-trip page, client-rendered, 404s when unpublished */}
          <Route path="/p/:slug" element={lazyEl(<PublishedTrip />)} />

          {/* r17-portal: private owner console · PUBLIC route, outside AppShell,
              intentionally NOT linked anywhere in the app (secret URL). */}
          <Route path="/portal/:pathSecret" element={lazyEl(<OwnerPortal />)} />

          {/* In-app pages (auth-guarded by AppShell) */}
          <Route element={<AppShell />}>
            <Route path="/onboarding" element={lazyEl(<Onboarding />)} />
            {/* r13-entry: friends planning home (auth). The public /friends/:token
                route above stays outside the shell, distinct paths, no swallowing. */}
            <Route path="/friends" element={lazyEl(<FriendsHome />)} />
            <Route path="/trips" element={lazyEl(<Trips />)} />
            <Route path="/trips/:id" element={lazyEl(<TripWorkspace />)} />
            <Route path="/trips/:id/expenses" element={lazyEl(<TripExpenses />)} />
            <Route path="/trips/:id/bookings" element={lazyEl(<TripBookings />)} />
            <Route path="/expenses" element={lazyEl(<Expenses />)} />
            <Route path="/explore" element={lazyEl(<Explore />)} />
            <Route path="/city/:name" element={lazyEl(<CityBuilder />)} />
            <Route path="/journal" element={lazyEl(<Journal />)} />
            <Route path="/journal/new" element={lazyEl(<JournalEditor />)} />
            <Route path="/journal/:id" element={lazyEl(<JournalPost />)} />
            <Route path="/journal/:id/edit" element={lazyEl(<JournalEditor />)} />
            <Route path="/wishlist" element={lazyEl(<Wishlist />)} />
            <Route path="/rewards" element={lazyEl(<Rewards />)} />
            <Route path="/profile" element={lazyEl(<Profile />)} />
            <Route path="/wishlist" element={lazyEl(<Wishlist />)} /> {/* r24-smart */}
            <Route path="/rewards" element={lazyEl(<Rewards />)} /> {/* r24-smart */}
            <Route path="/admin" element={lazyEl(<Admin />)} />
          </Route>

          <Route path="*" element={lazyEl(<NotFound />)} />
        </Routes>
      </TRPCProvider>
    </BrowserRouter>
  );
}
