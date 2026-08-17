/**
 * Shared FAQ content (r10-support) - single source of truth for the public
 * /faq page and the "Popular FAQs" shortlist inside the support widget.
 * Answers are deliberately honest about how the product actually works.
 */

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqGroup {
  /** Deep-link anchor: /faq#<id> */
  id: string;
  title: string;
  blurb: string;
  items: FaqItem[];
}

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    blurb: 'What Wayfare is and how to try it.',
    items: [
      {
        q: 'What is Wayfare?',
        a: 'Wayfare is a trip planner that turns a destination and dates into a day-by-day itinerary on a map. You can track expenses and split costs with travel mates, discover places worth your time, and keep a travel journal along the way. It\u2019s built for the whole arc of a trip, dreaming, planning, going, and remembering.',
      },
      {
        q: 'Is Wayfare free?',
        a: 'Yes, the Wanderer tier is free and covers the essentials: up to 3 active trips, day-by-day planning on the map, expense tracking, and Explore. Voyager is the paid tier, and it unlocks AI itinerary generation, route optimization, email import, offline export, unlimited trips, and priority support. Nothing you make on the free tier is ever deleted if you stay on it.',
      },
      {
        q: 'Do I need an account, or can I try it as a guest?',
        a: 'You can explore a fresh demo as a guest, no sign-up needed. Guest trips are ephemeral, though: they only live in that session. Sign in to keep your trips, sync across devices, and pick up where you left off.',
      },
    ],
  },
  {
    id: 'trips-ai',
    title: 'Trips & AI',
    blurb: 'How the planner thinks, and what Voyager adds.',
    items: [
      {
        q: 'How do AI itineraries work?',
        a: 'Tell us your destination and dates, and the planner ranks places from our curated maps corpus using your taste profile, travel styles, budget band, pace, and interests from onboarding. It lays out day-by-day stops with sensible routing, and you can rearrange, swap, or delete anything. AI generation is a Voyager feature; Wanderers can always build days by hand.',
      },
      {
        q: 'Why upgrade to Voyager?',
        a: 'Voyager removes the ceilings: unlimited active trips and collaborators, AI itinerary generation, one-tap route optimization, flight and hotel email import, and offline export. It also comes with priority support, you can message us straight from the app. If you travel more than a couple of times a year, it pays for itself in saved hours.',
      },
      {
        q: 'Can Wayfare plan a road trip?',
        a: 'Yes. The road trip planner strings multiple stops into a driving route, splits the journey into days, and suggests places along the way. Start one from your trips page, then tune the pacing, overnight towns, and daily stops to taste.',
      },
      {
        q: 'What are ready-made plans?',
        a: 'Ready-made plans are curated itineraries you can clone and make your own, a fast starting point when you\u2019d rather not plan from a blank page. We\u2019re rolling them out gradually across popular destinations. Keep an eye on Explore and your trips page as new ones land.',
      },
      {
        q: 'Can I plan with friends?',
        a: 'Every trip is collaborative: invite travel mates and everyone can edit days, add places, and log shared expenses together. Wanderer trips allow up to 3 collaborators; Voyager removes the limit. Only the trip owner needs Voyager for premium features to apply, guests ride free.',
      },
    ],
  },
  {
    id: 'maps-places',
    title: 'Maps & places',
    blurb: 'Where pins come from and how to add yours.',
    items: [
      {
        q: 'Where do places on the map come from?',
        a: 'Our places come from OpenStreetMap, the community-built map of the world (data © OpenStreetMap contributors, ODbL), plus additions reviewed by our curation team. That\u2019s why coverage is excellent in some cities and thinner in others, and why you can help fill the gaps.',
      },
      {
        q: 'Can I add my own place?',
        a: 'Yes. From Explore you can submit a place we don\u2019t have yet, a café, a viewpoint, a trailhead. It goes into a short review queue, and once approved it appears for every traveler. You can always add any spot to your own trip instantly, even while it waits for review.',
      },
      {
        q: 'Why is my place "pending"?',
        a: 'Every traveler-submitted place passes a quick human review before it joins the public corpus, it\u2019s how we keep pins accurate and spam out. Most reviews clear within a day or two. If yours has been pending much longer, message us and we\u2019ll take a look.',
      },
      {
        q: 'What is the City Builder, and what are AI requests?',
        a: 'The City Builder assembles a live city guide (sights, food, stays) from open map data for any city you search. If a city\u2019s coverage is still thin, you can file an AI request to prioritize it for full itinerary generation, and our team works through that queue. Requests are reviewed by humans, in the order they arrive.',
      },
    ],
  },
  {
    id: 'weather-advisories',
    title: 'Weather & advisories',
    blurb: 'Forecasts, climate averages, and safety feeds.',
    items: [
      {
        q: 'What does the "~" before a temperature mean?',
        a: 'A tilde means the number is a climate average, not a live weather forecast. Real forecasts only reach about 16 days out, so for dates beyond that horizon we show historical normals for that time of year instead. As your trip gets closer, the "~" values quietly turn into real forecasts.',
      },
      {
        q: 'Where do travel advisories come from?',
        a: 'Alongside the weather, we surface the U.S. State Department\u2019s travel advisories and disaster alerts from GDACS, the UN/EU Global Disaster Alert and Coordination System. They\u2019re informational starting points, not the final word, always check your own government\u2019s guidance and local sources before you travel.',
      },
    ],
  },
  {
    id: 'family',
    title: 'Family',
    blurb: 'Traveling with kids, minus the guesswork.',
    items: [
      {
        q: 'What is kids mode?',
        a: 'When you\u2019re traveling with children, Wayfare tags stops with kid-friendliness badges and shapes family days around what actually works, shorter museum visits, playground breaks, casual food. Age-fit labels (0–4, 5–9, 10+) help you pick stops that land well for your crew.',
      },
      {
        q: 'What is the Kids Portal?',
        a: 'The Kids Portal is our parent-tested travel guide for families: documents and borders, health and vaccines, car seats, heat, food, and pacing. Pick a destination and it tailors the health and car-seat notes. Find it at /kids, no account needed.',
      },
    ],
  },
  {
    id: 'app-account',
    title: 'App & account',
    blurb: 'Install, sign in, and manage your data.',
    items: [
      {
        q: 'How do I install Wayfare on my phone?',
        a: 'On Android you can grab the APK from the Get App page when it\u2019s published for your deployment, or install Wayfare as a PWA: open the site in your browser and choose "Add to Home Screen". The PWA is the same app, always up to date, no store required.',
      },
      {
        q: 'Can I sign in with Google?',
        a: 'Google sign-in is available on deployments where it\u2019s configured, if you see the Google button on the sign-in page, you\u2019re good. If it\u2019s not there, use the standard sign-in; everything else works exactly the same.',
      },
      {
        q: 'How do I change my currency or travel preferences?',
        a: 'Head to your profile to update your home currency and the taste profile from onboarding, styles, budget band, pace, interests, and cuisines. New itineraries use your latest preferences immediately.',
      },
      {
        q: 'How do I contact the team?',
        a: 'Voyager members can message us from the help button in the app, bottom-right on any screen, and we typically reply within a day. Everyone can reach the admin team at admin@wayfare.app. Checking this page first is usually fastest; most answers already live here.',
      },
      {
        q: 'How do I delete my data?',
        a: 'Message us from the help widget or email admin@wayfare.app with the subject "Data deletion", and we\u2019ll remove your account, trips, and personal data. We confirm by email once it\u2019s done. Deletion is permanent, so export anything you want to keep first.',
      },
      {
        q: 'Something is broken, how do I report a bug?',
        a: 'Voyager members: open the help button, pick the "Bug" category, and tell us what you expected versus what happened, screenshots help. Include the page you were on and we\u2019ll get back to you, usually within a day. Wanderers can email the details to admin@wayfare.app.',
      },
    ],
  },
];

/** Flat list with group context - handy for search + counts. */
export const ALL_FAQS: (FaqItem & { groupId: string; groupTitle: string })[] = FAQ_GROUPS.flatMap(
  (g) => g.items.map((item) => ({ ...item, groupId: g.id, groupTitle: g.title })),
);

/** The five questions the support widget surfaces as "Popular FAQs". */
export const POPULAR_FAQS: { q: string; groupId: string }[] = [
  { q: 'How do AI itineraries work?', groupId: 'trips-ai' },
  { q: 'Why upgrade to Voyager?', groupId: 'trips-ai' },
  { q: 'Why is my place "pending"?', groupId: 'maps-places' },
  { q: 'What does the "~" before a temperature mean?', groupId: 'weather-advisories' },
  { q: 'How do I install Wayfare on my phone?', groupId: 'app-account' },
];
