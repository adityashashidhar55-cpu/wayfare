/**
 * "See it on social" outbound links (r21-detail).
 *
 * Scraping TikTok/Instagram is not feasible (login walls), so the detail
 * dialog links out to each platform's own search for the place. All query
 * values are URL-encoded; every link opens in a new tab (rel="noreferrer").
 */

export interface SocialPlaceInput {
  name: string;
  city?: string | null;
  country?: string | null;
}

export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube' | 'reddit' | 'googlemaps';

export interface SocialLink {
  platform: SocialPlatform;
  label: string;
  url: string;
}

function query(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Lowercase alphanumeric hashtag slug, or "" when the name has none. */
function hashtagSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function socialLinksFor(place: SocialPlaceInput): SocialLink[] {
  const nameCity = query([place.name, place.city]);
  const nameCityCountry = query([place.name, place.city, place.country]);
  const slug = hashtagSlug(place.name);

  return [
    {
      platform: 'tiktok',
      label: 'TikTok',
      url: `https://www.tiktok.com/search?q=${encodeURIComponent(nameCity)}`,
    },
    {
      platform: 'instagram',
      label: 'Instagram',
      // hashtag search is the most reliable no-login landing page; fall back
      // to the keyword search URL when the name has no usable slug
      url: slug
        ? `https://www.instagram.com/explore/tags/${encodeURIComponent(slug)}/`
        : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(place.name.trim())}`,
    },
    {
      platform: 'youtube',
      label: 'YouTube',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(nameCity)}`,
    },
    {
      platform: 'reddit',
      label: 'Reddit',
      url: `https://www.reddit.com/search/?q=${encodeURIComponent(nameCity)}`,
    },
    {
      platform: 'googlemaps',
      label: 'Google Maps',
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nameCityCountry)}`,
    },
  ];
}
