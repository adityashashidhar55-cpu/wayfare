/**
 * "See it on social" (r21-detail): compact branded outbound buttons that
 * open each platform's own search for this place in a new tab. Scraping
 * TikTok/Instagram posts is not feasible (login walls), so we link out
 * instead of embedding. Glyphs are simple inline SVGs, no image assets.
 */
import { socialLinksFor, type SocialPlatform } from '@/lib/social-links';

function BrandGlyph({ platform }: { platform: SocialPlatform }) {
  const common = 'h-3.5 w-3.5 shrink-0';
  switch (platform) {
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={common} aria-hidden="true">
          <path d="M16.6 3c.35 1.98 1.73 3.43 3.9 3.68v3.02c-1.43.05-2.8-.34-3.9-1.1v6.15c0 3.4-2.39 5.75-5.6 5.75-3.1 0-5.5-2.4-5.5-5.4 0-3.13 2.6-5.53 5.9-5.33v3.13c-1.5-.2-2.8.8-2.8 2.2 0 1.3 1.1 2.3 2.4 2.3 1.5 0 2.5-1 2.5-2.7V3h3.1Z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={common} aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={common} aria-hidden="true">
          <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
        </svg>
      );
    case 'reddit':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={common} aria-hidden="true">
          <path d="M22 12a2.2 2.2 0 0 0-3.7-1.63 10.6 10.6 0 0 0-5.2-1.62l.98-3.8 2.9.66a1.9 1.9 0 1 0 .19-.9l-3.4-.78a.5.5 0 0 0-.59.4l-1.16 4.5a10.6 10.6 0 0 0-5.1 1.54A2.2 2.2 0 1 0 4 13.7c0 .1.01.2.02.3 0 2.9 3.6 5.3 8 5.3s8-2.4 8-5.3v-.3A2.2 2.2 0 0 0 22 12ZM8.4 13.6a1.4 1.4 0 1 1 1.4 1.4 1.4 1.4 0 0 1-1.4-1.4Zm7.2 4.1a4.9 4.9 0 0 1-3.6 1 4.9 4.9 0 0 1-3.6-1 .5.5 0 0 1 .7-.7 3.9 3.9 0 0 1 2.9.8 3.9 3.9 0 0 1 2.9-.8.5.5 0 0 1 .7.7Zm-.2-2.7a1.4 1.4 0 1 1 1.4-1.4 1.4 1.4 0 0 1-1.4 1.4Z" />
        </svg>
      );
    case 'googlemaps':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={common} aria-hidden="true">
          <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z" />
        </svg>
      );
  }
}

interface SocialLinksSectionProps {
  name: string;
  city?: string | null;
  country?: string | null;
}

export default function SocialLinksSection({ name, city, country }: SocialLinksSectionProps) {
  const links = socialLinksFor({ name, city, country });
  return (
    <div className="mt-4">
      <p className="type-eyebrow text-pine">See it on social</p>
      <p className="type-caption mt-1 text-ink-3">See how this place looks on social</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {links.map((link) => (
          <a
            key={link.platform}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="type-small inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-3 py-1.5 font-medium text-ink-2 shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-surface-2 hover:text-ink hover:shadow-md"
          >
            <BrandGlyph platform={link.platform} />
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
