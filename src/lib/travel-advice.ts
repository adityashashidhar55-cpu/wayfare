/**
 * travel-advice.ts (r24-core, feature L step 7) - pure rules engine producing
 * advisory "smart trade-off" cards for the trip wizard. No I/O, no imports
 * beyond types - fully unit tested.
 *
 * `premium` flags rules that become Voyager-gated in Wave 3; for now every
 * card is shown to all users and the flag is metadata only.
 */

export interface AdviceDestination {
  city: string;
  country: string;
}

export interface AdviceContext {
  destinations: AdviceDestination[];
  /** trip length in days (1+ once dates are picked; 0 = unknown) */
  days: number;
  /** intercity moves; defaults to max(0, destinations.length - 1) */
  intercityLegs?: number;
  budgetCents?: number | null;
  budgetCurrency?: string;
  intent?: string[];
  children?: number;
  /** 1-12, from the start date (0/undefined = unknown) */
  startMonth?: number;
}

export interface AdviceCard {
  id: string;
  /** Wave 3: premium-only rule. Shown to everyone in r24. */
  premium: boolean;
  title: string;
  body: string;
}

const EUROPE_RAIL = new Set([
  "france", "germany", "italy", "spain", "portugal", "netherlands",
  "belgium", "austria", "switzerland", "czechia", "czech republic",
  "poland", "hungary", "denmark", "sweden", "norway", "finland",
  "ireland", "croatia", "slovenia", "slovakia", "greece",
]);

const norm = (s: string) => s.trim().toLowerCase();

function countries(ctx: AdviceContext): string[] {
  return [...new Set(ctx.destinations.map((d) => norm(d.country)).filter(Boolean))];
}

function legs(ctx: AdviceContext): number {
  return (
    ctx.intercityLegs ?? Math.max(0, ctx.destinations.length - 1)
  );
}

interface Rule {
  id: string;
  premium: boolean;
  applies: (ctx: AdviceContext) => boolean;
  card: (ctx: AdviceContext) => { title: string; body: string };
}

const RULES: Rule[] = [
  {
    id: "jr-pass",
    premium: true,
    applies: (ctx) =>
      ctx.destinations.some((d) => norm(d.country) === "japan") &&
      legs(ctx) >= 2,
    card: () => ({
      title: "Consider a JR Pass",
      body: "Costly upfront, but with 2+ intercity legs it usually beats individual Shinkansen tickets, keeps you flexible, and the Shinkansen is an experience in itself. Check the current pass price against your route before buying.",
    }),
  },
  {
    id: "eurail-pass",
    premium: true,
    applies: (ctx) =>
      ctx.destinations.filter((d) => EUROPE_RAIL.has(norm(d.country)))
        .length >= 2 && legs(ctx) >= 2,
    card: (ctx) => ({
      title: "Rail pass vs point-to-point tickets",
      body: `With ${legs(ctx)}+ rail legs across Europe, a Eurail/Interrail pass can beat individual tickets on cost and flexibility. Point-to-point advance fares are cheaper if your dates are fixed, that is the trade-off.`,
    }),
  },
  {
    id: "multi-country",
    premium: false,
    applies: (ctx) => countries(ctx).length > 1,
    card: (ctx) => ({
      title: "Border-crossing sanity check",
      body: `This trip spans ${countries(ctx).length} countries. Check visa rules for each passport in your group, and expect different currencies and power plugs along the way.`,
    }),
  },
  {
    id: "budget-per-day",
    premium: false,
    applies: (ctx) =>
      (ctx.budgetCents ?? 0) > 0 && ctx.days >= 2,
    card: (ctx) => {
      const perDay = Math.round((ctx.budgetCents ?? 0) / ctx.days / 100);
      return {
        title: "Budget, day by day",
        body: `Your budget works out to about ${ctx.budgetCurrency ?? "USD"} ${perDay} per day. Big-ticket days (theme parks, intercity travel) balance against free museum and park days, plan one of each.`,
      };
    },
  },
  {
    id: "long-trip-pacing",
    premium: false,
    applies: (ctx) => ctx.days >= 12,
    card: () => ({
      title: "Build in a slow day",
      body: "Trips past two weeks burn people out without a deliberate rest day. Leave one day unplanned per week, laundry, a long breakfast, a park.",
    }),
  },
  {
    id: "kids-pacing",
    premium: false,
    applies: (ctx) => (ctx.children ?? 0) > 0,
    card: () => ({
      title: "Kid-paced days",
      body: "With children along, plan at most 3-4 stops a day, anchor each day with one thing the kids picked, and keep evenings early. Wayfare's family mode enforces this pacing when you fill days with AI.",
    }),
  },
  {
    id: "food-first",
    premium: false,
    applies: (ctx) => (ctx.intent ?? []).includes("food"),
    card: () => ({
      title: "Book the famous tables early",
      body: "Food-led trips hinge on a few high-demand spots. Reserve headline restaurants as soon as dates are fixed, and leave lunches loose for markets and street food.",
    }),
  },
  {
    id: "flight-vs-train",
    premium: true,
    applies: (ctx) =>
      ctx.destinations.length >= 2 && ctx.days > 0 &&
      legs(ctx) >= 1 && ctx.days <= legs(ctx) + 3,
    card: () => ({
      title: "Tight route, watch transfer overhead",
      body: "Your itinerary has nearly as many moves as days. Flights look fast but cost 4-5 hours door to door; trains between close cities are usually quicker and cheaper overall.",
    }),
  },
];

