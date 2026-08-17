import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Baby,
  BookOpen,
  Car,
  ChevronDown,
  FileText,
  HeartPulse,
  MapPin,
  Sparkles,
  Sun,
  Timer,
  UtensilsCrossed,
} from 'lucide-react';
import { EASE_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

/* ─── Curated destination data ──────────────────────────────────────────────
   General CDC/WHO/IATA guidance, editorialized. The destination selector
   pins the matching health note and highlights the car-seat row. */

interface HealthRegion {
  keys: string[]; // destination selector values that map here
  label: string;
  vaccines: string;
  notes: string[];
}

const HEALTH_REGIONS: HealthRegion[] = [
  {
    keys: ['japan'],
    label: 'Japan',
    vaccines: 'No special vaccines beyond the routine schedule.',
    notes: [
      'Tap water is safe everywhere; convenience stores stock familiar snacks, diapers and formula.',
      'Drugstores (Matsumoto Kiyoshi etc.) carry children’s fever medicine, bring a translation app for labels.',
    ],
  },
  {
    keys: ['se-asia'],
    label: 'Southeast Asia (Thailand, Vietnam, Cambodia, Laos)',
    vaccines: 'Routine schedule plus Hepatitis A for most travelers; discuss Japanese encephalitis for rural trips longer than a month.',
    notes: [
      'Mosquito care matters: DEET 20-30% (age 2+ months), long sleeves at dusk, nets over strollers.',
      'Stick to bottled or boiled water; ice in busy city restaurants is usually factory-made and safe.',
    ],
  },
  {
    keys: ['india'],
    label: 'India & South Asia',
    vaccines: 'Hepatitis A and typhoid are commonly recommended; check routine boosters.',
    notes: [
      'Food-and-water caution is the real one: bottled water only (check seals), freshly cooked food, peeled fruit.',
      'Pack ORS sachets and agree a “no tap water, no salads” rule the kids understand.',
    ],
  },
  {
    keys: ['europe'],
    label: 'Europe (Schengen)',
    vaccines: 'Routine schedule only; measles coverage (MMR) is worth confirming.',
    notes: [
      'An EHIC/GHIC card covers kids for public healthcare if you’re eligible; carry it for every child.',
      'Pharmacies are excellent and pharmacist-first care saves clinic waits.',
    ],
  },
  {
    keys: ['usa'],
    label: 'USA & Canada',
    vaccines: 'Routine schedule only.',
    notes: [
      'Healthcare is expensive, verify your travel insurance covers kids before you fly.',
      'Car-seat rules are state/province law; check the states on your route, not just your entry point.',
    ],
  },
  {
    keys: ['latam'],
    label: 'Mexico & Central America',
    vaccines: 'Hepatitis A commonly recommended; typhoid for adventurous eaters or rural stays.',
    notes: [
      'Bottled water by default outside resort zones; agua purificada is cheap and everywhere.',
      'Altitude in Mexico City (2,240m) is mild for kids but plan an easy first day.',
    ],
  },
  {
    keys: ['samerica'],
    label: 'South America (Peru, Argentina, Brazil, Chile)',
    vaccines: 'Hepatitis A; yellow fever for Brazil’s interior/Amazon (certificate sometimes checked).',
    notes: [
      'Cusco sits at 3,400m, see the altitude section before planning Machu Picchu with little ones.',
      'Long-distance buses are excellent but bring your own booster for private transfers.',
    ],
  },
  {
    keys: ['morocco'],
    label: 'Morocco & North Africa',
    vaccines: 'Routine plus Hepatitis A for most travelers.',
    notes: [
      'Bottled water; mint tea and freshly squeezed orange juice are safe kid favorites.',
      'Sun is fierce year-round, hats and siesta-hours indoors are your friends.',
    ],
  },
  {
    keys: ['africa'],
    label: 'Sub-Saharan Africa (safari regions)',
    vaccines: 'Yellow fever certificate required by several countries; malaria prophylaxis discussion for safari zones, see a travel clinic.',
    notes: [
      'Malaria prevention is weight-dosed for children; start the conversation 6+ weeks out.',
      'Many lodges welcome kids but have minimum ages for game drives, check before booking.',
    ],
  },
  {
    keys: ['mideast'],
    label: 'Middle East (UAE, Jordan, Oman)',
    vaccines: 'Routine schedule; Hepatitis A commonly recommended.',
    notes: [
      'Heat is the headline: plan outdoor time before 10am and after 4pm May–September.',
      'Malls and aquariums are excellent midday escapes with kids.',
    ],
  },
  {
    keys: ['oceania'],
    label: 'Australia & New Zealand',
    vaccines: 'Routine schedule only.',
    notes: [
      'UV is extreme, “slip, slop, slap” applies even on cloudy days; SPF50+ is the norm.',
      'Car-seat rules are strictly enforced and rental companies stock certified seats.',
    ],
  },
  {
    keys: ['china'],
    label: 'China & East Asia (mainland)',
    vaccines: 'Routine plus Hepatitis A; discuss JE for rural summer trips.',
    notes: [
      'Stick to bottled water; hot freshly cooked food is the safe default and kids love noodle shops.',
      'Air quality can vary, check AQI apps on big-city days with asthmatic kids.',
    ],
  },
];

const GENERAL_HEALTH: HealthRegion = {
  keys: ['general'],
  label: 'General guidance (any destination)',
  vaccines:
    'Visit your pediatrician or a travel clinic 4-6 weeks before departure to review the routine schedule, some vaccines can be accelerated for travel (e.g. early MMR from 6 months for international trips).',
  notes: [
    'Travel insurance: kids are often covered free on a family policy, confirm in writing, including any adventure activities.',
    'Carry prescriptions in original packaging plus a copy of the script; some countries restrict common medications.',
  ],
};

interface CarSeatRule {
  country: string;
  key?: string; // links to a selector value for highlighting
  rule: string;
  detail: string;
}

const CAR_SEAT_RULES: CarSeatRule[] = [
  { country: 'Japan', key: 'japan', rule: 'Child seat required under age 6', detail: 'Taxis are exempt but seatbelts are not, bring a travel seat for road trips.' },
  { country: 'UK', rule: 'Until 12 years or 135cm', detail: 'Taxis: kids 3+ can use an adult belt for short unexpected journeys.' },
  { country: 'Germany', rule: 'Until 12 years or 150cm', detail: 'Strictly enforced; rental seats meet EU standards.' },
  { country: 'France', rule: 'Until 10 years', detail: 'Children under 10 must sit in the back with an approved restraint.' },
  { country: 'Spain', rule: 'Until 135cm', detail: 'Under-135cm kids must sit in the back seat.' },
  { country: 'Italy', rule: 'Until 150cm', detail: 'EU-standard (ECE R44/R129) seats required.' },
  { country: 'Portugal', rule: 'Until 12 years or 135cm', detail: 'Back seat for under-12s unless shorter than 135cm with proper restraint.' },
  { country: 'Netherlands', rule: 'Until 18 years or 135cm', detail: 'One of Europe’s longest requirements.' },
  { country: 'Sweden', rule: 'Until 135cm', detail: 'Rear-facing is the cultural norm to age 4+, and it is safer.' },
  { country: 'Switzerland', rule: 'Until 12 years or 150cm', detail: 'EU-standard seats accepted.' },
  { country: 'Austria', rule: 'Until 14 years or 135cm', detail: 'Under 14s need an approved restraint below 135cm.' },
  { country: 'Greece', rule: 'Until 12 years or 135cm', detail: 'Island taxis rarely stock seats, bring yours.' },
  { country: 'Turkey', rule: 'Until 135cm', detail: 'Enforcement varies; bring your own for rentals.' },
  { country: 'USA', key: 'usa', rule: 'Varies by state, typically to 8 years / 4\'9"', detail: 'Check every state on your route; California is to 8, some states to 6.' },
  { country: 'Canada', rule: 'Varies by province, to ~9 years / 145cm', detail: 'BC and Ontario are among the strictest; boosters widely required.' },
  { country: 'Mexico', key: 'latam', rule: 'Recommended under 5; patchy enforcement', detail: 'Bring your own, local seats may not meet your home standard.' },
  { country: 'Brazil', key: 'samerica', rule: 'Until 10 years (back seat), restraint to 7½', detail: 'Under-10s must ride in the back.' },
  { country: 'Argentina', key: 'samerica', rule: 'Until 10 years (back seat)', detail: 'Child restraint required; front seat only 10+.' },
  { country: 'Australia', key: 'oceania', rule: 'Until 7 years (booster)', detail: 'Strict; taxis have exemptions but book a seat for longer rides.' },
  { country: 'New Zealand', key: 'oceania', rule: 'Until 7 years', detail: 'Approved restraints to 7; recommended to 148cm.' },
  { country: 'Singapore', rule: 'Below 1.35m', detail: 'Taxis exempt, Grab/rideshare is not, request a family car.' },
  { country: 'South Korea', rule: 'Under 6 (child seat)', detail: 'Under-13s in the back seat.' },
  { country: 'Hong Kong', rule: 'Under 8 / 135cm', detail: 'Rear seat belts required for all passengers.' },
  { country: 'Thailand', key: 'se-asia', rule: 'Under 6 (child seat, since 2022)', detail: 'Law is new, rental availability is improving; reserve early.' },
  { country: 'UAE', key: 'mideast', rule: 'Under 4 (child seat)', detail: 'Front seat prohibited under 10/145cm.' },
  { country: 'South Africa', key: 'africa', rule: 'Under 3 (car seat)', detail: 'Older kids need belts; safari transfers rarely stock seats, bring one.' },
  { country: 'India', key: 'india', rule: 'No national child-seat law', detail: 'Bring your own seat and insist on cars with working rear belts.' },
  { country: 'Morocco', key: 'morocco', rule: 'No specific law', detail: 'Bring your own; grand taxis often lack rear belts, book private transfers.' },
  { country: 'China', key: 'china', rule: 'Some cities require under 4 (e.g. Shanghai)', detail: 'National rules are evolving, bring your own seat for consistency.' },
];

interface Destination {
  value: string;
  label: string;
  regionKey: string; // HEALTH_REGIONS key or 'general'
  seatKey?: string; // CAR_SEAT_RULES key to highlight
}

const DESTINATIONS: Destination[] = [
  { value: 'general', label: 'General guidance', regionKey: 'general' },
  { value: 'japan', label: 'Japan', regionKey: 'japan', seatKey: 'japan' },
  { value: 'se-asia', label: 'Southeast Asia', regionKey: 'se-asia', seatKey: 'se-asia' },
  { value: 'india', label: 'India & South Asia', regionKey: 'india', seatKey: 'india' },
  { value: 'europe', label: 'Europe (Schengen)', regionKey: 'europe' },
  { value: 'usa', label: 'USA & Canada', regionKey: 'usa', seatKey: 'usa' },
  { value: 'latam', label: 'Mexico & Central America', regionKey: 'latam', seatKey: 'latam' },
  { value: 'samerica', label: 'South America', regionKey: 'samerica', seatKey: 'samerica' },
  { value: 'morocco', label: 'Morocco & North Africa', regionKey: 'morocco', seatKey: 'morocco' },
  { value: 'africa', label: 'Sub-Saharan Africa', regionKey: 'africa', seatKey: 'africa' },
  { value: 'mideast', label: 'Middle East', regionKey: 'mideast', seatKey: 'mideast' },
  { value: 'oceania', label: 'Australia & New Zealand', regionKey: 'oceania', seatKey: 'oceania' },
  { value: 'china', label: 'China & East Asia', regionKey: 'china', seatKey: 'china' },
];

/* ─── Section shell (accordion card) ─────────────────────────────────────── */

function Section({
  id,
  icon: Icon,
  title,
  blurb,
  wayfare,
  open,
  onToggle,
  children,
}: {
  id: string;
  icon: typeof Sun;
  title: string;
  blurb: string;
  wayfare: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, ease: EASE_EXPO }}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors duration-fast hover:bg-surface-2/60 md:px-6"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ochre-soft text-ochre">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="type-h4 block text-ink">{title}</span>
          <span className="type-caption mt-0.5 block text-ink-3">{blurb}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-ink-3 transition-transform duration-base',
            open && 'rotate-180',
          )}
          strokeWidth={2}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.32, ease: EASE_EXPO }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-5 py-5 md:px-6">
              {children}
              <p className="type-small mt-5 flex items-start gap-2 rounded-md bg-brand-soft px-3.5 py-2.5 text-brand">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>
                  <span className="font-semibold">Wayfare does this for you: </span>
                  {wayfare}
                </span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function BulletList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="type-body flex gap-2.5 text-ink-2">
          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-ochre" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ─── The portal page ─────────────────────────────────────────────────────── */

