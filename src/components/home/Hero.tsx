import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Upload } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';
import { useAuth } from '@/hooks/useAuth';
import {
  DEFAULT_PROMPT,
  extractDestinationHint,
  saveImportRequest,
  savePlanPrompt,
} from '@/lib/plan-prompt';
import tourVideo from '@/assets/wayfare-tour.mp4';

/**
 * r23 landing hero: full-bleed video under a white top-gradient, typewriter
 * wordmark, centered uppercase nav, and a liquid-glass prompt card whose
 * text is editable. "Plan My Trip" hands the prompt to the existing
 * create-trip flow (sessionStorage bridges the login redirect); the upload
 * button deep-links into the existing social-import modal on /trips.
 */

const NAV_BTN =
  'cursor-pointer border-none bg-transparent font-sans text-[15px] font-medium uppercase tracking-[0.04em] text-wayfare-text transition-opacity hover:opacity-55';

const PILL_BTN =
  'rounded-full bg-wayfare-dark px-5 py-3.5 font-sans text-[15px] font-medium uppercase tracking-[0.04em] text-[#fafafa] transition-all hover:bg-[#333] active:scale-95';

/** Auto-growing textarea that stays visually identical to the spec text. */
function PromptEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(autosize, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Describe your trip"
      spellCheck={false}
      rows={2}
      className="mb-[100px] ml-[29px] mt-[57px] block w-[609px] resize-none break-words rounded-lg bg-transparent font-sans text-xl font-medium leading-relaxed text-wayfare-prompt outline-none transition-shadow focus:ring-1 focus:ring-wayfare-text/25 max-md:mt-[40px] max-md:w-[calc(100%-58px)] max-md:text-[17px]"
    />
  );
}

export default function Hero() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading, logout } = useAuth({ redirectPath: '/' });
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

  /* Hands the prompt to the create-trip flow. Logged-in users deep-link
     straight into the modal; logged-out users hit the /trips auth guard,
     sign in, and the stashed prompt resumes the flow on the other side. */
  const planMyTrip = () => {
    const text = prompt.trim();
    if (text) savePlanPrompt(text);
    const hint = text ? extractDestinationHint(text) : undefined;
    const params = new URLSearchParams({ new: '1' });
    if (hint) params.set('dest', hint);
    navigate(`/trips?${params.toString()}`);
  };

  /* Social import lives on /trips; the flag re-opens it after login. */
  const openImport = () => {
    saveImportRequest();
    navigate('/trips?import=1');
  };

  const scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="relative min-h-svh w-full overflow-hidden">
      {/* Background video: Wayfare's existing local tour asset */}
      <video
        src={tourVideo}
        autoPlay
        muted
        loop
        playsInline
        aria-label="Wayfare tour video: a quick montage of itineraries, maps and budgets"
        className="absolute inset-0 z-0 h-full w-full object-cover"
      />
      {/* Top white gradient so the nav + headline read over the video */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[687px]"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)',
        }}
      />

      <div className="relative z-[2] mx-auto max-w-[1360px]">
        {/* ------------------------------- Nav ------------------------------- */}
        <nav className="relative flex items-center justify-between px-20 pb-4 pt-6 max-md:px-6 max-md:pt-5" aria-label="Primary">
          <span className="select-none font-display text-[40px] leading-none text-black max-md:text-[32px]">
            wayfare
          </span>

          <div className="absolute left-1/2 flex -translate-x-1/2 gap-8 max-md:hidden">
            <button type="button" className={NAV_BTN} onClick={() => navigate('/explore')}>
              Discover
            </button>
            <button type="button" className={NAV_BTN} onClick={scrollToFeatures}>
              Features
            </button>
            <button type="button" className={NAV_BTN} onClick={() => navigate('/trips')}>
              Trips
            </button>
          </div>

          <div className="flex items-center gap-8">
            {isLoading ? null : isAuthenticated ? (
              <>
                <span className="max-md:hidden" aria-label={user?.name ?? 'Account'}>
                  <UserAvatar name={user?.name} avatar={user?.avatar} className="h-9 w-9" />
                </span>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="cursor-pointer border-none bg-transparent font-sans text-[15px] font-semibold uppercase tracking-[0.04em] text-[#292929] transition-opacity hover:opacity-55 max-md:hidden"
                >
                  Log out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="cursor-pointer border-none bg-transparent font-sans text-[15px] font-semibold uppercase tracking-[0.04em] text-[#292929] transition-opacity hover:opacity-55 max-md:hidden"
              >
                Login
              </button>
            )}
            <button type="button" className={PILL_BTN} onClick={planMyTrip}>
              Plan My Trip
            </button>
          </div>
        </nav>

        {/* ----------------------------- Hero body ----------------------------- */}
        <div className="flex flex-col items-center px-6 pb-24 pt-16 text-center">
          <h1 className="mb-5 max-w-[820px] font-sans text-[clamp(40px,6vw,68px)] font-medium leading-[1.05] tracking-[-0.04em] text-wayfare-text">
            Where will you go next?
          </h1>
          <p className="mb-10 max-w-[500px] text-xl font-medium leading-relaxed text-wayfare-muted">
            Tell our AI where you're going and what you love. We'll create a personalized
            itinerary for you.
          </p>

          {/* Liquid glass prompt card */}
          <div className="relative min-h-[208px] w-[701px] overflow-hidden rounded-[44px] border-[3px] border-white bg-white/[0.06] shadow-[0_0_4px_0_rgba(0,0,0,0.15)] backdrop-blur-[20px] max-md:w-[calc(100vw-48px)]">
            <PromptEditor value={prompt} onChange={setPrompt} />

            <button
              type="button"
              aria-label="Upload inspiration"
              onClick={openImport}
              className="absolute left-[21px] top-[137px] flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-transparent backdrop-blur-[14px] transition-transform hover:scale-105"
            >
              <Upload className="h-[18px] w-[18px] text-wayfare-text" />
            </button>

            <button
              type="button"
              onClick={planMyTrip}
              className="absolute bottom-[21px] right-[21px] h-14 w-[156px] rounded-[44px] bg-black font-sans text-base font-medium uppercase tracking-[0.02em] text-[#fafafa] transition-all hover:bg-[#333] active:scale-95"
            >
              Plan My Trip
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
