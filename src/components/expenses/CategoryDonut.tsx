import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney } from '@contracts/fx';
import { cn } from '@/lib/utils';
import { categoryMeta } from './utils';

export interface DonutDatum {
  category: string;
  cents: number;
}

/** Extract the category from a recharts pie entry (shape varies by version). */
function entryCategory(d: unknown): string {
  const rec = d as { category?: string; payload?: { category?: string } } | undefined;
  return rec?.category ?? rec?.payload?.category ?? '';
}

/** Glass chart tooltip (expenses.md §S2). */
function DonutTooltip({
  active,
  payload,
  currency,
  total,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: { category?: string } }>;
  currency: string;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!;
  const label = categoryMeta(entryCategory(p) || String(p.name ?? '')).label;
  const pct = total > 0 ? Math.round(((p.value ?? 0) / total) * 100) : 0;
  return (
    <div className="glass rounded-md border border-border px-3 py-2 shadow-md">
      <div className="type-small font-semibold text-ink">{label}</div>
      <div className="type-caption tnum text-ink-2">
        {formatMoney(p.value ?? 0, currency)} · {pct}%
      </div>
    </div>
  );
}

/**
 * "Where it went" - 220px category donut (40px thickness, rounded caps) with
 * right-side legend. Hovering legend/arcs dims the rest (opacity .3, 200ms);
 * clicking a segment or legend row cross-filters the ledger.
 */
export function CategoryDonut({
  data,
  currency,
  expenseCount,
  size = 220,
  selected,
  onSelect,
}: {
  data: DonutDatum[];
  currency: string;
  expenseCount: number;
  size?: number;
  selected: string | null;
  onSelect?: (category: string | null) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = useMemo(() => data.reduce((s, d) => s + d.cents, 0), [data]);
  const thickness = Math.round(size * 0.18);
  const outer = Math.floor(size / 2) - 4;
  const inner = outer - thickness;

  const dimFor = (category: string): number => {
    if (hovered) return hovered === category ? 1 : 0.3;
    if (selected) return selected === category ? 1 : 0.45;
    return 1;
  };

  return (
    <div className="flex flex-col items-center gap-6 min-[560px]:flex-row min-[560px]:gap-8">
      {/* Donut with center label */}
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<DonutTooltip currency={currency} total={total} />} />
            <Pie
              data={data}
              dataKey="cents"
              nameKey="category"
              innerRadius={inner}
              outerRadius={outer}
              cornerRadius={thickness / 2}
              paddingAngle={data.length > 1 ? 2 : 0}
              startAngle={90}
              endAngle={-270}
              isAnimationActive
              animationDuration={700}
              animationEasing="ease-out"
              strokeWidth={0}
              onMouseEnter={(d) => setHovered(entryCategory(d))}
              onMouseLeave={() => setHovered(null)}
              onClick={(d) => {
                const cat = entryCategory(d);
                if (cat && onSelect) onSelect(selected === cat ? null : cat);
              }}
              style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}
            >
              {data.map((d) => (
                <Cell
                  key={d.category}
                  fill={categoryMeta(d.category).color}
                  fillOpacity={dimFor(d.category)}
                  style={{ transition: 'fill-opacity 200ms ease', outline: 'none' }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-[20px] font-semibold leading-6 text-ink">
            {formatMoney(total, currency)}
          </span>
          <span className="type-caption mt-1 text-ink-3">
            {expenseCount} expense{expenseCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Legend */}
      <ul className="w-full min-w-0 flex-1 space-y-1">
        {data.map((d) => {
          const meta = categoryMeta(d.category);
          const Icon = meta.icon;
          const pct = total > 0 ? Math.round((d.cents / total) * 100) : 0;
          const isActive = selected === d.category;
          return (
            <li key={d.category}>
              <button
                type="button"
                onClick={() => onSelect?.(isActive ? null : d.category)}
                onMouseEnter={() => setHovered(d.category)}
                onMouseLeave={() => setHovered(null)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-all duration-fast',
                  'hover:bg-surface-2',
                  isActive && 'bg-surface-2',
                )}
                style={{ opacity: dimFor(d.category) === 0.3 ? 0.45 : 1, transition: 'opacity 200ms ease, background-color 180ms ease' }}
                aria-pressed={isActive}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm"
                  style={{ background: `color-mix(in srgb, ${meta.color} 16%, transparent)`, color: meta.color }}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <span className="type-small min-w-0 flex-1 truncate text-ink">{meta.label}</span>
                <span className="type-small tnum shrink-0 font-semibold text-ink">
                  {formatMoney(d.cents, currency)}
                </span>
                <span className="type-caption tnum w-9 shrink-0 text-right text-ink-3">{pct}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
