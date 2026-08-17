/**
 * SocialImportModal (r19-social), paste an Instagram/TikTok link OR raw
 * caption text, extract the places mentioned, review them as numbered pins
 * on a mini map, and create a routed trip from the kept ones.
 *
 * Step 1: "Paste link" (captions resolve server-side via microlink.io; every
 *         failure or login-walled platform falls back to "Paste text" with a
 *         friendly note) and "Paste text" (caption/notes + optional "Near city").
 * Step 2: review: MapLibre mini map with numbered pins + chip list
 *         (name · city · confidence dot; click toggles keep/drop, high and
 *         medium confidence kept by default).
 * Step 3: create → social.createTripFromPlaces → navigate to the trip.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import maplibregl from 'maplibre-gl';
import {
  ArrowLeft,
  Check,
  Link2,
  Loader2,
  MapPin,
  Music2,
  Sparkles,
  X,
} from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';
import { trpc } from '@/providers/trpc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { mapStyleForTheme } from '@/lib/map';
import { useIsDark } from '@/components/explore/useIsDark';
import { toast } from '@/components/explore/toast';
import { cn } from '@/lib/utils';

type ExtractOut = inferRouterOutputs<AppRouter>['social']['extractPlaces'];
type FoundPlace = ExtractOut['places'][number];
type Platform = inferRouterOutputs<AppRouter>['social']['resolveLink'] extends infer T
  ? T extends { platform: infer P }
    ? P
    : never
  : never;
type Step = 'input' | 'review' | 'creating';
type Tab = 'link' | 'text';

/** r24-social: supported-platform chips - what auto-fetches vs what needs a paste. */
const PLATFORM_CHIPS: { label: string; mode: 'auto' | 'paste' }[] = [
  { label: 'TikTok', mode: 'auto' },
  { label: 'YouTube', mode: 'auto' },
  { label: 'Reddit', mode: 'auto' },
  { label: 'Instagram', mode: 'paste' },
  { label: 'Facebook', mode: 'paste' },
];

const PIN_STYLES = `
.social-import-pin {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 999px;
  background: var(--brand); color: var(--brand-ink);
  font-size: 11px; font-weight: 700; font-family: inherit;
  border: 2px solid var(--surface); box-shadow: var(--shadow-md);
  transition: opacity 200ms ease, background 200ms ease;
}
.social-import-pin.is-dropped { background: var(--ink-3); opacity: 0.45; }
`;

const CONFIDENCE_DOT: Record<FoundPlace['confidence'], string> = {
  high: 'bg-pine',
  medium: 'bg-ochre',
  low: 'bg-ink-3',
};

/** Mini review map: numbered pins, fit-bounds, dropped pins dimmed. */
function ReviewMap({ places, dropped }: { places: FoundPlace[]; dropped: Set<number> }) {
  const isDark = useIsDark();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  // Create once (style fixed at mount; the modal is short-lived).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleForTheme(isDark),
      center: [20, 30],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => setReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins + bounds follow the places and the keep/drop state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.resize();
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = places.map((p, i) => {
      const el = document.createElement('div');
      el.className = cn('social-import-pin', dropped.has(i) && 'is-dropped');
      el.textContent = String(i + 1);
      return new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    });
    if (places.length) {
      const bounds = new maplibregl.LngLatBounds();
      places.forEach((p) => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 400 });
    }
  }, [ready, places, dropped]);

  return (
    <>
      <style>{PIN_STYLES}</style>
      <div ref={containerRef} className="h-52 w-full overflow-hidden rounded-xl border border-border md:h-64" />
    </>
  );
}

