import { Outlet, useLocation } from 'react-router';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

/** Global film-grain layer (design.md §3.4). Rendered once per shell. */
export function GrainOverlay() {
  return <div className="grain-overlay" aria-hidden="true" />;
}

/**
 * Marketing layout: Navbar (sticky overlay) + page + Footer + grain.
 * Nested-route pattern - renders <Outlet/>.
 */
export default function Layout() {
  const { pathname } = useLocation();
  /* r23: the landing hero carries its own nav; keep the marketing Navbar
     on the other pages that share this layout. */
  const isLanding = pathname === '/';
  return (
    <div className="relative min-h-[100dvh] bg-bg text-ink">
      <GrainOverlay />
      {!isLanding && <Navbar />}
      <main className="relative z-[2]">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
