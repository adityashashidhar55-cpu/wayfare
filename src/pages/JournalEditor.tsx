/**
 * Journal editor (/journal/new, /journal/:id/edit) - title, multi-paragraph
 * story, cover image URL with live preview, search-as-you-type place
 * attachment over the explore corpus (removable chips), draft/published
 * toggle, save + delete-with-confirm. After save → /journal/:id.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, Bold, Heading2, Italic, Link2, List, Loader2, MapPin, Plus, Search, Trash2, WandSparkles, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { AttachedPlace, AutoAttachedPlace, PlaceSuggestion } from '@/components/journal/journal-utils';
import { readingMinutes, toAttached, wordCount } from '@/components/journal/journal-utils';
import { PlaceSuggestions } from '@/components/journal/PlaceSuggestions';

type Status = 'draft' | 'published';

const GALLERY_MAX = 8;

function EditorSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-8 md:px-6 md:py-10" aria-label="Loading editor">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="mt-8 h-10 w-2/3" />
      <Skeleton className="mt-6 h-8 w-56 rounded-pill" />
      <Skeleton className="mt-10 h-6 w-1/3" />
      <Skeleton className="mt-4 h-11 w-full" />
      <Skeleton className="mt-8 h-[320px] w-full" />
    </div>
  );
}

export default function JournalEditor() {
  const { id } = useParams();
  const postId = id ? Number(id) : null; // null → /journal/new
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const getQ = trpc.journal.get.useQuery({ id: postId ?? 0 }, { enabled: postId != null, retry: false });
  const corpusQ = trpc.explore.list.useQuery();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [gallery, setGallery] = useState<string[]>([]);
  const [galleryInput, setGalleryInput] = useState('');
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('draft');
  const [places, setPlaces] = useState<AttachedPlace[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detected, setDetected] = useState<PlaceSuggestion[]>([]);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [autoAttach, setAutoAttach] = useState(true);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const navTimer = useRef<number | null>(null);

  /* Cancel a pending post-save navigation on unmount */
  useEffect(() => () => {
    if (navTimer.current != null) window.clearTimeout(navTimer.current);
  }, []);

  /* Hydrate form state once when editing an existing entry */
  useEffect(() => {
    if (postId == null || hydrated || !getQ.data) return;
    const { post, places: attached } = getQ.data;
    setTitle(post.title);
    setContent(post.content ?? '');
    setCoverImage(post.coverImage ?? '');
    setGallery(post.gallery ?? []);
    setStatus(post.status);
    setPlaces(attached.map(toAttached));
    setHydrated(true);
  }, [postId, hydrated, getQ.data]);

  /* After save/publish: if the backend auto-attached places, note it inline
   * briefly before navigating to the entry. */
  function finishSave(path: string, autoAttached: AutoAttachedPlace[]) {
    if (autoAttached.length) {
      const names = autoAttached.slice(0, 3).map((p) => p.name).join(', ');
      const extra = autoAttached.length > 3 ? ` +${autoAttached.length - 3} more` : '';
      setAutoNote(
        `Auto-attached ${autoAttached.length} ${autoAttached.length === 1 ? 'place' : 'places'}: ${names}${extra}`,
      );
      navTimer.current = window.setTimeout(() => navigate(path), 1800);
    } else {
      navigate(path);
    }
  }

  const create = trpc.journal.create.useMutation({
    onSuccess: (d) => {
      void utils.journal.list.invalidate();
      void utils.journal.feed.invalidate();
      finishSave(`/journal/${d.id}`, d.autoAttached);
    },
    onError: (e) => setSaveError(e.message),
  });
  const update = trpc.journal.update.useMutation({
    onSuccess: (d, vars) => {
      void utils.journal.list.invalidate();
      void utils.journal.feed.invalidate();
      void utils.journal.get.invalidate({ id: vars.id });
      finishSave(`/journal/${vars.id}`, d.autoAttached);
    },
    onError: (e) => setSaveError(e.message),
  });
  const detect = trpc.journal.suggestPlaces.useMutation({
    onSuccess: (d) => {
      setDetected(d.suggestions);
      setDetectError(null);
    },
    onError: (e) => setDetectError(e.message),
  });
  const remove = trpc.journal.remove.useMutation({
    onSuccess: () => {
      void utils.journal.list.invalidate();
      void utils.journal.feed.invalidate();
      navigate('/journal');
    },
    onError: (e) => setSaveError(e.message),
  });

  const saving = create.isPending || update.isPending || autoNote != null;

  /* Search-as-you-type over the explore corpus, excluding attached places */
  const corpus = useMemo(() => corpusQ.data?.places ?? [], [corpusQ.data]);
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return corpus
      .filter((p) => !places.some((a) => a.id === p.id))
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          p.country.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [corpus, places, query]);

  function attach(p: AttachedPlace) {
    setPlaces((cur) => (cur.some((a) => a.id === p.id) ? cur : [...cur, p]));
    setQuery('');
  }

  /* ── place detection ("Detect places" + auto-attach on publish) ── */

  /** City hint for disambiguation: the most common city among attached places. */
  const cityHint = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of places) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
    let best: string | undefined;
    let bestCount = 0;
    for (const [city, count] of counts) {
      if (count > bestCount) {
        best = city;
        bestCount = count;
      }
    }
    return best;
  }, [places]);

  /* Hide suggestions for corpus places that are already attached */
  const visibleDetected = useMemo(
    () => detected.filter((s) => s.placeId == null || !places.some((a) => a.id === s.placeId)),
    [detected, places],
  );

  function runDetect() {
    setDetectError(null);
    setDetected([]);
    detect.mutate(cityHint ? { content, city: cityHint } : { content });
  }

  function dismissSuggestion(key: string) {
    const next = detected.filter((s) => s.key !== key);
    setDetected(next);
    if (!next.length) detect.reset();
  }

  function acceptSuggestion(s: PlaceSuggestion) {
    if (s.placeId != null) {
      attach({ id: s.placeId, name: s.name, city: s.city, country: s.country ?? '' });
    }
    dismissSuggestion(s.key);
  }

  function addGalleryImage() {
    const url = galleryInput.trim();
    if (!url || gallery.length >= GALLERY_MAX) return;
    if (!/^(https?:\/\/|\/)/.test(url)) {
      setGalleryError('Paste a full https:// link, or a site path starting with /.');
      return;
    }
    if (gallery.includes(url)) {
      setGalleryError('That image is already in the gallery.');
      return;
    }
    setGallery((cur) => [...cur, url]);
    setGalleryInput('');
    setGalleryError(null);
  }

  /* ── markdown toolbar helpers (insert/wrap at the textarea selection) ── */

  /** Wrap the current selection in paired markers (e.g. **bold**, *italic*). */
  function mdWrap(marker: string) {
    const el = contentRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const inner = value.slice(s, e);
    setContent(value.slice(0, s) + marker + inner + marker + value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + marker.length, s + marker.length + inner.length);
    });
  }

  /** Prefix every line touched by the selection (## heading, - bullet). */
  function mdPrefixLines(prefix: string) {
    const el = contentRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const start = value.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
    const block = value.slice(start, e);
    const replaced = block
      .split('\n')
      .map((l) => (l.startsWith(prefix) ? l : prefix + l))
      .join('\n');
    setContent(value.slice(0, start) + replaced + value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + replaced.length);
    });
  }

  /** Insert [label](url), selecting the placeholder URL for quick overwrite. */
  function mdLink() {
    const el = contentRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const label = value.slice(s, e) || 'link text';
    const inserted = `[${label}](https://)`;
    setContent(value.slice(0, s) + inserted + value.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      const urlStart = s + label.length + 3; // past "[label]("
      el.setSelectionRange(urlStart, urlStart + 'https://'.length);
    });
  }

  function save() {
    setSaveError(null);
    const base = {
      title: title.trim() || 'Untitled journal',
      content,
      gallery,
      placeIds: places.map((p) => p.id),
      status,
      autoAttach,
    };
    if (postId == null) {
      create.mutate({ ...base, coverImage: coverImage.trim() || undefined });
    } else {
      // nullable on update so clearing the field removes the cover
      update.mutate({ id: postId, ...base, coverImage: coverImage.trim() || null });
    }
  }

  const backTo = postId != null ? `/journal/${postId}` : '/journal';

  if (postId != null && getQ.isLoading) return <EditorSkeleton />;
  if (postId != null && (getQ.isError || !getQ.data || !getQ.data.isAuthor)) {
    return (
      <div className="mx-auto flex min-h-[60dvh] w-full max-w-[460px] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <img src="/empty-globe.svg" alt="" className="w-[200px] max-w-[70vw]" />
        <h2 className="type-h2 text-ink">This entry isn’t yours to edit</h2>
        <p className="type-body text-ink-2">It may have been deleted, or the link is stale.</p>
        <Button pill asChild>
          <Link to="/journal">Back to the journal</Link>
        </Button>
      </div>
    );
  }

  const statusHelp =
    status === 'draft'
      ? 'Only you can see drafts.'
      : 'Published entries appear in the Community tab.';

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-8 md:px-6 md:py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE_EXPO }}
      >
        {/* ---------- top row ---------- */}
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to={backTo}>
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {postId != null && (
              <Button variant="danger-ghost" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                Delete
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              {saving ? 'Saving…' : postId == null ? 'Save entry' : 'Save changes'}
            </Button>
          </div>
        </div>

        <h2 className="type-h1 mt-6 font-serif text-ink">
          {postId == null ? 'New journal entry' : 'Edit entry'}
        </h2>

        {/* ---------- visibility ---------- */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-pill bg-surface-2 p-1" role="radiogroup" aria-label="Visibility">
            {(['draft', 'published'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                onClick={() => setStatus(s)}
                className={cn(
                  'relative rounded-pill px-4 py-1.5 text-[13px] font-semibold capitalize transition-colors duration-fast',
                  status === s ? 'text-ink' : 'text-ink-2 hover:text-ink',
                )}
              >
                {status === s && (
                  <motion.span
                    layoutId="journal-status-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                  />
                )}
                <span className="relative z-[1]">{s}</span>
              </button>
            ))}
          </div>
          <p className="type-caption text-ink-3">{statusHelp}</p>
        </div>

        {/* ---------- title ---------- */}
        <label htmlFor="journal-title" className="type-caption mt-8 block text-ink-3">
          TITLE
        </label>
        <input
          id="journal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give your journey a title"
          maxLength={255}
          className="mt-1 w-full border-0 border-b border-border-strong bg-transparent pb-3 font-serif text-[28px] font-medium leading-snug tracking-[-0.02em] text-ink outline-none transition-colors duration-fast placeholder:text-ink-3/60 focus:border-brand"
        />

        {/* ---------- cover image ---------- */}
        <div className="mt-8">
          <label htmlFor="journal-cover" className="type-caption block text-ink-3">
            COVER IMAGE URL
          </label>
          <Input
            id="journal-cover"
            value={coverImage}
            onChange={(e) => {
              setCoverImage(e.target.value);
              setCoverBroken(false);
            }}
            placeholder="https://… (optional)"
            inputMode="url"
            className="mt-2 h-11 rounded-md border-border-strong bg-surface"
          />
          {coverImage.trim() ? (
            coverBroken ? (
              <p className="type-small mt-3 rounded-md bg-ochre-soft px-3 py-2 text-ink">
                That image URL didn’t load, check the link.
              </p>
            ) : (
              <div className="mt-3 aspect-[16/9] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-sm">
                <img
                  src={coverImage.trim()}
                  alt="Cover preview"
                  className="photo h-full w-full object-cover"
                  onError={() => setCoverBroken(true)}
                />
              </div>
            )
          ) : null}
        </div>

        {/* ---------- gallery ---------- */}
        <div className="mt-8">
          <span className="type-caption block text-ink-3">GALLERY IMAGES</span>
          <div className="mt-2 flex gap-2">
            <Input
              value={galleryInput}
              onChange={(e) => {
                setGalleryInput(e.target.value);
                setGalleryError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addGalleryImage();
                }
              }}
              placeholder={gallery.length >= GALLERY_MAX ? 'Gallery is full (8 photos)' : 'https://… or /cover-lisbon.jpg'}
              inputMode="url"
              disabled={gallery.length >= GALLERY_MAX}
              aria-label="Add a gallery image URL"
              className="h-11 rounded-md border-border-strong bg-surface"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={addGalleryImage}
              disabled={gallery.length >= GALLERY_MAX || !galleryInput.trim()}
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Add
            </Button>
          </div>
          {galleryError && (
            <p className="type-small mt-3 rounded-md bg-ochre-soft px-3 py-2 text-ink">{galleryError}</p>
          )}
          {gallery.length > 0 && (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {gallery.map((url, i) => (
                <li
                  key={`${url}-${i}`}
                  className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-surface-2 shadow-sm"
                >
                  <img src={url} alt={`Gallery image ${i + 1}`} loading="lazy" className="photo h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove image ${i + 1}`}
                    onClick={() => setGallery((cur) => cur.filter((_, j) => j !== i))}
                    className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-ink-2 opacity-0 shadow-sm transition-opacity duration-fast hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="type-caption mt-2 text-ink-3">
            <span className="tnum">{gallery.length}/{GALLERY_MAX}</span>, shown as a photo grid below your story.
          </p>
        </div>

        {/* ---------- attached places ---------- */}
        <div className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <span className="type-caption block text-ink-3">ATTACHED PLACES</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={runDetect}
              disabled={detect.isPending || !content.trim()}
              title="Detect places mentioned in your story"
            >
              {detect.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <WandSparkles className="h-4 w-4" strokeWidth={1.75} />
              )}
              {detect.isPending ? 'Detecting…' : 'Detect places'}
            </Button>
          </div>
          {places.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {places.map((p) => (
                <li
                  key={p.id}
                  className="type-small inline-flex items-center gap-1.5 rounded-pill bg-surface-2 py-1.5 pl-3 pr-1.5 text-ink"
                >
                  <MapPin className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-ink-3">· {p.city}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setPlaces((cur) => cur.filter((a) => a.id !== p.id))}
                    className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-surface hover:text-danger"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* detected-in-story suggestions (below the attached chips) */}
          <PlaceSuggestions
            suggestions={visibleDetected}
            onAccept={acceptSuggestion}
            onDismiss={dismissSuggestion}
          />
          {detect.isSuccess && detected.length === 0 && (
            <p className="type-caption mt-2 text-ink-3">
              No places detected, try naming specific spots in your story.
            </p>
          )}
          {detectError && (
            <p className="type-small mt-3 rounded-md bg-ochre-soft px-3 py-2 text-ink">{detectError}</p>
          )}

          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
              strokeWidth={1.75}
            />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => window.setTimeout(() => setPickerOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPickerOpen(false);
              }}
              placeholder="Search places to attach, try “Kiyomizu” or “Lisbon”"
              aria-label="Search places to attach"
              className="h-11 rounded-md border-border-strong bg-surface pl-9"
            />
            {pickerOpen && query.trim() && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
                {corpusQ.isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-ink-3" strokeWidth={2} />
                  </div>
                ) : suggestions.length === 0 ? (
                  <p className="type-small px-3 py-3 text-ink-3">No places match that search.</p>
                ) : (
                  <ul>
                    {suggestions.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault(); // win the race with onBlur
                            attach(toAttached(p));
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2"
                        >
                          {p.image ? (
                            <img src={p.image} alt="" className="photo h-8 w-8 shrink-0 rounded-sm object-cover" />
                          ) : (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-2">
                              <MapPin className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} />
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="type-small block truncate font-semibold text-ink">{p.name}</span>
                            <span className="type-caption block truncate text-ink-3">
                              {p.city}, {p.country}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <p className="type-caption mt-2 text-ink-3">
            Attached places appear as cards at the end of your entry.
          </p>
          <div className="mt-3 flex items-center gap-2.5">
            <Switch
              id="auto-attach"
              checked={autoAttach}
              onCheckedChange={setAutoAttach}
              aria-label="Auto-attach mentioned places when publishing"
            />
            <label htmlFor="auto-attach" className="type-small cursor-pointer text-ink-2">
              Auto-attach mentioned places when publishing
            </label>
          </div>
        </div>

        {/* ---------- story ---------- */}
        <div className="mt-8">
          <label htmlFor="journal-content" className="type-caption block text-ink-3">
            YOUR STORY
          </label>
          <div
            className="mt-2 flex items-center gap-0.5 rounded-t-md border border-b-0 border-border-strong bg-surface-2 px-2 py-1.5"
            role="toolbar"
            aria-label="Formatting"
          >
            {(
              [
                { icon: Heading2, label: 'Heading', action: () => mdPrefixLines('## ') },
                { icon: Bold, label: 'Bold', action: () => mdWrap('**') },
                { icon: Italic, label: 'Italic', action: () => mdWrap('*') },
                { icon: List, label: 'Bullet list', action: () => mdPrefixLines('- ') },
                { icon: Link2, label: 'Link', action: mdLink },
              ] as const
            ).map(({ icon: Icon, label, action }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={action}
                title={label}
                aria-label={label}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            ))}
          </div>
          <Textarea
            id="journal-content"
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            placeholder={'How did it feel to be there?\n\nWrite as many paragraphs as you like, blank lines separate them.'}
            className="min-h-[320px] rounded-md rounded-t-none border-border-strong bg-surface px-4 py-3 text-[16px] leading-7"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="type-caption text-ink-3">
              Markdown-lite: **bold**, *italic*, ## headings, - lists, [links](url)
            </p>
            <p className="type-caption tnum text-ink-3" aria-live="polite">
              {wordCount(content).toLocaleString()} {wordCount(content) === 1 ? 'word' : 'words'} ·{' '}
              {readingMinutes(content)} min read
            </p>
          </div>
        </div>

        {autoNote && (
          <p className="type-small mt-4 rounded-md bg-pine-soft px-3 py-2 text-ink" role="status">
            {autoNote}
          </p>
        )}
        {saveError && (
          <p className="type-small mt-4 rounded-md bg-ochre-soft px-3 py-2 text-ink">{saveError}</p>
        )}

        {/* ---------- footer actions ---------- */}
        <div className="mt-8 flex items-center justify-end gap-2 border-t border-border pt-6">
          <Button variant="ghost" asChild>
            <Link to={backTo}>Cancel</Link>
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            {saving ? 'Saving…' : postId == null ? 'Save entry' : 'Save changes'}
          </Button>
        </div>
      </motion.div>

      {/* ---------- delete confirm ---------- */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              “{title.trim() || 'Untitled journal'}” will be removed for good, there’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (postId != null) remove.mutate({ id: postId });
              }}
              className="bg-danger text-white hover:brightness-110"
            >
              {remove.isPending ? 'Deleting…' : 'Delete entry'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
