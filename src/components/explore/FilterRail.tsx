/**
 * Explore filter rail (explore.md §S2) - sticky under the top bar, glass on
 * scroll: category chips, budget multi-select, "Near …" city popover, sort
 * menu, and an active-filters summary caption. Changes FLIP the grid.
 */
import { useEffect, useState } from 'react';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { CATEGORY_FILTERS } from '@/components/explore/explore-utils';
import type { ExploreCity } from '@/components/explore/explore-utils';

export type SortId = 'match' | 'rating' | 'hidden';

export const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: 'match', label: 'Best match' },
  { id: 'rating', label: 'Top rated' },
  { id: 'hidden', label: 'Hidden gems first' },
];

function RailChip({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'type-small inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 transition-colors duration-fast',
        selected
          ? 'border-brand bg-brand font-semibold text-brand-ink'
          : 'border-border-strong bg-surface text-ink-2 hover:border-brand/50 hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface FilterRailProps {
  category: string;
  onCategory: (id: string) => void;
  budgets: number[];
  onToggleBudget: (level: number) => void;
  city: string | null;
  onCity: (city: string | null) => void;
  cities: ExploreCity[];
  sort: SortId;
  onSort: (s: SortId) => void;
}

export default function FilterRail({
  category,
  onCategory,
  budgets,
  onToggleBudget,
  city,
  onCity,
  cities,
  sort,
  onSort,
}: FilterRailProps) {
  const [scrolled, setScrolled] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const activeCount =
    (category !== 'all' ? 1 : 0) + budgets.length + (city ? 1 : 0) + (sort !== 'match' ? 1 : 0);

  return (
    <div
      className={cn(
        'sticky top-16 z-30 mt-8 transition-all [transition-duration:250ms]',
        scrolled ? 'glass-strong border-b border-border shadow-sm' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex max-w-[1200px] items-center gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] sm:px-6 lg:px-10 [&::-webkit-scrollbar]:hidden">
        {CATEGORY_FILTERS.map((c) => (
          <RailChip key={c.id} selected={category === c.id} onClick={() => onCategory(c.id)}>
            {c.label}
          </RailChip>
        ))}

        <span className="mx-1 h-5 w-px shrink-0 bg-border-strong" aria-hidden />

        {[1, 2, 3].map((level) => (
          <RailChip
            key={level}
            selected={budgets.includes(level)}
            onClick={() => onToggleBudget(level)}
            className="tnum"
          >
            {'$'.repeat(level)}
          </RailChip>
        ))}

        <span className="mx-1 h-5 w-px shrink-0 bg-border-strong" aria-hidden />

        {/* location / distance chip */}
        <Popover open={cityOpen} onOpenChange={setCityOpen}>
          <PopoverTrigger asChild>
            <span>
              <RailChip selected={city != null} onClick={() => setCityOpen(true)}>
                <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />
                {city ? `Near ${city}` : 'Anywhere'}
              </RailChip>
            </span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 rounded-lg p-2">
            <p className="type-caption px-2 pb-1 pt-1.5 text-ink-3">NEAR CITY</p>
            <ul className="max-h-64 overflow-y-auto">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onCity(null);
                    setCityOpen(false);
                  }}
                  className="type-small flex w-full items-center justify-between rounded-md px-2 py-2 text-left font-semibold text-ink transition-colors duration-fast hover:bg-surface-2"
                >
                  Anywhere
                  {city == null && <Check className="h-4 w-4 text-brand" strokeWidth={2} />}
                </button>
              </li>
              {cities.map((c) => (
                <li key={c.city}>
                  <button
                    type="button"
                    onClick={() => {
                      onCity(c.city);
                      setCityOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="type-small block truncate font-semibold text-ink">{c.city}</span>
                      <span className="type-caption block text-ink-3">
                        {c.country} · {c.count} places
                      </span>
                    </span>
                    {city === c.city && <Check className="h-4 w-4 shrink-0 text-brand" strokeWidth={2} />}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

        <span className="mx-1 h-5 w-px shrink-0 bg-border-strong" aria-hidden />

        {/* sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span>
              <RailChip selected={sort !== 'match'}>
                {SORT_OPTIONS.find((o) => o.id === sort)?.label}
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              </RailChip>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {SORT_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.id} onClick={() => onSort(o.id)} className="flex items-center justify-between">
                {o.label}
                {sort === o.id && <Check className="h-4 w-4 text-brand" strokeWidth={2} />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="type-caption ml-auto shrink-0 pl-3 text-ink-3">
          {activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? '' : 's'}` : ''}
        </span>
      </div>
    </div>
  );
}