/** Advisory cards for the wizard's smart trade-offs step, in rule order. */
export function travelAdvice(ctx: AdviceContext): AdviceCard[] {
  return RULES.filter((rule) => rule.applies(ctx)).map((rule) => ({
    id: rule.id,
    premium: rule.premium,
    ...rule.card(ctx),
  }));
}

/* ── Convenience step (L step 8): luggage / travel-gear hints ─────────────
   Static curated suggestions from simple climate + duration rules. No store,
   no affiliate links - just honest packing pointers. */

const COLD_COUNTRIES = new Set([
  "japan", "south korea", "norway", "sweden", "finland", "iceland",
  "denmark", "canada", "switzerland", "austria", "germany", "poland",
  "united kingdom", "ireland",
]);
const HOT_COUNTRIES = new Set([
  "thailand", "vietnam", "indonesia", "india", "malaysia", "singapore",
  "philippines", "cambodia", "laos", "mexico", "brazil", "colombia",
  "egypt", "morocco", "united arab emirates", "kenya", "tanzania",
]);

/** Nov-Mar counts as cold-season for temperate/cold destinations. */
function isColdSeason(month: number | undefined): boolean {
  if (!month) return false;
  return month >= 11 || month <= 3;
}

export interface GearHint {
  id: string;
  title: string;
  body: string;
}

export function gearHints(ctx: AdviceContext): GearHint[] {
  const out: GearHint[] = [];
  const cs = countries(ctx);
  const coldDest = ctx.destinations.some((d) => COLD_COUNTRIES.has(norm(d.country)));
  const hotDest = ctx.destinations.some((d) => HOT_COUNTRIES.has(norm(d.country)));

  if (ctx.days > 0 && ctx.days <= 4) {
    out.push({
      id: "carry-on",
      title: "Carry-on only trip",
      body: "At this length, one carry-on plus a daypack covers everything. Skipping checked bags saves 30-60 minutes each way and removes lost-luggage risk.",
    });
  } else if (ctx.days >= 10) {
    out.push({
      id: "laundry",
      title: "Pack for a week, not the whole trip",
      body: "Plan one laundry stop per week instead of a bigger suitcase. Packing cubes and a quick-dry layer make mid-trip resets painless.",
    });
  }

  if (coldDest && isColdSeason(ctx.startMonth)) {
    out.push({
      id: "cold-layers",
      title: "Layer for real cold",
      body: "Thermal base layer, packable insulated jacket, and shoes that grip wet pavement. Heated carriages and stores run hot indoors, so layers beat one heavy coat.",
    });
  } else if (hotDest) {
    out.push({
      id: "hot-climate",
      title: "Dress for heat and humidity",
      body: "Breathable fabrics, a hat, and reef-safe sunscreen. A light long-sleeve doubles as sun and temple cover. Refill a water bottle instead of buying plastic.",
    });
  }

  if (cs.length > 1) {
    out.push({
      id: "adapter",
      title: "One universal adapter",
      body: `Crossing ${cs.length} countries likely means more than one plug type. A single universal adapter with USB-C keeps every device covered.`,
    });
  }

  if ((ctx.children ?? 0) > 0) {
    out.push({
      id: "kids-kit",
      title: "A small kids' kit",
      body: "Snacks, one comfort item, and a downloaded show per travel leg. Everything else is buyable at the destination, pack light.",
    });
  }

  if (out.length === 0) {
    out.push({
      id: "essentials",
      title: "The boring essentials",
      body: "Universal adapter, power bank, and a foldable daypack cover 90% of trips. Everything else you can buy there.",
    });
  }
  return out;
}
