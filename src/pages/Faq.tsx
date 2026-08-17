import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import {
  Baby,
  CloudSun,
  Compass,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { FAQ_GROUPS, ALL_FAQS, type FaqItem } from '@/components/support/faq-data';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  'getting-started': Compass,
  'trips-ai': Sparkles,
  'maps-places': MapPin,
  'weather-advisories': CloudSun,
  family: Baby,
  'app-account': Smartphone,
};

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_EXPO } },
};

/** One accordion row - hairline separated, plus → × rotation, height spring (pricing Faq pattern). */
function FaqRow({ entry, open, onToggle }: { entry: FaqItem; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-4 text-left transition-colors duration-fast hover:text-brand"
      >
        <span className="text-[15px] font-semibold text-ink">{entry.q}</span>
        <Plus
          className={cn(
            'h-[18px] w-[18px] shrink-0 text-ink-3 transition-transform duration-[250ms] ease-expo',
            open && 'rotate-45 text-brand',
          )}
          strokeWidth={1.75}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_EXPO }}
            className="overflow-hidden"
          >
            <p className="type-body max-w-[68ch] pb-5 text-ink-2">{entry.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A deep-linkable FAQ group section with its own anchor id. */
function FaqGroupSection({ group, query }: { group: (typeof FAQ_GROUPS)[number]; query: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const Icon = GROUP_ICONS[group.id] ?? Compass;
  const q = query.trim().toLowerCase();
  const items = q
    ? group.items.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q))
    : group.items;
  if (q && items.length === 0) return null;

  return (
    <section id={group.id} className="scroll-mt-24" aria-label={group.title}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-soft text-brand">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <div>
          <h3 className="type-h3 text-ink">{group.title}</h3>
          <p className="type-caption text-ink-3">{group.blurb}</p>
        </div>
        <span className="type-caption tnum ml-auto rounded-pill bg-surface-2 px-2 py-0.5 text-ink-3">
          {items.length}
        </span>
      </div>
      <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface px-5 shadow-sm">
        {items.map((f, i) => (
          <FaqRow key={f.q} entry={f} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? null : i)} />
        ))}
      </div>
    </section>
  );
}

/**
 * Public help center at /faq - the first stop for common issues. Groups are
 * deep-linkable (/faq#trips-ai), the search box filters across every answer,
 * and the footer routes paid members to the in-app support widget.
 */
export default function Faq() {
  const { hash } = useLocation();
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  // Deep links: /faq#<group-id> scrolls the group into view (client-side nav
  // doesn't apply hash scrolling on its own).
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  const matchCount = useMemo(() => {
    if (!searching) return ALL_FAQS.length;
    const q = query.trim().toLowerCase();
    return ALL_FAQS.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)).length;
  }, [query, searching]);

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-20 pt-28 md:px-6 md:pt-36">
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-10">
        {/* ---------- Header ---------- */}
        <motion.header variants={item} className="text-center">
          <p className="type-eyebrow inline-flex items-center gap-1.5 rounded-pill bg-brand-soft px-3 py-1.5 text-brand">
            <LifeBuoy className="h-3.5 w-3.5" strokeWidth={1.75} />
            Help center
          </p>
          <h2 className="type-h1 mt-4 text-ink">Questions, answered.</h2>
          <p className="type-body mx-auto mt-3 max-w-[56ch] text-ink-2">
            The most common issues travelers run into, organized so you can jump straight to yours.
            Can&apos;t find it? Voyager members can message us right from the app.
          </p>

          {/* Search filter */}
          <div className="relative mx-auto mt-6 max-w-[480px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the FAQs, try “weather” or “pending”…"
              aria-label="Search the FAQs"
              className="type-small h-11 w-full rounded-pill border border-border bg-surface pl-10 pr-10 text-ink shadow-sm outline-none transition-colors duration-fast placeholder:text-ink-3 focus:border-brand"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
          {searching && (
            <p className="type-caption mt-2 text-ink-3" role="status">
              <span className="tnum font-semibold text-ink">{matchCount}</span>{' '}
              {matchCount === 1 ? 'answer matches' : 'answers match'} “{query.trim()}”
            </p>
          )}
        </motion.header>

        {/* ---------- Group quick nav (deep links) ---------- */}
        {!searching && (
          <motion.nav variants={item} aria-label="FAQ groups" className="flex flex-wrap justify-center gap-2">
            {FAQ_GROUPS.map((g) => {
              const Icon = GROUP_ICONS[g.id] ?? Compass;
              return (
                <a
                  key={g.id}
                  href={`#${g.id}`}
                  className="type-small inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-3.5 py-2 text-ink-2 shadow-sm transition-all duration-fast hover:-translate-y-px hover:border-brand hover:text-brand"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {g.title}
                </a>
              );
            })}
          </motion.nav>
        )}

        {/* ---------- Groups ---------- */}
        <motion.div variants={item} className="space-y-10">
          {FAQ_GROUPS.map((g) => (
            <FaqGroupSection key={g.id} group={g} query={query} />
          ))}
          {searching && matchCount === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center shadow-sm">
              <p className="type-h3 text-ink">Nothing matches “{query.trim()}”.</p>
              <p className="type-small mt-2 text-ink-2">
                Try a different word, or if you&apos;re a Voyager member, send us the question directly from the
                help button in the app.
              </p>
            </div>
          )}
        </motion.div>

        {/* ---------- Still stuck? ---------- */}
        <motion.footer variants={item}>
          <div className="relative overflow-hidden rounded-xl border border-brand/25 bg-surface p-6 text-center shadow-sm md:p-8">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
              <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h3 className="type-h3 mt-3 text-ink">Still stuck?</h3>
            <p className="type-small mx-auto mt-1.5 max-w-[52ch] text-ink-2">
              Voyager members can message us straight from the app, look for the help button at the
              bottom-right of any screen. We typically reply within a day.
            </p>
            <Link
              to="/profile"
              className="btn-sheen type-small mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
            >
              Voyager members can message us →
            </Link>
            <p className="type-caption mt-3 text-ink-3">
              Not on Voyager yet? <Link to="/pricing" className="font-semibold text-brand underline-offset-2 hover:underline">See what it adds</Link>, or email admin@wayfare.app.
            </p>
          </div>
        </motion.footer>
      </motion.div>
    </div>
  );
}
