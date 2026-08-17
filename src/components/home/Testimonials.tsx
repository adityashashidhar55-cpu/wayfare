import { Star } from 'lucide-react';
import { Eyebrow, Reveal } from '@/components/home/Reveal';
import { cn } from '@/lib/utils';

const QUOTES = [
  { q: 'I planned 10 days in Japan in one evening. My friends think I hired a travel agent.', name: 'Maya R.', trip: 'Kyoto', avatar: '/avatar-1.png' },
  { q: 'The expense splitting alone saved a friendship.', name: 'Daniel K.', trip: 'Lisbon', avatar: '/avatar-2.png' },
  { q: 'Wanderlog felt like a spreadsheet. This feels like a journal.', name: 'Priya S.', trip: 'Oaxaca', avatar: '/avatar-3.png' },
  { q: 'Optimize route is the closest thing to magic I have seen in an app.', name: 'Leo M.', trip: 'Amalfi', avatar: '/avatar-4.png' },
  { q: 'We landed in Marrakech with zero plans and left with the best week of our year.', name: 'Sofia A.', trip: 'Marrakech', avatar: '/avatar-5.png' },
  { q: 'Finally an app where the map and the plan are the same thing.', name: 'James T.', trip: 'Patagonia', avatar: '/avatar-6.png' },
  { q: 'Our group trip stopped being forty-seven group-chat threads.', name: 'Maya R.', trip: 'Reykjavik', avatar: '/avatar-1.png' },
  { q: 'The quietest, calmest piece of software I use. And the most useful.', name: 'Daniel K.', trip: 'Copenhagen', avatar: '/avatar-2.png' },
];

function QuoteCard({ q, name, trip, avatar }: { q: string; name: string; trip: string; avatar: string }) {
  return (
    <figure className="w-[380px] shrink-0 rounded-lg border border-border bg-surface p-7 shadow-sm">
      <div className="mb-3 flex gap-0.5" aria-label="5 out of 5 stars">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="h-3.5 w-3.5 fill-ochre text-ochre" />
        ))}
      </div>
      <blockquote className="serif-em text-[15px] leading-6 text-ink">“{q}”</blockquote>
      <figcaption className="mt-4 flex items-center gap-2.5">
        <img src={avatar} alt="" className="h-7 w-7 rounded-full object-cover ring-2 ring-surface" />
        <span className="type-small text-ink">{name}</span>
        <span className="type-caption text-ink-3">· {trip}</span>
      </figcaption>
    </figure>
  );
}

function MarqueeRow({ quotes, reverse = false }: { quotes: typeof QUOTES; reverse?: boolean }) {
  const doubled = [...quotes, ...quotes];
  return (
    <div className="marquee-mask group overflow-hidden">
      <div
        className={cn(
          'flex w-max gap-6 pr-6 group-hover:[animation-play-state:paused]',
          reverse ? 'animate-marquee-reverse' : 'animate-marquee',
        )}
      >
        {doubled.map((t, i) => (
          <QuoteCard key={`${t.name}-${i}`} {...t} />
        ))}
      </div>
    </div>
  );
}

/** S5 - Testimonials marquee (two rows, opposite directions, pause on hover). */
export default function Testimonials() {
  return (
    <section className="border-y border-border bg-bg-subtle py-24">
      <Reveal className="mx-auto mb-12 max-w-[640px] px-6 text-center">
        <Eyebrow>Word of mouth</Eyebrow>
        <h2 className="type-display mt-3 text-ink">Travelers who plan less, wander more.</h2>
      </Reveal>
      <div className="space-y-6">
        <MarqueeRow quotes={QUOTES.slice(0, 4)} />
        <MarqueeRow quotes={QUOTES.slice(4)} reverse />
      </div>
    </section>
  );
}
