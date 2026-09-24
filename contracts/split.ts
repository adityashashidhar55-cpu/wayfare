/**
 * r34: unequal expense splits.
 *
 * Every split used to be equal - the "Exact" and "Percent" buttons in the
 * expense form showed a "coming soon" toast. Both reduce to the same thing:
 * shares proportional to a weight per member (exact amounts are weights, and
 * so are percentages). This turns weights into integer cents that always sum
 * to the total, using largest-remainder rounding so no cent is lost or
 * invented and the rounding goes to whoever was closest to the next cent.
 */
export type SplitWeight = { memberId: number; weight: number };
export type SplitShare = { memberId: number; shareCents: number };

export function splitByWeights(totalCents: number, weights: SplitWeight[]): SplitShare[] {
  const valid = weights.filter((w) => Number.isFinite(w.weight) && w.weight > 0);
  const sum = valid.reduce((a, w) => a + w.weight, 0);
  if (!valid.length || sum <= 0) return [];
  const raw = valid.map((w) => ({ memberId: w.memberId, exact: (totalCents * w.weight) / sum }));
  const out = raw.map((r) => ({ memberId: r.memberId, shareCents: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let left = totalCents - out.reduce((a, o) => a + o.shareCents, 0);
  const order = [...out.keys()].sort((a, b) => out[b]!.frac - out[a]!.frac || a - b);
  for (const i of order) {
    if (left <= 0) break;
    out[i]!.shareCents += 1;
    left -= 1;
  }
  return out.map(({ memberId, shareCents }) => ({ memberId, shareCents }));
}

/** Equal split with the same rounding guarantee. */
export function splitEqually(totalCents: number, memberIds: number[]): SplitShare[] {
  return splitByWeights(totalCents, memberIds.map((memberId) => ({ memberId, weight: 1 })));
}
