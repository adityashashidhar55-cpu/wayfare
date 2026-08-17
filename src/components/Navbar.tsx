import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import { UserAvatar } from '@/components/UserAvatar';
import { useAuth } from '@/hooks/useAuth';
import { LOGIN_PATH } from '@/const';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { label: 'Product', href: '/#features', hash: true },
  { label: 'Explore', href: '/explore', hash: false },
  { label: 'Pricing', href: '/pricing', hash: false },
];

/**
 * Marketing navbar (design.md §10.1) - transparent over the hero, becomes
 * glass-strong + hairline + shadow-sm after 24px of scroll (250ms).
 * Sticky with a negative bottom margin so full-bleed heroes slide under it.
 */
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 -mb-[72px] h-[72px]">
        <div
          className={cn(
            'flex h-full items-center transition-all duration-[250ms] ease-expo',
            scrolled
              ? 'glass-strong border-b border-border shadow-sm'
              : 'border-b border-transparent bg-transparent',
          )}
        >
          <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-6">
            <Link to="/" aria-label="Wayfare home" className="transition-transform duration-fast hover:-translate-y-px">
              <Logo />
            </Link>

            {/* Center links */}
            <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
              {NAV_LINKS.map((l) =>
                l.hash ? (
                  <a
                    key={l.label}
                    href={l.href}
                    className="type-small text-ink-2 transition-colors duration-fast hover:text-ink"
                  >
                    {l.label}
                  </a>
                ) : (
                  <Link
                    key={l.label}
                    to={l.href}
                    className="type-small text-ink-2 transition-colors duration-fast hover:text-ink"
                  >
                    {l.label}
                  </Link>
                ),
              )}
            </nav>

            {/* Right actions */}
            <div className="hidden items-center gap-2 md:flex">
              <ThemeToggle />
              {isLoading ? (
                <span className="h-10 w-28 animate-pulse rounded-pill bg-surface-2" aria-hidden />
              ) : isAuthenticated ? (
                <>
                  <Link
                    to="/trips"
                    className="btn-sheen type-small ml-1 inline-flex h-10 items-center rounded-pill bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
                  >
                    Open app
                  </Link>
                  <Link to="/profile" aria-label="Your profile" className="ml-2">
                    <UserAvatar name={user?.name} avatar={user?.avatar} />
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to={LOGIN_PATH}
                    className="type-small rounded-md px-3 py-2 text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
                  >
                    Sign in
                  </Link>
                  <Link
                    to={LOGIN_PATH}
                    className="btn-sheen type-small ml-1 inline-flex h-10 items-center rounded-pill bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
                  >
                    Create an itinerary
                  </Link>
                </>
              )}
            </div>

            {/* Mobile hamburger */}
            <div className="flex items-center gap-1 md:hidden">
              <ThemeToggle />
              <button
                type="button"
                aria-label={open ? 'Close menu' : 'Open menu'}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink transition-colors hover:bg-surface-2"
              >
                {open ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Menu className="h-5 w-5" strokeWidth={1.75} />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile full-screen sheet */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 flex flex-col bg-bg pt-[72px] md:hidden"
          >
            <nav className="flex flex-1 flex-col gap-2 px-8 pt-10" aria-label="Mobile">
              {NAV_LINKS.map((l, i) => (
                <motion.div
                  key={l.label}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06 * i + 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  {l.hash ? (
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="font-serif text-[32px] font-medium tracking-[-0.02em] text-ink"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link
                      to={l.href}
                      onClick={() => setOpen(false)}
                      className="font-serif text-[32px] font-medium tracking-[-0.02em] text-ink"
                    >
                      {l.label}
                    </Link>
                  )}
                </motion.div>
              ))}
            </nav>
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-3 border-t border-border px-8 py-8"
            >
              {isAuthenticated ? (
                <Link
                  to="/trips"
                  onClick={() => setOpen(false)}
                  className="type-body inline-flex h-12 items-center justify-center rounded-pill bg-brand font-semibold text-brand-ink"
                >
                  Open app
                </Link>
              ) : (
                <>
                  <Link
                    to={LOGIN_PATH}
                    onClick={() => setOpen(false)}
                    className="type-body inline-flex h-12 items-center justify-center rounded-md border border-border-strong text-ink"
                  >
                    Sign in
                  </Link>
                  <Link
                    to={LOGIN_PATH}
                    onClick={() => setOpen(false)}
                    className="type-body inline-flex h-12 items-center justify-center rounded-pill bg-brand font-semibold text-brand-ink"
                  >
                    Create an itinerary
                  </Link>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
