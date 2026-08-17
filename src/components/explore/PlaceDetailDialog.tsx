/**
 * Place detail popover (explore.md §S3, 480px): bigger photo, description,
 * "Why you'll like it" match bullets, a static styled map mini-peek, and
 * actions (Add to trip / Save / View on map).
 *
 * r11-journal additions: verdict chip ("can it be skipped?"), closure banner
 * + user closure reports, "Where to eat nearby" for non-food places, and the
 * community comments section (list + composer + delete).
 */
import { useEffect, useState } from 'react';
import {
  AlertOctagon,
  Bookmark,
  Flag,
  Gem,
  Hourglass,
  MapPin,
  MessageSquare,
  Send,
  Sparkles,
  Star,
  Ticket,
  Trash2,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { formatMoney, formatMoneyCompact } from '@contracts/fx';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { placeImageFor, poolImageFor } from '@/lib/place-images';
import { dietBadge } from '@/lib/diet';
import { closedLabel, useDietBadgeFn, verdictChip } from '@/lib/place-meta';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { toast } from '@/components/explore/toast';
import FamousPickBadge from '@/components/explore/FamousPickBadge';
import NarrationControl from '@/components/explore/NarrationControl';
import SocialLinksSection from '@/components/explore/SocialLinksSection';
import { AddToTripButton } from '@/components/explore/PlaceCard';
import type { AddedInfo } from '@/components/explore/PlaceCard';
import type { ExplorePlaceItem } from '@/components/explore/explore-utils';
import { categoryLabel, styleMeta } from '@/components/explore/explore-utils';

/** Static styled SVG map peek (design: "map mini-peek, static styled SVG"). */
function MiniMapPeek({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 440 132"
      className="h-[132px] w-full rounded-md"
      role="img"
      aria-label={`Map peek of ${name}`}
    >
      <rect width="440" height="132" rx="8" fill="var(--bg-subtle)" />
      {/* water */}
      <path d="M0 96 C70 84 130 108 210 100 C300 90 360 110 440 98 L440 132 L0 132 Z" fill="#DCE9E8" className="dark:opacity-20" />
      {/* park */}
      <ellipse cx="88" cy="42" rx="52" ry="26" fill="#E3EBDD" className="dark:opacity-15" />
      {/* roads */}
      <g stroke="var(--surface)" strokeWidth="5" strokeLinecap="round">
        <path d="M-8 60 C90 52 200 74 448 44" />
        <path d="M60 -8 C70 40 58 92 74 140" />
        <path d="M240 -8 C232 44 252 96 244 140" />
        <path d="M360 -8 C368 40 352 92 366 140" />
      </g>
      {/* dashed route to the pin */}
      <path
        d="M40 110 C120 92 190 82 268 58"
        fill="none"
        stroke="var(--brand)"
        strokeWidth="2.5"
        strokeDasharray="1.5 7"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* pin */}
      <g transform="translate(268 58)">
        <circle r="14" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2.5" />
        <circle r="4" fill="var(--brand-ink)" />
        <circle r="22" fill="none" stroke="var(--brand)" strokeOpacity="0.35" strokeWidth="2" />
      </g>
    </svg>
  );
}

interface PlaceDetailDialogProps {
  place: ExplorePlaceItem | null;
  saved: boolean;
  /** user's budget band from explore.list preferences - drives the budget bullet */
  budgetBand?: string | null;
  onClose: () => void;
  onToggleSave: (place: ExplorePlaceItem) => void;
  onViewOnMap: (place: ExplorePlaceItem) => void;
}

