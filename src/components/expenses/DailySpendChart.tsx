import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { formatMoney } from '@contracts/fx';
import { dayColor } from '@/lib/map';
import { parseDay, todayISO, useIsDark } from './utils';

export interface DailyDatum {
  date: string;
  dayIndex: number; // 1-based trip day
  cents: number;
}

function PaceTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyDatum; value?: number }>;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload!;
  return (
    <div className="glass rounded-md border border-border px-3 py-2 shadow-md">
      <div className="type-small font-semibold text-ink">
        {format(parseDay(d.date), 'EEE, MMM d')} · Day {d.dayIndex}
      </div>
      <div className="type-caption tnum text-ink-2">{formatMoney(d.cents, currency)}</div>
    </div>
  );
}

/**
 * "Pace" - daily spend bars (expenses.md §S2). Day-color at reduced intensity,
 * today at full saturation; ochre dashed reference line = daily budget average.
 * Click a bar to cross-filter the ledger by date.
 */
export function DailySpendChart({
  data,
  currency,
  dailyBudgetCents,
  selectedDate,
  onSelect,
}: {
  data: DailyDatum[];
  currency: string;
  dailyBudgetCents: number | null;
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const isDark = useIsDark();
  const today = todayISO();

  const chartData = useMemo(() => data, [data]);

  const barFill = (d: DailyDatum): string => {
    const base = dayColor(d.dayIndex, isDark);
    const full = d.date === today || hovered === d.date || selectedDate === d.date;
    return full ? base : `color-mix(in srgb, ${base} 55%, var(--surface-2))`;
  };

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="28%">
          <XAxis
            dataKey="date"
            tickFormatter={(iso: string) => format(parseDay(iso), 'MMM d')}
            tick={{ fontSize: 11, fill: 'var(--ink-3)', fontWeight: 500 }}
            axisLine={{ stroke: 'var(--border-strong)' }}
            tickLine={false}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--ink-3)', fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => formatMoney(v, currency).replace(/\.00$/, '')}
            width={52}
          />
          <Tooltip content={<PaceTooltip currency={currency} />} cursor={{ fill: 'var(--surface-2)' }} />
          {dailyBudgetCents != null && dailyBudgetCents > 0 && (
            <ReferenceLine
              y={dailyBudgetCents}
              stroke="var(--ochre)"
              strokeDasharray="5 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
            />
          )}
          <Bar
            dataKey="cents"
            radius={[6, 6, 0, 0]}
            isAnimationActive
            animationDuration={500}
            animationEasing="ease-out"
            onMouseEnter={(d) => setHovered(String((d as unknown as DailyDatum).date))}
            onMouseLeave={() => setHovered(null)}
            onClick={(d) => {
              const date = String((d as unknown as DailyDatum).date);
              onSelect(selectedDate === date ? null : date);
            }}
            style={{ cursor: 'pointer' }}
          >
            {chartData.map((d) => (
              <Cell key={d.date} fill={barFill(d)} style={{ transition: 'fill 200ms ease' }} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
