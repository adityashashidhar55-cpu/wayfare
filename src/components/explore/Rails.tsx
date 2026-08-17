/**
 * Explore curated rails (explore.md §S4) and the community itineraries
 * strip (§S6) - hidden-gem editorial cards and ready-made city plans, all
 * derived from the live explore corpus (places + cities from the API).
 */
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ExploreCity, ExplorePlaceItem } from '@/components/explore/explore-utils';
import {
  EDITOR_AVATARS,
  EDITOR_NAMES,
  localTip,
  planDaysFor,
  planTitle,
} from '@/components/explore/explore-utils';

const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];

// ── horizontal snap rail with edge fades + hover nudge buttons ──────────────
function SnapRail({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  return (
    <div className="group/rail relative">
      <div
        ref={ref}
        className="marquee-mask flex snap-x gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={`Scroll ${label} back`}
        onClick={() => nudge(-1)}
        className="absolute -left-3 top-1/2 hidden -translate-y-1/2 rounded-full border border-border bg-surface p-2 text-ink-2 opacity-0 shadow-md transition-all duration-fast hover:text-ink group-hover/rail:opacity-100 md:block"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={`Scroll ${label} forward`}
        onClick={() => nudge(1)}
        className="absolute -right-3 top-1/2 hidden -translate-y-1/2 rounded-full border border-border bg-surface p-2 text-ink-2 opacity-0 shadow-md transition-all duration-fast hover:text-ink group-hover/rail:opacity-100 md:block"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function RailHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="mb-4">
      <h3 className="type-h3 text-ink">{title}</h3>
      {caption && <p className="type-small mt-1 text-ink-3">{caption}</p>}
    </div>
  );
}

function EditorAvatars({ className }: { className?: string }) {
  return (
    <span className={cn('flex -space-x-2', className)}>
      {EDITOR_AVATARS.map((src) => (
        <img
          key={src}
          src={src}
          alt=""
          className="h-7 w-7 rounded-full object-cover ring-2 ring-surface"
          loading="lazy"
        />
      ))}
    </span>
  );
}

interface RailsProps {
  places: ExplorePlaceItem[];
  cities: ExploreCity[];
  styles: string[];
  activeCity: string | null;
  onUsePlan: (city: ExploreCity) => void;
  busyCity: string | null;
}

export function CommunityStrip({
  cities,
  styles,
  onUsePlan,
  busyCity,
}: Pick<RailsProps, 'cities' | 'styles' | 'onUsePlan' | 'busyCity'>) {
  if (cities.length === 0) return null;
  return (
    <section aria-label="Community itineraries">
      <RailHeader title="Travelers like you also planned" caption="Popular weeks from the Wayfare community" />
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-60px' }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface"
      >
        {cities.slice(0, 4).map((c, i) => {
          const days = planDaysFor(c.count);
          const busy = busyCity === c.city;
          return (
            <motion.li
              key={c.city}
              variants={{
                hidden: { opacity: 0, y: 16 },
                show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPO } },
              }}
            >
              <div className="flex items-center gap-4 p-3 transition-colors duration-fast hover:bg-surface-2">
                {c.image ? (
                  <img
                    src={c.image}
                    alt=""
                    loading="lazy"
                    className="photo h-20 w-20 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-surface-2">
                    <MapPin className="h-5 w-5 text-ink-3" strokeWidth={1.5} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="type-h4 truncate text-ink">{planTitle(c, styles)}</h4>
                  <p className="type-caption mt-1 flex items-center gap-1.5 text-ink-3">
                    <img
                      src={EDITOR_AVATARS[i % EDITOR_AVATARS.length]}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover"
                      loading="lazy"
                    />
                    {EDITOR_NAMES[i % EDITOR_NAMES.length]} · {days} days · {c.count} places
                  </p>
                </div>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUsePlan(c)} className="shrink-0">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Copy className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  Use
                </Button>
              </div>
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}

export default function CuratedRails({ places, cities, styles, activeCity, onUsePlan, busyCity }: RailsProps) {
  const gems = places.filter((p) => p.hidden);
  // "Hidden gems near {city}" - the active city, else the gems' modal city
  const gemCity =
    activeCity ??
    (() => {
      const counts = new Map<string, number>();
      gems.forEach((g) => counts.set(g.city, (counts.get(g.city) ?? 0) + 1));
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    })();
  const railGems = activeCity ? gems.filter((g) => g.city === activeCity) : gems;
  const shownGems = railGems.length > 0 ? railGems : gems;

  return (
    <>
      {/* ── S4.1 hidden gems rail ─────────────────────────────────────── */}
      {shownGems.length > 0 && (
        <section aria-label="Hidden gems">
          <RailHeader
            title={gemCity ? `Hidden gems near ${gemCity}` : 'Hidden gems'}
            caption="Quiet spots the crowds haven't found yet"
          />
          <SnapRail label="hidden gems">
            {shownGems.map((g) => (
              <motion.article
                key={g.id}
                whileHover={{ rotate: 1.5, y: -4 }}
                transition={{ duration: 0.18 }}
                className="relative h-[340px] w-[280px] shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-surface-2 shadow-sm"
              >
                {g.image ? (
                  <img
                    src={g.image}
                    alt={g.name}
                    loading="lazy"
                    className="photo absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <MapPin className="h-8 w-8 text-ink-3" strokeWidth={1.5} />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <h4 className="font-serif text-[20px] font-[560] leading-snug tracking-[-0.01em] text-white">
                    {g.name}
                  </h4>
                  {g.description && (
                    <p className="mt-1 line-clamp-1 text-[13px] leading-snug text-white/85">
                      {localTip(g.description)}
                    </p>
                  )}
                  <p className="type-caption mt-1.5 text-white/60">
                    {g.city}, {g.country}
                  </p>
                </div>
              </motion.article>
            ))}
          </SnapRail>
        </section>
      )}

      {/* ── S4.2 ready-made plans ─────────────────────────────────────── */}
      {cities.length > 0 && (
        <section aria-label="Ready-made plans">
          <RailHeader title="Ready-made plans" caption="City guides you can copy and make your own" />
          <SnapRail label="ready-made plans">
            {cities.map((c) => {
              const days = planDaysFor(c.count);
              const busy = busyCity === c.city;
              return (
                <article
                  key={c.city}
                  className="flex w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-all duration-fast hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="h-[150px] overflow-hidden bg-surface-2">
                    {c.image && (
                      <img src={c.image} alt={c.city} loading="lazy" className="photo h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h4 className="type-h4 text-ink">{planTitle(c, styles)}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-1 text-ink-2">
                        <MapPin className="h-3 w-3" strokeWidth={1.75} />
                        {c.count} stops
                      </span>
                      <span className="type-caption inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-1 text-ink-2">
                        <CalendarDays className="h-3 w-3" strokeWidth={1.75} />
                        {days} days
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <EditorAvatars />
                        <span className="type-caption text-ink-3">by Wayfare Editors</span>
                      </span>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUsePlan(c)} className="text-brand">
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
                        Use this plan
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </SnapRail>
        </section>
      )}
    </>
  );
}
