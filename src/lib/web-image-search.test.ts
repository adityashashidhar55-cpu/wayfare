/**
 * Client-side web image search tests (r20-links). Fetch is fully mocked:
 * Openverse/Wikimedia are unreachable from the sandbox, and the point of the
 * client path is that the BROWSER calls them (both are CORS-open).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mapCommonsPage,
  mapOpenverseItem,
  mergeImageHits,
  searchWebImagesClient,
  stripHtml,
} from './web-image-search';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stripHtml', () => {
  it('strips tags and entities from Wikimedia Artist values', () => {
    expect(stripHtml('<a href="https://x">Jane &amp; Co</a>')).toBe('Jane & Co');
    expect(stripHtml('<b>Bold</b>   text')).toBe('Bold text');
    expect(stripHtml('plain')).toBe('plain');
  });
});

describe('mapOpenverseItem', () => {
  it('maps url/thumb/title/creator/license/landing url with attribution', () => {
    const hit = mapOpenverseItem({
      url: 'https://live.staticflickr.com/1/2/3_b.jpg',
      thumbnail: 'https://live.staticflickr.com/1/2/3_m.jpg',
      title: "Prophet's Mosque",
      license: 'by-sa',
      license_version: '4.0',
      creator: 'Jane Doe',
      foreign_landing_url: 'https://flickr.com/photos/jane/3',
    });
    expect(hit).toEqual({
      url: 'https://live.staticflickr.com/1/2/3_b.jpg',
      thumb: 'https://live.staticflickr.com/1/2/3_m.jpg',
      title: "Prophet's Mosque",
      source: 'openverse',
      sourceLabel: 'Openverse',
      license: 'BY-SA 4.0',
      creator: 'Jane Doe',
      landingUrl: 'https://flickr.com/photos/jane/3',
      attribution: 'Jane Doe · BY-SA 4.0',
    });
  });

  it('rejects items without a usable image url', () => {
    expect(mapOpenverseItem({ url: 'not-a-url' })).toBeNull();
    expect(mapOpenverseItem({ title: 'no url' })).toBeNull();
  });
});

describe('mapCommonsPage', () => {
  it('maps thumburl/url + Artist/LicenseShortName from extmetadata', () => {
    const hit = mapCommonsPage({
      title: 'File:Senso-ji at night.jpg',
      imageinfo: [
        {
          url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/sensoji.jpg',
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/sensoji.jpg/400px.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Senso-ji_at_night.jpg',
          extmetadata: {
            Artist: { value: '<a href="https://commons.wikimedia.org/wiki/User:K">Ken K</a>' },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
          },
        },
      ],
    });
    expect(hit).toMatchObject({
      url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/sensoji.jpg',
      thumb: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/sensoji.jpg/400px.jpg',
      title: 'Senso-ji at night.jpg',
      source: 'wikimedia',
      sourceLabel: 'Wikimedia Commons',
      license: 'CC BY-SA 4.0',
      creator: 'Ken K',
      landingUrl: 'https://commons.wikimedia.org/wiki/File:Senso-ji_at_night.jpg',
      attribution: 'Ken K · CC BY-SA 4.0',
    });
  });

  it('falls back to source label when metadata is missing', () => {
    const hit = mapCommonsPage({
      title: 'File:X.jpg',
      imageinfo: [{ url: 'https://upload.wikimedia.org/x.jpg' }],
    });
    expect(hit).toMatchObject({ creator: null, license: null, attribution: 'Wikimedia Commons', thumb: 'https://upload.wikimedia.org/x.jpg' });
    expect(mapCommonsPage({ title: 'File:X.jpg' })).toBeNull();
  });
});

describe('mergeImageHits', () => {
  const hit = (url: string, source: 'openverse' | 'wikimedia') => ({
    url,
    thumb: url,
    title: url,
    source,
    sourceLabel: source,
    license: null,
    creator: null,
    landingUrl: null,
    attribution: '',
  });

  it('interleaves sources and dedupes by url', () => {
    const merged = mergeImageHits(
      [
        [hit('https://a/1', 'openverse'), hit('https://a/2', 'openverse'), hit('https://a/3', 'openverse')],
        [hit('https://b/1', 'wikimedia'), hit('https://a/2', 'wikimedia')],
      ],
      10,
    );
    expect(merged.map((h) => h.url)).toEqual(['https://a/1', 'https://b/1', 'https://a/2', 'https://a/3']);
  });

  it('caps at max', () => {
    const merged = mergeImageHits([[hit('https://a/1', 'openverse'), hit('https://a/2', 'openverse')]], 1);
    expect(merged).toHaveLength(1);
  });
});

describe('searchWebImagesClient', () => {
  const ovBody = {
    results: [
      {
        url: 'https://img.example.org/ov.jpg',
        thumbnail: 'https://img.example.org/ov_t.jpg',
        title: 'OV pic',
        license: 'by',
        license_version: '4.0',
        creator: 'Ann',
        foreign_landing_url: 'https://example.org/ov',
      },
    ],
  };
  const wmBody = {
    query: {
      pages: {
        '123': {
          title: 'File:WM pic.jpg',
          imageinfo: [{ url: 'https://upload.wikimedia.org/wm.jpg', extmetadata: { LicenseShortName: { value: 'CC0' } } }],
        },
      },
    },
  };
  const fetchFor = (ovRes: () => Promise<Response>, wmRes: () => Promise<Response>) =>
    vi.fn((input: unknown) => (String(input).includes('openverse') ? ovRes() : wmRes()));

  it('merges Openverse + Wikimedia hits from parallel fetches', async () => {
    vi.stubGlobal('fetch', fetchFor(async () => jsonResponse(ovBody), async () => jsonResponse(wmBody)));
    const res = await searchWebImagesClient('senso-ji tokyo', 12);
    expect(res.unavailable).toBe(false);
    expect(res.candidates.map((c) => c.source)).toEqual(['openverse', 'wikimedia']);
  });

  it('Wikimedia request carries origin=* (CORS) and File: namespace', async () => {
    const mock = fetchFor(async () => jsonResponse(ovBody), async () => jsonResponse(wmBody));
    vi.stubGlobal('fetch', mock);
    await searchWebImagesClient('kyoto', 12);
    const wmUrl = String(mock.mock.calls.find((c) => String(c[0]).includes('commons.wikimedia.org'))?.[0]);
    expect(wmUrl).toContain('origin=*');
    expect(wmUrl).toContain('gsrnamespace=6');
  });

  it('one source failing still returns the other (not unavailable)', async () => {
    vi.stubGlobal('fetch', fetchFor(async () => Promise.reject(new Error('blocked')), async () => jsonResponse(wmBody)));
    const res = await searchWebImagesClient('kyoto', 12);
    expect(res.unavailable).toBe(false);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]!.source).toBe('wikimedia');
  });

  it('BOTH sources failing → unavailable (caller falls back to the server)', async () => {
    vi.stubGlobal('fetch', fetchFor(async () => Promise.reject(new Error('blocked')), async () => jsonResponse({}, 500)));
    const res = await searchWebImagesClient('kyoto', 12);
    expect(res).toEqual({ candidates: [], unavailable: true });
  });

  it('blank query short-circuits without fetching', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    expect(await searchWebImagesClient('   ')).toEqual({ candidates: [], unavailable: false });
    expect(mock).not.toHaveBeenCalled();
  });
});
