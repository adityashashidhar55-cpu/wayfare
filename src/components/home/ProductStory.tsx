import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Crown, Route as RouteIcon, Search } from 'lucide-react';
import { Eyebrow } from '@/components/home/Reveal';
import { useInView } from '@/hooks/useInView';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const STEPS = [
  {
    eyebrow: '01',
    title: 'Pin everything worth seeing.',
    body: 'Search once, every find lands on your map and timeline, numbered and ready.',
    caption: 'Smart place search · instant geocoding',
  },
  {
    eyebrow: '02',
    title: 'Drag your days into shape.',
    body: 'Reorder stops with a flick; walk times and pin numbers keep up on their own.',
    caption: 'Drag & drop · live travel-time chips',
  },
  {
    eyebrow: '03',
    title: 'One tap optimizes the route.',
    body: 'Voyager re-sequences your day so you spend it seeing, not backtracking.',
    caption: 'Traveling-salesman heuristic · works per day',
    crown: true,
  },
];

const STOPS = ['Kiyomizu-dera', '% Arabica', 'Fushimi Inari'];
const CHIPS = ['', '12 min', '18 min'];
const SHADOW_LG = '0 4px 12px rgba(28,25,23,.06), 0 24px 64px -16px rgba(28,25,23,.18)';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatches(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return matches;
}

