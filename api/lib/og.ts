/**
 * og.ts (r29) - per-link social preview cards.
 *
 * THE PROBLEM THIS FIXES
 *
 * Wayfare is a Vite SPA. Social crawlers (WhatsApp, Slack, iMessage, X,
 * LinkedIn, Discord, Telegram, Facebook) do NOT execute JavaScript - they
 * fetch the HTML, read the meta tags, and leave. index.html carries one static
 * set of tags, so every shared itinerary produced the identical card:
 * "Wayfare - Every journey, beautifully planned" with the generic logo.
 *
 * That silently broke the entire share loop the product is built around. A
 * user shares "Kerala, 6 days, 4 friends" into a group chat and their friends
 * see a corporate banner with no trip name, no destination, no dates and no
 * reason to tap. Every share looked like an ad for the app rather than an
 * invitation to their trip.
 *
 * The fix is to inject real tags server-side for the two shareable routes.
 * This is not SSR - the SPA still boots and renders normally for humans. We
 * only rewrite the <head> so the crawler has something true to read.
 */

/** Escape for an HTML attribute value. */
function attr(v: string): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface OgCard {
  title: string;
  description: string;
  /** Absolute URL. Relative paths are resolved against `origin`. */
  image?: string | null;
  url: string;
  /** "website" for a landing page, "article" for a specific trip. */
  type?: "website" | "article";
}

/**
 * Rewrite the <head> of the SPA shell with this card's tags.
 *
 * Existing og:/twitter: tags are REMOVED first. Leaving them in place means
 * two og:title tags in one document and crawlers differ on which wins - some
 * take the first, so the generic one would have kept winning and the whole
 * exercise would have been silently pointless.
 */
export function injectOg(html: string, card: OgCard, origin: string): string {
  const abs = (u: string | null | undefined): string => {
    if (!u) return `${origin}/og-image.png`;
    if (/^https?:\/\//i.test(u)) return u;
    return `${origin}${u.startsWith("/") ? "" : "/"}${u}`;
  };

  const stripped = html
    .replace(/<meta[^>]+property=["']og:[^"']*["'][^>]*>\s*/gi, "")
    .replace(/<meta[^>]+name=["']twitter:[^"']*["'][^>]*>\s*/gi, "")
    .replace(/<meta[^>]+name=["']description["'][^>]*>\s*/gi, "")
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "");

  const tags = [
    `<title>${attr(card.title)}</title>`,
    `<meta name="description" content="${attr(card.description)}">`,
    `<meta property="og:site_name" content="Wayfare">`,
    `<meta property="og:type" content="${card.type ?? "article"}">`,
    `<meta property="og:title" content="${attr(card.title)}">`,
    `<meta property="og:description" content="${attr(card.description)}">`,
    `<meta property="og:url" content="${attr(card.url)}">`,
    `<meta property="og:image" content="${attr(abs(card.image))}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attr(card.title)}">`,
    `<meta name="twitter:description" content="${attr(card.description)}">`,
    `<meta name="twitter:image" content="${attr(abs(card.image))}">`,
  ].join("\n    ");

  return stripped.replace(/<head([^>]*)>/i, `<head$1>\n    ${tags}`);
}

/** "12-19 Mar 2027" from two stored YYYY-MM-DD strings. Timezone-free. */
export function formatRange(startDate?: string | null, endDate?: string | null): string {
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const p = (s?: string | null) => {
    const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
    return m ? { y: m[1]!, mo: Number(m[2]) - 1, d: Number(m[3]) } : null;
  };
  const a = p(startDate), b = p(endDate);
  if (!a || !b || !M[a.mo] || !M[b.mo]) return "";
  if (a.y === b.y && a.mo === b.mo) return `${a.d}-${b.d} ${M[a.mo]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${M[a.mo]} - ${b.d} ${M[b.mo]} ${a.y}`;
  return `${a.d} ${M[a.mo]} ${a.y} - ${b.d} ${M[b.mo]} ${b.y}`;
}

/**
 * Build the card for a trip. Written to read like a person describing their
 * trip in a group chat, because that is exactly where it lands.
 */
export function tripCard(opts: {
  title: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  coverImage?: string | null;
  stopCount?: number;
  memberCount?: number;
  dayCount?: number;
  url: string;
  joinable?: boolean;
}): OgCard {
  const range = formatRange(opts.startDate, opts.endDate);
  const bits: string[] = [];
  if (opts.destination) bits.push(opts.destination);
  if (range) bits.push(range);
  if (opts.dayCount) bits.push(`${opts.dayCount} day${opts.dayCount === 1 ? "" : "s"}`);
  if (opts.stopCount) bits.push(`${opts.stopCount} stop${opts.stopCount === 1 ? "" : "s"}`);
  if (opts.memberCount && opts.memberCount > 1) bits.push(`${opts.memberCount} travellers`);

  const tail = opts.joinable ? " Tap to see the plan and ask to join." : " Tap to see the full plan.";
  return {
    title: opts.title,
    description: (bits.join(" · ") || "A trip planned on Wayfare") + tail,
    image: opts.coverImage,
    url: opts.url,
    type: "article",
  };
}
