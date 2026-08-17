import { Link } from 'react-router';
import Logo from '@/components/Logo';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-6 text-center">
      <Logo />
      <img src="/empty-globe.svg" alt="" className="mt-12 w-60 opacity-90" />
      <h1 className="type-h2 mt-8 text-ink">Off the map</h1>
      <p className="type-body mt-3 max-w-sm text-ink-2">
        This page wandered off the itinerary. Let's get you back on route.
      </p>
      <Link
        to="/"
        className="btn-sheen type-small mt-8 inline-flex h-11 items-center rounded-pill bg-brand px-6 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md"
      >
        Back to home
      </Link>
    </div>
  );
}