/* ------------------------------------------------------------------ */
/* Code-built miniature of the workspace split view.                   */
/* ------------------------------------------------------------------ */
function MockWorkspace({ phase, auto = false }: { phase: 0 | 1 | 2; auto?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { ref: viewRef, inView } = useInView<HTMLDivElement>(0.25, true);

  useEffect(() => {
    if (auto && !inView) return; // loops only start on enter
    const root = rootRef.current;
    if (!root) return;

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(root);
      const SLOT = 60;

      const route = q('.mw-route')[0] as unknown as SVGPathElement;
      const resetAll = () => {
        q('.mw-typed').forEach((el) => (el.textContent = ''));
        gsap.set(q('.mw-placeholder'), { autoAlpha: 1 });
        gsap.set(q('.mw-result'), { autoAlpha: 0, y: 8 });
        gsap.set(q('.mw-stop'), { y: 0, scale: 1, boxShadow: '0 0 0 rgba(0,0,0,0)', zIndex: 0 });
        q('.mw-badge').forEach((el, i) => (el.textContent = String(i + 1)));
        q('.mw-pin').forEach((el, i) => (el.textContent = String(i + 1)));
        gsap.set(q('.mw-pin'), { scale: 1, autoAlpha: 1 });
        q('.mw-chip-3').forEach((el) => (el.textContent = CHIPS[2]));
        gsap.set(q('.mw-optimize'), { scale: 1, boxShadow: '0 0 0 rgba(0,0,0,0)' });
        gsap.set(q('.mw-toast'), { autoAlpha: 0, y: 16 });
        gsap.set(q('.mw-crown'), { autoAlpha: 0, scale: 0.8 });
        route.classList.add('animate-route-march');
        route.style.strokeDasharray = '6 8';
        route.style.strokeDashoffset = '0';
      };

      resetAll();

      const tl = gsap.timeline({ paused: true });
      const stops = q('.mw-stop');
      const badges = q('.mw-badge');
      const pins = q('.mw-pin');

      if (phase === 0) {
        // -- Step 1: type a search, result slides in, clay pin drops
        const text = 'Kiyomizu-dera';
        const typed = q('.mw-typed')[0];
        const proxy = { p: 0 };
        tl.to(q('.mw-placeholder'), { autoAlpha: 0, duration: 0.15 }, 0.3);
        tl.to(proxy, {
          p: 1,
          duration: text.length * 0.05,
          ease: 'none',
          onUpdate: () => {
            typed.textContent = text.slice(0, Math.round(proxy.p * text.length));
          },
        }, 0.35);
        tl.to(q('.mw-result'), { autoAlpha: 1, y: 0, duration: 0.4, ease: 'expo.out' }, '+=0.15');
        tl.fromTo(
          q('.mw-pin-1'),
          { scale: 0 },
          { keyframes: [{ scale: 1.2, duration: 0.16 }, { scale: 1, duration: 0.45, ease: 'elastic.out(1,0.45)' }] },
          '+=0.2',
        );
        tl.to(q('.mw-result'), { autoAlpha: 0, y: -6, duration: 0.3 }, '+=0.6');
      } else if (phase === 1) {
        // -- Step 2: stop 3 glides above stop 1, everything re-computes
        tl.to(stops[2], { scale: 1.02, boxShadow: SHADOW_LG, zIndex: 10, duration: 0.25, ease: 'expo.out' }, 0.2);
        tl.to(stops[2], { y: -2 * SLOT, duration: 0.55, ease: 'expo.inOut' }, '>');
        tl.to([stops[0], stops[1]], { y: SLOT, duration: 0.55, ease: 'expo.inOut' }, '<');
        tl.to(stops[2], { scale: 1, boxShadow: '0 0 0 rgba(0,0,0,0)', duration: 0.3, ease: 'expo.out' }, '>');
        tl.to(badges, { autoAlpha: 0, duration: 0.15 }, '>');
        tl.call(() => {
          const next = ['2', '3', '1'];
          badges.forEach((el, i) => (el.textContent = next[i]));
          pins.forEach((el, i) => (el.textContent = next[i]));
        });
        tl.to(badges, { autoAlpha: 1, duration: 0.15 });
        const chip = q('.mw-chip-3');
        tl.to(chip, { autoAlpha: 0, duration: 0.15 }, '<');
        tl.call(() => chip.forEach((el) => (el.textContent = '9 min')));
        tl.to(chip, { autoAlpha: 1, duration: 0.15 });
        tl.to(pins, {
          keyframes: [{ scale: 1.35, duration: 0.15 }, { scale: 1, duration: 0.3, ease: 'elastic.out(1,0.5)' }],
          stagger: 0.1,
        }, '<');
      } else {
        // -- Step 3: optimize pill presses, pins re-shuffle, route redraws
        tl.to(q('.mw-optimize'), { boxShadow: '0 0 0 8px rgba(68,96,79,0.28)', duration: 0.3, repeat: 1, yoyo: true }, 0.2);
        tl.to(q('.mw-optimize'), { scale: 0.94, duration: 0.1 }, '>');
        tl.to(q('.mw-optimize'), { scale: 1, duration: 0.3, ease: 'elastic.out(1,0.5)' }, '>');
        tl.to(q('.mw-crown'), { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, '<');
        tl.call(() => pins.forEach((el, i) => (el.textContent = String(i + 1))));
        tl.to(pins, {
          keyframes: [{ scale: 1.35, duration: 0.15 }, { scale: 1, duration: 0.3, ease: 'elastic.out(1,0.5)' }],
          stagger: 0.1,
        }, '<+0.1');
        tl.call(() => {
          route.classList.remove('animate-route-march');
          const len = route.getTotalLength();
          route.style.strokeDasharray = String(len);
          route.style.strokeDashoffset = String(len);
        });
        tl.to(route, { strokeDashoffset: 0, duration: 0.8, ease: 'expo.inOut' }, '>');
        tl.call(() => {
          route.style.strokeDasharray = '6 8';
          route.style.strokeDashoffset = '0';
          route.classList.add('animate-route-march');
        });
        tl.to(q('.mw-toast'), { autoAlpha: 1, y: 0, duration: 0.4, ease: 'expo.out' }, '>-0.15');
      }

      tl.play();

      if (auto) {
        tl.eventCallback('onComplete', () => {
          gsap.delayedCall(2.4, () => {
            resetAll();
            tl.play(0);
          });
        });
      }
    }, root);

    return () => ctx.revert();
  }, [phase, auto, inView]);

  return (
    <div ref={viewRef} className="w-full max-w-[640px]">
      <div
        ref={rootRef}
        className="flex h-[480px] w-full overflow-hidden rounded-xl border border-border bg-surface shadow-lg sm:h-[560px]"
      >
        {/* -------- timeline panel -------- */}
        <div className="flex w-[240px] shrink-0 flex-col border-r border-border bg-bg-subtle p-4 sm:w-[260px]">
          <div className="type-caption text-ink-3">DAY 2 · KYOTO</div>

          {/* search */}
          <div className="relative mt-3">
            <div className="flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
              <span className="mw-typed type-small truncate text-ink" />
              <span className="mw-caret -ml-1 h-4 w-px animate-pulse bg-brand" />
              <span className="mw-placeholder type-small absolute left-8 text-ink-3">Add a place…</span>
            </div>
            <div className="mw-result invisible absolute inset-x-0 top-11 z-10 rounded-md border border-border bg-surface p-2.5 opacity-0 shadow-md">
              <div className="type-small font-semibold text-ink">Kiyomizu-dera</div>
              <div className="type-caption text-ink-3">Temple · Higashiyama</div>
            </div>
          </div>

          {/* stops */}
          <div className="mt-4 space-y-2">
            {STOPS.map((name, i) => (
              <div
                key={name}
                className="mw-stop relative flex h-[52px] items-center gap-2.5 rounded-md border border-border/60 bg-surface px-2.5"
              >
                <span className="mw-badge flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand font-serif text-[12px] font-semibold text-white">
                  {i + 1}
                </span>
                <span className="type-small flex-1 truncate text-ink">{name}</span>
                {CHIPS[i] && (
                  <span className={cn('type-caption shrink-0 rounded-pill bg-surface-2 px-1.5 py-0.5 text-ink-3', i === 2 && 'mw-chip-3')}>
                    {CHIPS[i]}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* optimize pill */}
          <div className="mt-auto pt-4">
            <div className="mw-optimize relative flex h-10 items-center justify-center gap-2 rounded-pill bg-pine">
              <RouteIcon className="h-4 w-4 text-white" strokeWidth={1.75} />
              <span className="type-small font-semibold text-white">Optimize route</span>
              <span className="mw-crown invisible absolute -right-2 -top-2.5 flex items-center gap-1 rounded-pill bg-ochre-soft px-2 py-0.5 opacity-0">
                <Crown className="h-3 w-3 text-ochre" strokeWidth={2} />
                <span className="type-caption text-ochre">Voyager</span>
              </span>
            </div>
          </div>
        </div>

        {/* -------- map panel -------- */}
        <div className="relative flex-1 overflow-hidden">
          <svg viewBox="0 0 380 560" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <path d="M-20 400 C80 360 140 430 240 400 C320 376 360 420 420 390 L420 600 L-20 600 Z" fill="#7C8DA6" fillOpacity="0.2" />
            <ellipse cx="90" cy="120" rx="60" ry="42" fill="#44604F" fillOpacity="0.1" />
            <ellipse cx="300" cy="220" rx="44" ry="30" fill="#44604F" fillOpacity="0.08" />
            <g stroke="#8A8175" strokeOpacity="0.35" strokeWidth="5" fill="none" strokeLinecap="round">
              <path d="M-10 260 C90 230 200 290 400 240" />
              <path d="M80 -10 C100 120 70 300 40 420" />
              <path d="M230 -10 C220 140 250 320 300 430" />
              <path d="M-10 120 C120 100 260 150 400 110" />
            </g>
            <g stroke="#FFFFFF" strokeOpacity="0.8" strokeWidth="2" fill="none" strokeLinecap="round">
              <path d="M-10 260 C90 230 200 290 400 240" />
              <path d="M80 -10 C100 120 70 300 40 420" />
              <path d="M230 -10 C220 140 250 320 300 430" />
              <path d="M-10 120 C120 100 260 150 400 110" />
            </g>
            <path
              className="mw-route animate-route-march"
              d="M114 347 C150 300 160 280 182 252 C210 218 230 190 266 157"
              fill="none"
              stroke="#BC5934"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="6 8"
            />
          </svg>
          {/* pins, positioned over the svg route endpoints */}
          {[
            { cls: 'mw-pin-1', left: '30%', top: '62%' },
            { cls: 'mw-pin-2', left: '48%', top: '45%' },
            { cls: 'mw-pin-3', left: '70%', top: '28%' },
          ].map((p, i) => (
            <span
              key={p.cls}
              className={cn(
                'mw-pin absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand shadow-md ring-2 ring-surface',
                p.cls,
              )}
              style={{ left: p.left, top: p.top }}
            >
              <span className="font-serif text-[13px] font-semibold leading-none text-white">{i + 1}</span>
            </span>
          ))}
          {/* toast */}
          <div className="mw-toast invisible absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-3.5 py-2.5 opacity-0 shadow-lg">
            <span className="h-2 w-2 rounded-full bg-pine" />
            <span className="type-small font-medium text-ink">Route optimized · 46 min saved</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* S3 - pinned product story.                                          */
/* ------------------------------------------------------------------ */
export default function ProductStory() {
  const rootRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const noPreference = useMediaQuery('(prefers-reduced-motion: no-preference)');
  const pinned = isDesktop && noPreference;

  useGSAP(
    () => {
      if (!pinned || !rootRef.current) return;
      const st = ScrollTrigger.create({
        trigger: rootRef.current,
        start: 'top top',
        end: '+=220%',
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          setActiveStep(Math.min(2, Math.floor(self.progress * 3)));
        },
      });
      return () => st.kill();
    },
    { scope: rootRef, dependencies: [pinned] },
  );

  const header = (
    <div className="mb-12 max-w-[560px]">
      <Eyebrow>The workflow</Eyebrow>
      <h2 className="type-display mt-3 text-ink">Plan in flow</h2>
    </div>
  );

  if (!pinned) {
    /* -------- Fallback: stacked steps, each mock auto-loops on enter -------- */
    return (
      <section ref={rootRef} className="mx-auto max-w-[1200px] px-6 py-[72px]">
        {header}
        <div className="space-y-16">
          {STEPS.map((s, i) => (
            <div key={s.eyebrow}>
              <div className="mb-8 max-w-[560px]">
                <div className="type-eyebrow text-brand">{s.eyebrow}</div>
                <h3 className="type-h2 mt-2 text-ink">{s.title}</h3>
                <p className="type-body mt-3 text-ink-2">{s.body}</p>
                <p className="type-caption mt-3 inline-flex items-center gap-1.5 text-ink-3">
                  {s.crown && <Crown className="h-3 w-3 text-ochre" strokeWidth={2} />}
                  {s.caption}
                </p>
              </div>
              <MockWorkspace phase={(i as 0 | 1 | 2)} auto />
            </div>
          ))}
        </div>
      </section>
    );
  }

  /* -------- Pinned desktop experience -------- */
  return (
    <section ref={rootRef} className="relative">
      <div className="mx-auto flex h-[100dvh] max-w-[1200px] items-center px-6">
        <div className="grid w-full grid-cols-2 items-center gap-16">
          <div>
            {header}
            <div className="space-y-10">
              {STEPS.map((s, i) => {
                const active = activeStep === i;
                return (
                  <div
                    key={s.eyebrow}
                    className="max-w-[460px] transition-all duration-500 ease-expo"
                    style={{ opacity: active ? 1 : 0.25, transform: active ? 'translateY(0)' : 'translateY(12px)' }}
                  >
                    <div className="type-eyebrow text-brand">{s.eyebrow}</div>
                    <h3 className="type-h2 mt-2 text-ink">{s.title}</h3>
                    <p className="type-body mt-3 text-ink-2">{s.body}</p>
                    <p className="type-caption mt-3 inline-flex items-center gap-1.5 text-ink-3">
                      {s.crown && <Crown className="h-3 w-3 text-ochre" strokeWidth={2} />}
                      {s.caption}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end">
            <MockWorkspace phase={(activeStep as 0 | 1 | 2)} />
          </div>
        </div>
      </div>
    </section>
  );
}
