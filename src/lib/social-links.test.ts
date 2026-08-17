import { describe, expect, it } from 'vitest';
import { socialLinksFor } from './social-links';

/**
 * r21-detail - "See it on social" URL builders: correct endpoints,
 * URL-encoded queries, graceful Instagram fallback.
 */

describe('socialLinksFor', () => {
  const links = socialLinksFor({ name: 'Meenakshi Temple', city: 'Madurai', country: 'India' });
  const byPlatform = Object.fromEntries(links.map((l) => [l.platform, l.url]));

  it('builds all five platform links', () => {
    expect(links.map((l) => l.platform)).toEqual([
      'tiktok',
      'instagram',
      'youtube',
      'reddit',
      'googlemaps',
    ]);
  });

  it('URL-encodes the place name and city', () => {
    expect(byPlatform.tiktok).toBe('https://www.tiktok.com/search?q=Meenakshi%20Temple%20Madurai');
    expect(byPlatform.youtube).toBe(
      'https://www.youtube.com/results?search_query=Meenakshi%20Temple%20Madurai',
    );
    expect(byPlatform.reddit).toBe('https://www.reddit.com/search/?q=Meenakshi%20Temple%20Madurai');
  });

  it('includes the country in the Google Maps query', () => {
    expect(byPlatform.googlemaps).toBe(
      'https://www.google.com/maps/search/?api=1&query=Meenakshi%20Temple%20Madurai%20India',
    );
  });

  it('uses an Instagram hashtag URL when a clean slug exists', () => {
    expect(byPlatform.instagram).toBe('https://www.instagram.com/explore/tags/meenakshitemple/');
  });

  it('falls back to Instagram keyword search when no slug exists', () => {
    const [ig] = socialLinksFor({ name: '!!!', city: 'Nowhere' }).filter(
      (l) => l.platform === 'instagram',
    );
    expect(ig!.url).toBe('https://www.instagram.com/explore/search/keyword/?q=!!!');
  });

  it('works without a city or country', () => {
    const [tt] = socialLinksFor({ name: 'Eiffel Tower' });
    expect(tt.url).toBe('https://www.tiktok.com/search?q=Eiffel%20Tower');
  });

  it('encodes ampersands and special characters', () => {
    const [tt] = socialLinksFor({ name: 'R&M Café <test>', city: 'Zürich' });
    expect(tt.url).toBe(
      `https://www.tiktok.com/search?q=${encodeURIComponent('R&M Café <test> Zürich')}`,
    );
    expect(tt.url).not.toContain('&M');
  });
});
