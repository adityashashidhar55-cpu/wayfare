import { Link } from 'react-router';
import { ArrowRight, Check, Crown } from 'lucide-react';
import { Eyebrow, Reveal } from '@/components/home/Reveal';
import { cn } from '@/lib/utils';

const FREE_ROWS = ['3 collaborators per trip', 'Core maps & itinerary', 'Expense splitting', 'Explore basics'];
const VOYAGER_ROWS = ['Unlimited collaborators', 'Optimize route', 'Flight & hotel email import', 'Offline maps', 'PDF itineraries'];

function Row({ children, pine = false }: { children: string; pine?: boolean }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full', pine ? 'bg-pine-soft text-pine' : 'bg-surface-2 text-ink-3')}>
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
      <span className="type-body text-ink-2">{children}</span>
    </li>
  );
}

/** S6 - Pricing teaser. */
export default function PricingTeaser() {
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
      <Reveal className="mx-auto mb-12 max-w-[640px] text-center">
        <Eyebrow>Pricing</Eyebrow>
        <h2 className="type-display mt-3 text-ink">Free to wander. Voyager to fly.</h2>
      </Reveal>

      <div className="mx-auto grid max-w-[880px] grid-cols-1 gap-6 md:grid-cols-2">
        {/* Wanderer */}
        <Reveal delay={0}>
          <div className="flex h-full flex-col rounded-xl border border-border bg-surface p-8 shadow-sm">
            <div className="type-eyebrow text-ink-3">Wayfare Wanderer</div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="type-numeral text-[44px] leading-none text-ink">$0</span>
              <span className="type-small text-ink-3">forever</span>
            </div>
            <p className="type-small mt-2 text-ink-3">For spontaneous weekends</p>
            <ul className="mt-6 flex-1 space-y-3">
              {FREE_ROWS.map((r) => (
                <Row key={r}>{r}</Row>
              ))}
            </ul>
            <Link
              to="/login"
              className="type-body mt-8 inline-flex h-12 items-center justify-center rounded-md border border-border-strong bg-surface font-medium text-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-surface-2 hover:shadow-md active:scale-[0.97]"
            >
              Create an itinerary
            </Link>
          </div>
        </Reveal>

        {/* Voyager */}
        <Reveal delay={0.12}>
          <div className="relative flex h-full flex-col rounded-xl border border-brand bg-brand-soft p-8 shadow-md animate-breathe">
            <span className="type-caption absolute -top-3 left-8 inline-flex items-center gap-1.5 rounded-pill bg-ochre px-3 py-1 font-semibold text-white shadow-sm">
              <Crown className="h-3 w-3" strokeWidth={2} />
              Most loved
            </span>
            <div className="type-eyebrow text-brand">Wayfare Voyager</div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="type-numeral text-[44px] leading-none text-ink">$39.99</span>
              <span className="type-small text-ink-3">/yr</span>
            </div>
            <p className="type-small mt-2 text-ink-3">$3.33/mo billed yearly</p>
            <ul className="mt-6 flex-1 space-y-3">
              {VOYAGER_ROWS.map((r) => (
                <Row key={r} pine>
                  {r}
                </Row>
              ))}
            </ul>
            <Link
              to="/pricing"
              className="btn-sheen type-body mt-8 inline-flex h-12 items-center justify-center rounded-pill bg-brand font-semibold text-brand-ink shadow-md transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-lg active:scale-[0.97]"
            >
              Go Voyager
            </Link>
          </div>
        </Reveal>
      </div>

      <Reveal className="mt-8 text-center" delay={0.2}>
        <Link
          to="/pricing"
          className="type-body group inline-flex items-center gap-1.5 font-medium text-brand transition-colors hover:text-brand-strong"
        >
          Full comparison on the pricing page
          <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={1.75} />
        </Link>
      </Reveal>
    </section>
  );
}