export default function PlaceDetailDialog({
  place,
  saved,
  budgetBand,
  onClose,
  onToggleSave,
  onViewOnMap,
}: PlaceDetailDialogProps) {
  const [added, setAdded] = useState<AddedInfo | null>(null);
  /** own photo → deterministic tag-pool photo → gradient/pin placeholder */
  const img = place ? placeImageFor(place) : null;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgLoaded = img != null && loadedSrc === img;

  const meQ = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();

  /* ── r11: closures, nearby eats, comments ── */
  const placeId = place?.id ?? 0;
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState('');
  /** optimistic override so the banner updates before the list refetches */
  const [reported, setReported] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  /** full story vs ~4-line clamp (long descriptions only) */
  const [storyOpen, setStoryOpen] = useState(false);

  const nearbyFoodQ = trpc.explore.nearbyFood.useQuery(
    { placeId },
    { enabled: place != null && place.category !== 'food' },
  );
  const commentsQ = trpc.explore.placeComments.useQuery({ placeId }, { enabled: place != null });
  const dietBadgeFn = useDietBadgeFn();

  const reportClosed = trpc.explore.reportClosed.useMutation({
    onSuccess: (d) => {
      setReported(d.closedStatus === 'open' ? null : d.closedStatus);
      setReportOpen(false);
      setReportNote('');
      toast(
        d.closedStatus === 'open' ? 'Thanks, marked as open again' : 'Thanks, closure reported',
        { kind: 'success' },
      );
      void utils.explore.list.invalidate();
    },
    onError: (e) => toast(e.message, { kind: 'warn' }),
  });
  const addComment = trpc.explore.addPlaceComment.useMutation({
    onSuccess: () => {
      setCommentDraft('');
      void utils.explore.placeComments.invalidate({ placeId });
    },
    onError: (e) => toast(e.message, { kind: 'warn' }),
  });
  const deleteComment = trpc.explore.deletePlaceComment.useMutation({
    onSuccess: () => void utils.explore.placeComments.invalidate({ placeId }),
    onError: (e) => toast(e.message, { kind: 'warn' }),
  });

  /** Own submission still waiting for admin validation → ochre "Pending review" badge */
  const pendingMine =
    place != null && !place.approved && place.addedById != null && place.addedById === meQ.data?.id;

  /** Food places: small diet badge from tags/name ("Pure veg" / "Vegan options" / "Veg-friendly") */
  const diet = place ? dietBadge(place) : null;

  /* reset per-place local state when the dialog moves to another place */
  useEffect(() => {
    setAdded(null);
    setReported(null);
    setReportOpen(false);
    setReportNote('');
    setCommentDraft('');
    setStoryOpen(false);
  }, [placeId]);

  const verdict = verdictChip(place?.verdict);
  const closed = closedLabel(reported ?? place?.closedStatus);
  const comments = commentsQ.data?.comments ?? [];
  const isAdmin = meQ.data?.role === 'admin';
  const eats = nearbyFoodQ.data?.places ?? [];

  function handleAdded(info: AddedInfo) {
    setAdded(info);
    toast(`Added to ${info.tripTitle} · ${info.dayLabel}`, { kind: 'success' });
  }

  function submitReport(status: 'temporarily_closed' | 'permanently_closed' | 'open') {
    reportClosed.mutate({ placeId, status, note: reportNote.trim() || undefined });
  }

  const bullets: string[] = [];
  if (place) {
    for (const s of place.matchStyles.slice(0, 2)) {
      bullets.push(`Matches your ${styleMeta(s).taste} taste`);
    }
    if (!place.aboveBudget && budgetBand) bullets.push(`Fits your ${budgetBand} budget`);
    if (place.hidden) bullets.push('A hidden gem, most travelers walk right past');
    if ((place.rating ?? 0) >= 4.7) bullets.push(`Top rated in ${place.city}`);
    if (bullets.length === 0) bullets.push(`A ${categoryLabel(place).toLowerCase()} stop in ${place.city}`);
  }

  // Costs block: researched values show as-is; modeled values (notes start
  // with "Avg") get an ≈ prefix and an "(avg)" label so users know it's an estimate.
  const priceCurrency = place?.feeCurrency ?? 'USD';
  const feeEstimated = (place?.feeNote ?? '').startsWith('Avg');
  const hasFee = place != null && (place.feeCents != null || place.feeNote != null);
  const hasMeal = place != null && place.mealCents != null;
  const hasCosts = hasFee || hasMeal;

  return (
    <Dialog
      open={place != null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="w-[calc(100vw-32px)] max-w-[480px] overflow-hidden rounded-xl p-0">
        {place && (
          <div className="max-h-[85dvh] overflow-y-auto">
            <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
              {img ? (
                <img
                  src={img}
                  alt={place.name}
                  loading="lazy"
                  onError={e => {
                    if (!place) return;
                    const fb = poolImageFor(place);
                    const el = e.currentTarget;
                    if (fb && el.src !== fb) { el.src = fb; setLoadedSrc(fb); }
                    else el.style.display = 'none';
                  }}
                  onLoad={() => setLoadedSrc(img)}
                  className={cn(
                    'photo h-full w-full object-cover transition-opacity duration-500',
                    imgLoaded ? 'opacity-100' : 'opacity-0',
                  )}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <MapPin className="h-8 w-8 text-ink-3" strokeWidth={1.5} />
                </div>
              )}

              {/* r25: photo credit. Wikimedia/Wikipedia images are mostly
                  CC-BY-SA, which requires crediting the author wherever the
                  image appears. We were storing photoAttribution and never
                  showing it. Only rendered for a real photo of this place -
                  the stock-pool fallback is a generic image of somewhere else
                  and must never carry a credit implying otherwise. */}
              {place.photoSource && place.photoAttribution && imgLoaded && (
                <figcaption
                  className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-1.5 pt-6"
                  title={place.photoAttribution}
                >
                  <span className="type-caption line-clamp-1 text-[10px] text-white/75">
                    {place.photoAttribution}
                  </span>
                </figcaption>
              )}
              <span className="glass type-caption absolute left-4 top-4 rounded-pill px-2.5 py-1 text-ink">
                {categoryLabel(place)}
              </span>
              {(place.hidden || pendingMine || diet || place.famousEatery) && (
                <div className="absolute bottom-4 left-4 flex items-center gap-1.5">
                  {place.famousEatery && <FamousPickBadge />}
                  {diet && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-pine-soft px-2.5 py-1 text-[11px] font-semibold text-pine">
                      🌱 {diet.label}
                    </span>
                  )}
                  {place.hidden && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 text-[11px] font-semibold text-ochre">
                      <Gem className="h-3 w-3" strokeWidth={1.75} />
                      Hidden gem
                    </span>
                  )}
                  {pendingMine && (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-ochre-soft px-2.5 py-1 text-[11px] font-semibold text-ochre">
                      <Hourglass className="h-3 w-3" strokeWidth={1.75} />
                      Pending review
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* reported closure banner */}
            {closed && (
              <p className={cn('flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold', closed.bannerClass)}>
              <AlertOctagon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {closed.banner}
              </p>
            )}

            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="type-h3 text-ink">{place.name}</h3>
                  <p className="type-caption mt-0.5 text-ink-3">
                    {place.city}, {place.country}
                  </p>
                  {verdict && (
                    <span
                      className={cn(
                        'mt-1.5 inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold',
                        verdict.className,
                      )}
                      title={verdict.title}
                    >
                      {verdict.label}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {(place.rating != null || place.priceLevel != null) && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1">
                      {place.rating != null && (
                        <>
                          <Star className="h-3.5 w-3.5 fill-ochre text-ochre" strokeWidth={1.75} />
                          <span className="type-small tnum font-semibold text-ink">{place.rating.toFixed(1)}</span>
                        </>
                      )}
                      {place.priceLevel != null && (
                        <span className="type-small text-ink-3">
                          {place.rating != null ? '· ' : ''}
                          {'$'.repeat(Math.max(1, place.priceLevel))}
                        </span>
                      )}
                    </span>
                  )}
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1"
                    title={`${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`}
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                    <span className="type-small tnum font-semibold text-ink">{comments.length}</span>
                  </span>
                </div>
              </div>

              {/* r21-detail: prominent Listen control by the place name -
                  server-generated MP3 with SpeechSynthesis fallback */}
              <div className="mt-3">
                <NarrationControl
                  placeId={place.id}
                  placeName={place.name}
                  description={place.description}
                />
              </div>

              {place.description && (
                <div className="mt-3">
                  <p
                    className={cn(
                      'type-body text-ink-2',
                      !storyOpen && place.description.length > 300 && 'line-clamp-4',
                    )}
                  >
                    {place.description}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {place.description.length > 300 && (
                      <button
                        type="button"
                        onClick={() => setStoryOpen((o) => !o)}
                        className="type-small font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
                      >
                        {storyOpen ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* why you'll like it */}
              <div className="mt-4 rounded-lg bg-surface-2 p-3.5">
                <p className="type-eyebrow text-pine">Why you&rsquo;ll like it</p>
                <ul className="mt-2 space-y-1.5">
                  {bullets.map((b) => (
                    <li key={b} className="type-small flex items-start gap-2 text-ink-2">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pine" strokeWidth={1.75} />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>

              {/* budget honesty */}
              {place.aboveBudget && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-ochre-soft px-3.5 py-2.5 text-[13px] font-medium text-ochre">
                  <Wallet className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Pricier than your budget, save it for a splurge day
                </p>
              )}

              {/* costs, admission (researched or avg estimate) + avg meal */}
              {hasCosts && (
                <div className="mt-3 space-y-2 rounded-lg border border-border px-3.5 py-2.5">
                  {hasFee && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="type-small inline-flex shrink-0 items-center gap-1.5 font-medium text-ink-2">
                        <Ticket className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
                        Admission{feeEstimated ? ' (avg)' : ''}
                      </span>
                      <span className="min-w-0 text-right">
                        <span
                          className={cn(
                            'type-small tnum font-semibold',
                            place.feeCents != null && place.feeCents > 0 ? 'text-ink' : 'text-pine',
                          )}
                        >
                          {place.feeCents != null
                            ? place.feeCents > 0
                              ? `${feeEstimated ? '≈ ' : ''}${formatMoney(place.feeCents, priceCurrency)}`
                              : 'Free entry'
                            : 'See official site'}
                        </span>
                        {place.feeNote && (
                          <span className="type-caption mt-0.5 block truncate text-ink-3">{place.feeNote}</span>
                        )}
                      </span>
                    </div>
                  )}
                  {hasMeal && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="type-small inline-flex shrink-0 items-center gap-1.5 font-medium text-ink-2">
                        <UtensilsCrossed className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
                        Meal (avg)
                      </span>
                      <span className="type-small tnum font-semibold text-ink">
                        ≈ {formatMoney(place.mealCents!, priceCurrency)} pp
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* where to eat nearby (non-food places) */}
              {place.category !== 'food' && (
                <div className="mt-4">
                  <p className="type-eyebrow text-pine">Where to eat nearby</p>
                  {nearbyFoodQ.isLoading ? (
                    <p className="type-caption mt-2 text-ink-3">Finding nearby spots…</p>
                  ) : eats.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {eats.map((f) => {
                        const badges = dietBadgeFn?.(f) ?? [];
                        return (
                          <li
                            key={f.id}
                            className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                          >
                            <UtensilsCrossed className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                            <span className="min-w-0 flex-1">
                              <span className="type-small block truncate font-semibold text-ink">{f.name}</span>
                              <span className="type-caption text-ink-3">
                                {f.distanceM < 1000 ? `${f.distanceM} m` : `${(f.distanceM / 1000).toFixed(1)} km`}
                                {f.rating != null && (
                                  <>
                                    {' · '}
                                    <span className="tnum">★ {f.rating.toFixed(1)}</span>
                                  </>
                                )}
                                {f.closedStatus === 'temporarily_closed' && ' · temporarily closed'}
                              </span>
                            </span>
                            {badges.slice(0, 2).map((b) => (
                              <span
                                key={b}
                                className="shrink-0 rounded-pill bg-pine-soft px-1.5 py-0.5 text-[10px] font-semibold text-pine"
                              >
                                {b}
                              </span>
                            ))}
                            {f.mealCents != null && (
                              <span className="type-caption tnum shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 font-semibold text-ink-2">
                                ≈ {formatMoneyCompact(f.mealCents, f.feeCurrency ?? 'USD')}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="type-caption mt-2 text-ink-3">
                      No food spots in the atlas within a short walk yet.
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => onViewOnMap(place)}
                className="group relative mt-4 block w-full text-left"
                aria-label="View on map"
              >
                <MiniMapPeek name={place.name} />
                <span className="glass type-caption absolute bottom-2.5 right-2.5 rounded-pill px-2.5 py-1 text-ink transition-colors duration-fast group-hover:text-brand">
                  View on map
                </span>
              </button>

              {/* r21-detail: outbound social search links (TikTok/IG/YouTube/Reddit/Maps) */}
              <SocialLinksSection name={place.name} city={place.city} country={place.country} />

              <div className="mt-5 flex items-center gap-2">
                <AddToTripButton place={place} added={added} onAdded={handleAdded} className="flex-1" />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onToggleSave(place)}
                  className={cn(saved && 'border-brand text-brand')}
                >
                  <Bookmark className={cn('h-4 w-4', saved && 'fill-brand text-brand')} strokeWidth={1.75} />
                  {saved ? 'Saved' : 'Save'}
                </Button>
              </div>

              {/* report a closure */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setReportOpen((o) => !o)}
                  className="type-caption inline-flex items-center gap-1.5 text-ink-3 transition-colors duration-fast hover:text-ink"
                >
                  <Flag className="h-3 w-3" strokeWidth={1.75} />
                  {closed ? 'Update closure status' : 'Report a closure'}
                </button>
                {reportOpen && (
                  <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={reportClosed.isPending}
                        onClick={() => submitReport('temporarily_closed')}
                      >
                        Temporarily closed
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={reportClosed.isPending}
                        onClick={() => submitReport('permanently_closed')}
                      >
                        Permanently closed
                      </Button>
                      {closed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reportClosed.isPending}
                          onClick={() => submitReport('open')}
                        >
                          Open again
                        </Button>
                      )}
                    </div>
                    <input
                      value={reportNote}
                      onChange={(e) => setReportNote(e.target.value)}
                      maxLength={280}
                      placeholder="Note for other travelers (optional)"
                      className="type-small w-full rounded-md border border-border bg-surface px-2.5 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* comments */}
              <div className="mt-5 border-t border-border pt-4">
                <p className="type-eyebrow text-pine">
                  Comments{comments.length > 0 ? ` · ${comments.length}` : ''}
                </p>
                {commentsQ.isLoading ? (
                  <p className="type-caption mt-2 text-ink-3">Loading comments…</p>
                ) : comments.length > 0 ? (
                  <ul className="mt-2 space-y-2.5">
                    {comments.map((c) => (
                      <li key={c.id} className="group flex items-start gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="type-caption text-ink-3">
                            <span className="font-semibold text-ink-2">{c.userName}</span>
                            {' · '}
                            {new Date(c.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                          <span className="type-small mt-0.5 block whitespace-pre-wrap text-ink-2">{c.text}</span>
                        </span>
                        {(c.mine || isAdmin) && (
                          <button
                            type="button"
                            aria-label="Delete comment"
                            title="Delete comment"
                            disabled={deleteComment.isPending}
                            onClick={() => deleteComment.mutate({ id: c.id })}
                            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity duration-fast hover:text-danger group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="type-caption mt-2 text-ink-3">No comments yet, be the first.</p>
                )}
                {meQ.data ? (
                  <div className="mt-3 flex items-start gap-2">
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      rows={2}
                      maxLength={1000}
                      placeholder="Share a tip or a heads-up…"
                      className="type-small min-h-[38px] flex-1 resize-none rounded-md border border-border bg-surface px-2.5 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
                    />
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label="Post comment"
                      title="Post comment"
                      disabled={!commentDraft.trim() || addComment.isPending}
                      onClick={() => addComment.mutate({ placeId, text: commentDraft.trim() })}
                    >
                      <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                ) : (
                  <p className="type-caption mt-3 text-ink-3">Sign in to leave a comment.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
