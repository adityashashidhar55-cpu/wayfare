import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { Bookmark, MapPin, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { BucketListItem } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PLACE_THUMBS, thumbFor } from '@/components/trips/utils';
import { cn } from '@/lib/utils';

type Tab = 'places' | 'cities';

/** Segmented tabs (design.md §10.4): active pill slides via layoutId. */
function SegmentedTabs({
  tab,
  onChange,
  places,
  cities,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  places: number;
  cities: number;
}) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'places', label: `Places (${places})` },
    { key: 'cities', label: `Cities (${cities})` },
  ];
  return (
    <div className="inline-flex rounded-pill bg-surface-2 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'relative rounded-pill px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-fast',
            tab === t.key ? 'text-ink' : 'text-ink-2 hover:text-ink',
          )}
        >
          {tab === t.key && (
            <motion.span
              layoutId="bucket-tab-pill"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className="absolute inset-0 rounded-pill bg-surface shadow-sm"
            />
          )}
          <span className="relative z-[1]">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function BucketCard({
  item,
  onRemove,
  removing,
}: {
  item: BucketListItem;
  onRemove: () => void;
  removing: boolean;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="[perspective:900px]">
      <motion.div
        animate={{ rotateY: confirming ? 180 : 0 }}
        transition={{ duration: 0.2 }}
        className="relative h-[240px] [transform-style:preserve-3d]"
      >
        {/* Front */}
        <div className="group absolute inset-0 overflow-hidden rounded-lg border border-border bg-surface shadow-sm [backface-visibility:hidden]">
          <div className="relative aspect-[4/3] overflow-hidden">
            <img
              src={item.image ?? thumbFor(item.name)}
              alt=""
              style={{ transition: 'transform 600ms var(--ease-expo)' }}
              className="photo h-full w-full object-cover group-hover:scale-[1.045]"
            />
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={() => setConfirming(true)}
              className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/70 text-[#1C1917] opacity-0 backdrop-blur-md transition-all duration-fast hover:bg-white/90 group-hover:opacity-100 max-md:opacity-100"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => navigate(`/trips?new=1&dest=${encodeURIComponent(item.name)}`)}
              className="type-caption absolute inset-x-3 bottom-2.5 translate-y-2 rounded-pill bg-brand py-1.5 font-semibold text-brand-ink opacity-0 shadow-md transition-all duration-base ease-expo hover:bg-brand-strong group-hover:translate-y-0 group-hover:opacity-100"
            >
              Plan a trip
            </button>
          </div>
          <div className="px-3.5 pt-3">
            <h4 className="truncate text-[14px] font-semibold leading-[20px] text-ink">{item.name}</h4>
            <p className="type-caption mt-1 inline-flex items-center gap-1 text-ink-3">
              <MapPin className="h-3 w-3" strokeWidth={1.75} />
              <span className="truncate">{item.country ?? 'Anywhere'}</span>
            </p>
          </div>
        </div>

        {/* Back, inline remove confirm */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-lg border border-danger/40 bg-surface p-4 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <p className="type-small text-ink">
            Remove <span className="font-semibold">{item.name}</span> from your bucket list?
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button size="sm" variant="destructive" disabled={removing} onClick={onRemove}>
              {removing ? 'Removing…' : 'Yes, remove'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Bucket list management (profile §S4): Places/Cities segmented tabs, compact
 * cards with flip-to-confirm removal, add-place dialog → explore.addBucket.
 */
export function BucketListSection({ items }: { items: BucketListItem[] }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>('places');
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [note, setNote] = useState('');
  const [image, setImage] = useState<string>(PLACE_THUMBS[0]);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const citiesQ = trpc.explore.cities.useQuery();

  const addBucket = trpc.explore.addBucket.useMutation({
    onSuccess: () => {
      utils.explore.bucketList.invalidate();
      setAddOpen(false);
      setName('');
      setCountry('');
      setNote('');
      toast.success('Saved to your bucket list');
    },
    onError: (e) => toast.error(e.message),
  });
  const removeBucket = trpc.explore.removeBucket.useMutation({
    onSuccess: () => {
      utils.explore.bucketList.invalidate();
      setRemovingId(null);
      toast.success('Removed from bucket list');
    },
    onError: (e) => {
      setRemovingId(null);
      toast.error(e.message);
    },
  });

  const byCountry = useMemo(() => {
    const map = new Map<string, BucketListItem[]>();
    for (const it of items) {
      const key = it.country ?? 'Anywhere';
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  return (
    <section id="bucket" aria-label="Bucket list" className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="type-h3 text-ink">Bucket list</h3>
          <SegmentedTabs tab={tab} onChange={setTab} places={items.length} cities={byCountry.length} />
        </div>
        <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add place
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center">
          <img src="/empty-globe.svg" alt="" className="w-[160px]" />
          <p className="type-small text-ink-2">Save places from Explore with the bookmark.</p>
          <Button variant="ghost" size="sm" onClick={() => navigate('/explore')}>
            <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
            Browse Explore
          </Button>
        </div>
      ) : tab === 'places' ? (
        <div className="grid gap-4 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-4">
          {items.map((item) => (
            <BucketCard
              key={item.id}
              item={item}
              removing={removingId === item.id}
              onRemove={() => {
                setRemovingId(item.id);
                removeBucket.mutate({ id: item.id });
              }}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-4">
          {byCountry.map(([country, list]) => (
            <div key={country} className="rounded-lg border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h4 className="type-h4 truncate text-ink">{country}</h4>
                <span className="type-caption tnum rounded-pill bg-brand-soft px-2 py-0.5 font-semibold text-brand">
                  {list.length}
                </span>
              </div>
              <p className="type-caption mt-1 truncate text-ink-3">{list.map((i) => i.name).join(' · ')}</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 -ml-2"
                onClick={() => navigate(`/trips?new=1&dest=${encodeURIComponent(country === 'Anywhere' ? list[0]?.name ?? '' : country)}`)}
              >
                Plan a trip
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add place dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="rounded-xl sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="type-h3">Save a place</DialogTitle>
            <DialogDescription className="type-small text-ink-2">
              Somewhere you’ve heard about and can’t stop thinking about.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              addBucket.mutate({
                name: name.trim(),
                country: country.trim() || undefined,
                note: note.trim() || undefined,
                image,
              });
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="bucket-name" className="type-caption mb-1.5 block text-ink-3">
                Place name
              </label>
              <Input
                id="bucket-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tainan tea houses"
                maxLength={255}
                className="h-11 rounded-md border-border-strong bg-surface"
              />
            </div>
            <div>
              <label htmlFor="bucket-country" className="type-caption mb-1.5 block text-ink-3">
                Country (optional)
              </label>
              <Input
                id="bucket-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Japan"
                maxLength={255}
                list="bucket-country-options"
                className="h-11 rounded-md border-border-strong bg-surface"
              />
              <datalist id="bucket-country-options">
                {[...new Set((citiesQ.data ?? []).map((c) => c.country))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <span className="type-caption mb-1.5 block text-ink-3">Thumbnail</span>
              <div className="grid grid-cols-4 gap-2">
                {PLACE_THUMBS.slice(0, 4).map((src) => (
                  <button
                    key={src}
                    type="button"
                    aria-pressed={image === src}
                    onClick={() => setImage(src)}
                    className={cn(
                      'aspect-square overflow-hidden rounded-md transition-all duration-fast',
                      image === src ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : 'hover:opacity-90',
                    )}
                  >
                    <img src={src} alt="" className="photo h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || addBucket.isPending}>
                {addBucket.isPending ? 'Saving…' : 'Save place'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
