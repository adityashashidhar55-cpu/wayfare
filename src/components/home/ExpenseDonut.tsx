import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

const DONUT_DATA = [
  { name: 'Food', value: 420, color: '#C97F45' },
  { name: 'Lodging', value: 380, color: '#7C8DA6' },
  { name: 'Transport', value: 210, color: '#6E9A8B' },
  { name: 'Activities', value: 160, color: '#A86B8C' },
];

/**
 * r21-perf: recharts is heavy, so the landing donut lives in its own chunk
 * and is lazy-loaded by FeatureBento only once the card scrolls into view.
 */
export default function ExpenseDonut() {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={DONUT_DATA}
          dataKey="value"
          innerRadius="62%"
          outerRadius="88%"
          startAngle={90}
          endAngle={-270}
          strokeWidth={0}
          isAnimationActive
          animationDuration={600}
          animationEasing="ease-out"
        >
          {DONUT_DATA.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