export default function KidsPortal() {
  const [dest, setDest] = useState('general');
  const [openId, setOpenId] = useState<string | null>('documents');

  const selected = DESTINATIONS.find((d) => d.value === dest) ?? DESTINATIONS[0];
  const health =
    HEALTH_REGIONS.find((r) => r.keys.includes(selected.regionKey)) ?? GENERAL_HEALTH;
  const seatKey = selected.seatKey;

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  const generalHealth = useMemo(() => GENERAL_HEALTH, []);

  return (
    <div className="min-h-screen bg-bg">
      {/* hero */}
      <header className="relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'var(--grad-cta)' }}
          aria-hidden
        />
        <Baby
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-12 h-56 w-56 text-white/15 dark:text-black/10"
          strokeWidth={1}
        />
        <div className="relative mx-auto max-w-3xl px-5 pb-10 pt-14 md:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_EXPO }}
          >
            <span className="type-eyebrow inline-flex items-center gap-1.5 rounded-pill bg-white/20 px-3 py-1.5 text-white dark:bg-black/15 dark:text-[#2A1B0E]">
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              The kids travel guide
            </span>
            <h1 className="mt-4 font-serif text-[34px] leading-[40px] tracking-[-0.01em] text-white dark:text-[#2A1B0E] md:text-[44px] md:leading-[50px]">
              Travelling with children, what to know before you go.
            </h1>
            <p className="type-body mt-3 max-w-[52ch] text-white/90 dark:text-[#2A1B0E]/85">
              Practical, calm, parent-tested guidance: documents, health, car
              seats, heat, food, and pacing. Pick a destination to tailor the
              health and car-seat notes.
            </p>
            <label className="mt-6 flex max-w-md items-center gap-2.5 rounded-md bg-surface px-3.5 py-2.5 shadow-md">
              <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
              <span className="type-small shrink-0 font-semibold text-ink-3">
                Destination
              </span>
              <select
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                aria-label="Destination region"
                className="type-body w-full bg-transparent py-0.5 text-ink outline-none [color-scheme:light] dark:[color-scheme:dark]"
              >
                {DESTINATIONS.map((d) => (
                  <option key={d.value} value={d.value} className="bg-surface text-ink">
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </motion.div>
        </div>
      </header>

      {/* sections */}
      <main className="mx-auto max-w-3xl space-y-4 px-5 py-8 md:py-12">
        {/* (a) Documents & borders */}
        <Section
          id="documents"
          icon={FileText}
          title="Documents & borders"
          blurb="Passports, consent letters, custody papers, unaccompanied-minor rules"
          wayfare="Add every document to your trip's checklist (passports, consent letter, insurance cards) so the packing list doubles as a border-crossing kit."
          open={openId === 'documents'}
          onToggle={toggle}
        >
          <BulletList
            items={[
              <>
                <strong>Every child needs their own passport</strong>, kids can no longer
                ride on a parent’s passport in most countries. Check the 6-months-validity
                rule your destination applies to children too.
              </>,
              <>
                <strong>Travelling solo with your child?</strong> Carry a signed
                (ideally notarized) <em>consent letter</em> from the other parent: child’s
                name and passport number, your itinerary, contact details, and their
                signature. Border officers in Canada, the US and much of Latin America ask
                for it, especially when surnames differ.
              </>,
              <>
                <strong>Custody or guardianship papers</strong> matter if you’re not both
                legal parents, or a parent is deceased, carry certified copies.
              </>,
              <>
                <strong>Unaccompanied minors:</strong> airlines require their UM service
                roughly ages 5-11 (optional to ~15-17), with a fee of about $50-150 each
                way. Book it early, UM slots per flight are limited.
              </>,
              <>
                <strong>Visas and entry forms are per-person</strong>, babies need their
                own ESTA/eVisa too, and a few countries ask for birth certificates
                (carry one for South Africa and much of Southern Africa).
              </>,
            ]}
          />
        </Section>

        {/* (b) Health & vaccines */}
        <Section
          id="health"
          icon={HeartPulse}
          title="Health & vaccines"
          blurb="Routine schedule, destination notes, insurance, and the meds kit"
          wayfare="Save the meds-kit list to your trip's packing checklist, and let kids mode keep sightseeing short, so a low-energy day never ruins the plan."
          open={openId === 'health'}
          onToggle={toggle}
        >
          <div className="space-y-5">
            <BulletList
              items={[
                <>
                  <strong>4-6 weeks out, check the routine schedule</strong> with your
                  pediatrician, some shots can be accelerated for travel (early MMR from
                  6 months, Hepatitis A from 12 months).
                </>,
                <>
                  <strong>Travel insurance that names the kids.</strong> Children are
                  frequently free on family policies, confirm coverage, including any
                  “adventure” activities on your list.
                </>,
              ]}
            />
            <div
              className={cn(
                'rounded-lg border p-4',
                selected.regionKey === 'general'
                  ? 'border-border bg-surface-2/60'
                  : 'border-ochre/30 bg-ochre-soft',
              )}
            >
              <p className="type-eyebrow text-ink-3">{health.label}</p>
              <p className="type-body mt-1.5 text-ink">{health.vaccines}</p>
              <ul className="mt-2.5 space-y-1.5">
                {health.notes.map((n) => (
                  <li key={n} className="type-small flex gap-2 text-ink-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ochre" aria-hidden />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
            {selected.regionKey !== 'general' ? (
              <p className="type-caption text-ink-3">{generalHealth.vaccines}</p>
            ) : null}
            <div>
              <p className="type-small mb-2 font-semibold text-ink">The family meds kit</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Fever reducers (dosed by weight)',
                  'ORS rehydration sachets',
                  'Antihistamine',
                  'Motion-sickness tabs (age 2+)',
                  'Plasters + antiseptic',
                  'Thermometer',
                  'Hand sanitizer',
                  'Prescriptions + copies',
                  'SPF50 & after-sun',
                ].map((m) => (
                  <span
                    key={m}
                    className="type-caption rounded-pill bg-surface-2 px-2.5 py-1 text-ink-2"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* (c) Getting around */}
        <Section
          id="transport"
          icon={Car}
          title="Getting around"
          blurb="Car-seat laws by country, airline bassinets & strollers, train family cars"
          wayfare="Set your hotel as home base and Wayfare's AI anchors each day's route around it, fewer transfers, less gear-hauling with a stroller."
          open={openId === 'transport'}
          onToggle={toggle}
        >
          <div className="space-y-5">
            <BulletList
              items={[
                <>
                  <strong>Flying with an infant:</strong> request a bulkhead bassinet at
                  booking (usually for babies under ~11kg); FAA/CAA-approved car seats can
                  be used on board in their own seat; strollers gate-check free on nearly
                  all airlines.
                </>,
                <>
                  <strong>Trains are the family hack:</strong> kids under 6 ride free on
                  Japan Rail and most European networks; look for family compartments
                  (Deutsche Bahn’s Familienbereich, SBB’s family coach with a play area).
                </>,
                <>
                  <strong>Your own seat beats a rental seat</strong> for fit and
                  familiarity, a lightweight travel seat (~4kg) pays for itself by the
                  second trip.
                </>,
              ]}
            />
            <div>
              <p className="type-small mb-2 font-semibold text-ink">
                Car-seat rules around the world
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[520px] text-left">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/70">
                      <th className="type-caption px-3 py-2 font-semibold text-ink-3">Country</th>
                      <th className="type-caption px-3 py-2 font-semibold text-ink-3">Rule</th>
                      <th className="type-caption px-3 py-2 font-semibold text-ink-3">Good to know</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CAR_SEAT_RULES.map((r) => (
                      <tr
                        key={r.country}
                        className={cn(
                          'border-b border-border/60 last:border-0',
                          seatKey && r.key === seatKey
                            ? 'bg-ochre-soft'
                            : 'odd:bg-surface even:bg-surface-2/40',
                        )}
                      >
                        <td className="type-small px-3 py-2 font-semibold text-ink">
                          {r.country}
                          {seatKey && r.key === seatKey ? (
                            <span className="type-caption ml-1.5 rounded-pill bg-ochre px-1.5 py-0.5 font-semibold text-white dark:text-[#1C1917]">
                              selected
                            </span>
                          ) : null}
                        </td>
                        <td className="type-small px-3 py-2 text-ink-2">{r.rule}</td>
                        <td className="type-caption px-3 py-2 text-ink-3">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="type-caption mt-2 text-ink-3">
                Rules change and enforcement varies, treat this as the planning
                baseline and confirm the latest before you drive.
              </p>
            </div>
          </div>
        </Section>

        {/* (d) Heat, sun & altitude */}
        <Section
          id="climate"
          icon={Sun}
          title="Heat, sun & altitude"
          blurb="Hydration, UV by region, and how high is too high for little ones"
          wayfare="Kids-mode day plans front-load outdoor stops in the morning and end by 18:30, the hottest and crankiest hours simply disappear from the schedule."
          open={openId === 'climate'}
          onToggle={toggle}
        >
          <BulletList
            items={[
              <>
                <strong>Kids dehydrate faster than adults.</strong> Offer water every
                hour, not “when thirsty”; pack ORS sachets for hot climates and tummy
                bugs.
              </>,
              <>
                <strong>Under 6 months: shade, not sunscreen.</strong> UV clothing, hats
                and stroller shades; sunscreen only on small exposed areas if shade
                fails. Older kids: SPF50, reapplied every 2 hours and after swimming.
              </>,
              <>
                <strong>Respect the UV index, not the temperature.</strong> Tropics and
                the southern-hemisphere summer hit UV 11+ (“extreme”), plan outdoor time
                before 10am and after 4pm.
              </>,
              <>
                <strong>Altitude:</strong> children aren’t proven more susceptible to
                altitude sickness, but small kids can’t describe symptoms. Above 2,500m
                (Cusco is 3,400m), ascend gradually, keep the first 48 hours gentle, and
                watch for unusual fussiness, poor appetite or vomiting, descent is the
                cure.
              </>,
              <>
                <strong>Heat rule of thumb:</strong> if you’re sweating, they’re sweating
                more. A midday indoor reset (nap, pool, museum) beats pushing through.
              </>,
            ]}
          />
        </Section>

        {/* (e) Food & water */}
        <Section
          id="food"
          icon={UtensilsCrossed}
          title="Food & water"
          blurb="Formula & sterilizing, street-food judgment, allergy cards"
          wayfare="With kids mode on, Wayfare's AI prefers casual, family-friendly food stops (≤€€), quick service, easy menus, no ceremony."
          open={openId === 'food'}
          onToggle={toggle}
        >
          <BulletList
            items={[
              <>
                <strong>Formula-fed?</strong> Bring your familiar brand (availability
                varies), plus sterilizing tablets or microwave bags. In tap-unsafe
                regions, mix feeds with bottled or boiled-and-cooled water.
              </>,
              <>
                <strong>Street food judgment:</strong> busy stalls with a fast queue,
                cooked-to-order and served piping hot are the green flags anywhere in the
                world. Peelable fruit is always safe; raw salads and tap-water ice are
                the caution zone in high-risk regions.
              </>,
              <>
                <strong>Allergies travel in writing:</strong> carry a card in the local
                language naming the allergen clearly (“contains peanuts”), show it
                before ordering, every time.
              </>,
              <>
                <strong>High chairs aren’t universal.</strong> A fabric travel harness
                weighs nothing and turns any chair into one.
              </>,
              <>
                <strong>Never be 90 minutes from the next snack.</strong> Hungry kids
                don’t sightsee, see the pacing section.
              </>,
            ]}
          />
        </Section>

        {/* (f) Pacing with kids */}
        <Section
          id="pacing"
          icon={Timer}
          title="Pacing with kids"
          blurb="The 3-1 rhythm, nap-aware planning, snack strategy, meltdown recovery"
          wayfare="This is literally what kids mode does: max 4 stops a day, one park/playground recharge stop labeled 'Downtime break for the kids', and dinner by 17:30-18:00."
          open={openId === 'pacing'}
          onToggle={toggle}
        >
          <div className="space-y-4">
            <BulletList
              items={[
                <>
                  <strong>The 3-1 rhythm:</strong> three activities, then one genuine
                  downtime block, playground, park, pool, or just back to the room.
                  Alternate, don’t accumulate.
                </>,
                <>
                  <strong>Anchor the morning.</strong> Kids are at their best before
                  lunch: put the day’s “big sight” first and let the afternoon be
                  flexible.
                </>,
                <>
                  <strong>Plan transit to coincide with naps</strong>, a 40-minute train
                  ride at nap time is a gift, not a gap.
                </>,
                <>
                  <strong>Snack strategy:</strong> carry more than seems reasonable;
                  offer before hunger is declared. A snack is 15 minutes of museum
                  patience in edible form.
                </>,
                <>
                  <strong>Meltdown recovery:</strong> stop moving, get low, water +
                  snack, name the feeling, and trade, one “kid’s choice” stop for the
                  next grown-up one. Tomorrow’s plan flexes; nobody wins a fight with a
                  tired four-year-old.
                </>,
              ]}
            />
            <div className="rounded-lg bg-pine-soft p-4">
              <p className="type-small font-semibold text-pine">
                Try it: build an AI itinerary with “Travelling with children” on, or flip
                the Kids toggle in any trip’s header, every future AI day-fill on that
                trip plans at family pace.
              </p>
            </div>
          </div>
        </Section>

        {/* footer */}
        <footer className="pt-4 text-center">
          <p className="type-caption mx-auto max-w-[56ch] leading-relaxed text-ink-3">
            Compiled from CDC, WHO and IATA travel-health guidance plus airline and
            national transport authority rules, generalized for planning. Always confirm
            destination-specific advice with your pediatrician or a travel clinic, and
            current regulations with official sources.
          </p>
        </footer>
      </main>
    </div>
  );
}