export interface SocialImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SocialImportModal({ open, onOpenChange }: SocialImportModalProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [step, setStep] = useState<Step>('input');
  const [tab, setTab] = useState<Tab>('link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [hintCity, setHintCity] = useState('');
  const [busy, setBusy] = useState<null | 'resolve' | 'extract'>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  /** r24-social: true once an IG/FB link hit the login wall - the paste
   *  caption view replaces the tabs so the textarea is front and center. */
  const [pasteFirst, setPasteFirst] = useState<null | 'instagram' | 'facebook'>(null);
  const [caption, setCaption] = useState<{
    text: string;
    author: string | null;
    thumbnailUrl: string | null;
    platform: Platform;
  } | null>(null);
  const [result, setResult] = useState<ExtractOut | null>(null);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [opening, setOpening] = useState(false);
  const createTrip = trpc.social.createTripFromPlaces.useMutation();

  // Fresh state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setStep('input');
    setTab('link');
    setUrl('');
    setText('');
    setHintCity('');
    setBusy(null);
    setLinkNote(null);
    setPasteFirst(null);
    setCaption(null);
    setResult(null);
    setDropped(new Set());
    setOpening(false);
  }, [open]);

  const runExtract = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    setBusy('extract');
    try {
      const res = await utils.client.social.extractFromText.query({
        text: t,
        hintCity: hintCity.trim() || undefined,
      });
      setResult(res);
      // High confidence starts kept. Non-high candidates pinned outside the
      // caption's dominant city (classic geocode false positive, e.g. "Inari"
      // from "Fushimi Inari" landing in Finland) start dropped, as do lows.
      const domCity = (res.dominantCity ?? '').split(',')[0].trim().toLowerCase();
      const drop = new Set<number>();
      res.places.forEach((p, i) => {
        const city = (p.city ?? '').split(',')[0].trim().toLowerCase();
        const cityMismatch =
          domCity !== '' && city !== '' && city !== domCity && !domCity.includes(city) && !city.includes(domCity);
        const wildGeocode = p.source === 'geocode' && city === ''; // pin with no locality at all
        if (p.confidence === 'low' || (p.confidence !== 'high' && (cityMismatch || wildGeocode))) drop.add(i);
      });
      setDropped(drop);
      setStep('review');
    } catch {
      toast('Could not extract places, please try again.', { kind: 'warn' });
    } finally {
      setBusy(null);
    }
  };

  const runResolve = async () => {
    const u = url.trim();
    if (!u || busy) return;
    setBusy('resolve');
    setLinkNote(null);
    try {
      const res = await utils.client.social.resolveLink.query({ url: u });
      if (res.ok) {
        setCaption({ text: res.text, author: res.author, thumbnailUrl: res.thumbnailUrl, platform: res.platform });
        setText(res.text);
        await runExtract(res.text);
      } else if (res.platform === 'instagram' || res.platform === 'facebook') {
        // Login-walled: drop the tabs, put the caption box front and center.
        setPasteFirst(res.platform);
        setLinkNote(null);
        setTab('text');
      } else {
        setLinkNote(
          res.reason === 'login-wall'
            ? "That platform locks its posts, so we can't read the caption. Paste the caption text and we'll map it."
            : res.reason === 'no-caption-found'
              ? "We couldn't find a caption on that page, paste the caption or your notes instead."
              : "We couldn't reach that link just now, paste the caption or your notes instead.",
        );
        setTab('text');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setLinkNote(
        msg.includes('valid link')
          ? "That doesn't look like a valid link, check it, or paste the caption text instead."
          : "We couldn't reach that link just now, paste the caption or your notes instead.",
      );
      setTab('text');
    } finally {
      setBusy(null);
    }
  };

  const kept = result ? result.places.filter((_, i) => !dropped.has(i)) : [];

  const togglePlace = (i: number) => {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const runCreate = () => {
    if (!kept.length || createTrip.isPending) return;
    setStep('creating');
    createTrip.mutate(
      {
        placeIds: kept.filter((p) => p.placeId != null).map((p) => p.placeId!),
        extraPlaces: kept
          .filter((p) => p.placeId == null)
          .map((p) => ({
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            city: p.city || undefined,
            country: p.country || undefined,
          })),
      },
      {
        onSuccess: (res) => {
          void utils.trips.list.invalidate();
          setOpening(true);
          window.setTimeout(() => {
            onOpenChange(false);
            navigate(`/trips/${res.tripId}`);
          }, 600);
        },
        onError: (err) => {
          setStep('review');
          if (err.message === 'UPGRADE_REQUIRED') {
            toast('You’ve hit the free trip limit, upgrade to Voyager for unlimited trips.', { kind: 'warn' });
          } else {
            toast('Could not create the trip, please try again.', { kind: 'warn' });
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={step !== 'creating'}
        className={cn(
          'flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-xl border-border bg-surface p-0 shadow-lg',
          'w-[calc(100vw-2rem)] max-w-[640px]',
        )}
      >
        <DialogHeader className="border-b border-border px-6 py-5 text-left">
          <DialogTitle className="type-h3 text-ink">
            {step === 'input' && 'Import from social'}
            {step === 'review' && `${result?.places.length ?? 0} places found`}
            {step === 'creating' && (opening ? 'Opening your trip…' : 'Creating your trip…')}
          </DialogTitle>
          <DialogDescription className="type-small mt-1 text-ink-3">
            {step === 'input' && 'Paste a social link or the caption text, and we’ll find the places.'}
            {step === 'review' && 'Tap a place to keep or drop it. We route the kept ones into a trip.'}
            {step === 'creating' && 'Ordering your stops with the route optimizer.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 'input' ? (
            <div className="space-y-4">
              {/* supported platforms: explicit auto-fetch vs paste-caption */}
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Supported platforms">
                {PLATFORM_CHIPS.map((c) => (
                  <span
                    key={c.label}
                    className={cn(
                      'type-caption inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 font-medium',
                      c.mode === 'auto'
                        ? 'border-pine/30 bg-pine-soft text-pine'
                        : 'border-ochre/30 bg-ochre-soft text-ochre',
                    )}
                  >
                    {c.label}
                    <span className="font-normal opacity-80">{c.mode === 'auto' ? '· auto-fetch' : '· paste caption'}</span>
                  </span>
                ))}
              </div>

              {pasteFirst ? (
                /* IG/FB login wall: the caption box IS the view, no tabs. */
                <div className="space-y-3">
                  <div className="rounded-xl border border-ochre/30 bg-ochre-soft px-4 py-3.5">
                    <p className="type-small font-semibold text-ink">
                      {pasteFirst === 'instagram' ? 'Instagram' : 'Facebook'} locks its posts
                    </p>
                    <p className="type-small mt-1 text-ink-2">
                      We can't read {pasteFirst === 'instagram' ? 'Instagram' : 'Facebook'} captions directly,
                      nobody can from the outside. Paste the caption or the list of places from the post
                      below and we'll map them for you.
                    </p>
                  </div>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste the caption here, e.g. “Day 2 in Kyoto: Fushimi Inari at sunrise, then Kinkaku-ji, coffee at % Arabica…”"
                    aria-label="Caption text"
                    rows={8}
                    autoFocus
                    className="rounded-xl text-[15px] leading-relaxed"
                  />
                  <p className="type-caption text-ink-3">
                    Tip: on the post, tap ⋯ then “Copy caption” (or copy the text out of a screenshot).
                  </p>
                  <Input
                    value={hintCity}
                    onChange={(e) => setHintCity(e.target.value)}
                    placeholder="Near city (optional), e.g. Kyoto"
                    aria-label="Near city"
                    className="h-11 rounded-xl"
                  />
                  <Button
                    size="lg"
                    pill
                    className="w-full"
                    disabled={!text.trim() || busy != null}
                    onClick={() => void runExtract(text)}
                  >
                    {busy === 'extract' ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <MapPin className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    {busy === 'extract' ? 'Finding places…' : 'Find places in this caption'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPasteFirst(null)}
                    className="type-caption mx-auto block text-ink-3 underline-offset-2 transition-colors hover:text-ink hover:underline"
                  >
                    Try a different link instead
                  </button>
                </div>
              ) : (
              <>
              {/* tabs */}
              <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
                {(
                  [
                    { id: 'link', label: 'Paste link', icon: Link2 },
                    { id: 'text', label: 'Paste text', icon: Sparkles },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'type-small flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors',
                      tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
                    )}
                  >
                    <t.icon className="h-4 w-4" strokeWidth={1.75} />
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'link' ? (
                <div className="space-y-3">
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runResolve();
                    }}
                    placeholder="https://www.tiktok.com/@wanderer/video/…"
                    inputMode="url"
                    aria-label="Social link"
                    className="h-12 rounded-xl"
                  />
                  <Button
                    size="lg"
                    pill
                    className="w-full"
                    disabled={!url.trim() || busy != null}
                    onClick={() => void runResolve()}
                  >
                    {busy === 'resolve' || busy === 'extract' ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Link2 className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    {busy === 'extract' ? 'Finding places…' : busy === 'resolve' ? 'Resolving link…' : 'Resolve link'}
                  </Button>
                  <p className="type-caption text-ink-3">
                    TikTok, YouTube and Reddit links resolve automatically (can take a few seconds).
                    Instagram and Facebook lock their posts, paste the caption text for those.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {linkNote ? (
                    <p className="type-small rounded-xl bg-ochre-soft px-4 py-3 text-ink-2">{linkNote}</p>
                  ) : null}
                  {caption ? (
                    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
                      {caption.thumbnailUrl ? (
                        <img
                          src={caption.thumbnailUrl}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                          <Music2 className="h-5 w-5" strokeWidth={1.75} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="type-caption text-ink-3">
                          {caption.platform === 'other'
                            ? 'Resolved from your link'
                            : `Resolved from ${caption.platform[0]!.toUpperCase()}${caption.platform.slice(1)}`}
                          {caption.author ? ` · @${caption.author}` : ''}
                        </p>
                        <p className="type-small line-clamp-2 text-ink">{caption.text}</p>
                      </div>
                    </div>
                  ) : null}
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste the caption, comment or your notes…"
                    aria-label="Caption text"
                    rows={5}
                    className="rounded-xl"
                  />
                  <Input
                    value={hintCity}
                    onChange={(e) => setHintCity(e.target.value)}
                    placeholder="Near city (optional), e.g. Kyoto"
                    aria-label="Near city"
                    className="h-11 rounded-xl"
                  />
                  <Button
                    size="lg"
                    pill
                    className="w-full"
                    disabled={!text.trim() || busy != null}
                    onClick={() => void runExtract(text)}
                  >
                    {busy === 'extract' ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <MapPin className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    {busy === 'extract' ? 'Finding places…' : 'Find places'}
                  </Button>
                </div>
              )}
              </>
              )}
            </div>
          ) : null}

          {step === 'review' && result ? (
            <div className="space-y-4">
              {result.places.length ? (
                <ReviewMap places={result.places} dropped={dropped} />
              ) : (
                <p className="type-small rounded-xl bg-surface-2 px-4 py-6 text-center text-ink-3">
                  No places recognized, try adding a “Near city” hint or more place names.
                </p>
              )}
              {result.places.length ? (
                <ul className="space-y-2">
                  {result.places.map((p, i) => {
                    const keptHere = !dropped.has(i);
                    return (
                      <li key={`${p.name}-${i}`}>
                        <button
                          type="button"
                          onClick={() => togglePlace(i)}
                          aria-pressed={keptHere}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-fast',
                            keptHere
                              ? 'border-border bg-surface hover:border-border-strong'
                              : 'border-border/60 bg-surface-2 opacity-60 hover:opacity-80',
                          )}
                        >
                          <span
                            className={cn(
                              'type-caption flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-bold',
                              keptHere ? 'bg-brand text-brand-ink' : 'bg-surface text-ink-3 ring-1 ring-border',
                            )}
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                            <span className="type-caption block truncate text-ink-3">
                              {[p.city, p.country].filter(Boolean).join(', ') || 'Pinned from the web'}
                              {p.source === 'geocode' ? ' · via map search' : ''}
                            </span>
                          </span>
                          <span
                            className={cn('h-2.5 w-2.5 shrink-0 rounded-full', CONFIDENCE_DOT[p.confidence])}
                            title={`${p.confidence} confidence`}
                          />
                          {keptHere ? (
                            <Check className="h-4 w-4 shrink-0 text-pine" strokeWidth={2} />
                          ) : (
                            <X className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {result.unmatched.length ? (
                <p className="type-caption text-ink-3">
                  Not recognized: {result.unmatched.join(', ')}
                </p>
              ) : null}
              <div className="flex items-center gap-2 pt-1">
                <Button variant="ghost" size="lg" onClick={() => setStep('input')}>
                  <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
                  Back
                </Button>
                <Button size="lg" pill className="flex-1" disabled={!kept.length} onClick={runCreate}>
                  <MapPin className="h-4 w-4" strokeWidth={1.75} />
                  Create trip from {kept.length} {kept.length === 1 ? 'place' : 'places'}
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'creating' ? (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-brand" strokeWidth={1.75} />
              <p className="type-small text-ink-2">
                {opening ? 'Opening your trip…' : 'Routing your stops…'}
              </p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SocialImportModal;
