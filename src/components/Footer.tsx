import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Github, Instagram, Twitter, Youtube } from 'lucide-react';
import { CompassMark } from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';

const COLUMNS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/#features' },
      { label: 'Explore', to: '/explore' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Voyager', to: '/pricing' },
      { label: 'Get the app', to: '/get-app' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/' },
      { label: 'Journal', to: '/' },
      { label: 'Careers', to: '/' },
      { label: 'Contact', to: '/' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Help center', to: '/' },
      { label: 'City guides', to: '/explore' },
      { label: 'Community', to: '/' },
      { label: 'Status', to: '/' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', to: '/' },
      { label: 'Terms', to: '/' },
      { label: 'Cookies', to: '/' },
    ],
  },
];

const SOCIALS = [
  { icon: Twitter, label: 'Twitter' },
  { icon: Instagram, label: 'Instagram' },
  { icon: Youtube, label: 'YouTube' },
  { icon: Github, label: 'GitHub' },
];

/** Marketing footer (design.md §10.3) with giant ghost wordmark. */
export default function Footer() {
  return (
    <footer className="relative z-[2] border-t border-border bg-bg-subtle">
      <div className="mx-auto max-w-[1200px] px-6 py-24">
        {/* Giant ghost wordmark, letter-spacing animates −0.02→0em on enter */}
        <motion.div
          initial={{ letterSpacing: '-0.02em', opacity: 0.55 }}
          whileInView={{ letterSpacing: '0em', opacity: 1 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
          className="pointer-events-none mb-16 flex items-baseline justify-center overflow-hidden select-none"
        >
          <span className="whitespace-nowrap font-display text-[clamp(72px,12vw,160px)] leading-none text-border-strong">
            wayfare
          </span>
          <CompassMark className="ml-[0.06em] h-[clamp(36px,6vw,80px)] w-[clamp(36px,6vw,80px)] self-center text-brand" />
        </motion.div>

        {/* Link columns */}
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="type-eyebrow mb-4 text-ink-3">{col.title}</h4>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      to={l.to}
                      className="group relative text-[14px] text-ink-2 transition-colors duration-fast hover:text-ink"
                    >
                      {l.label}
                      <span className="absolute -bottom-px left-0 h-px w-0 bg-ink transition-all duration-base ease-expo group-hover:w-full" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Data attribution (r25). Required, not decorative: the place corpus
            is derived from OpenStreetMap, whose ODbL licence obliges us to
            credit it, and photos come from Wikimedia Commons under CC-BY-SA
            and friends. We were shipping 500k+ derived rows with no credit
            anywhere. */}
        <div className="mt-16 border-t border-border pt-8">
          <p className="type-small text-ink-3">
            Place data ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-border underline-offset-2 transition-colors hover:text-ink-2"
            >
              OpenStreetMap
            </a>{' '}
            contributors, licensed under{' '}
            <a
              href="https://opendatacommons.org/licenses/odbl/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-border underline-offset-2 transition-colors hover:text-ink-2"
            >
              ODbL
            </a>
            . Geocoding by Photon. Weather by{' '}
            <a
              href="https://open-meteo.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-border underline-offset-2 transition-colors hover:text-ink-2"
            >
              Open-Meteo
            </a>
            . Photographs from Wikimedia Commons and Wikipedia under their respective licences.
          </p>
        </div>

        {/* Bottom row */}
        <div className="mt-8 flex flex-col items-center justify-between gap-6 border-t border-border pt-8 md:flex-row">
          <p className="type-small text-ink-3">© 2025 Wayfare. Every journey, beautifully planned.</p>
          <div className="flex items-center gap-1">
            {SOCIALS.map(({ icon: Icon, label }) => (
              <a
                key={label}
                href="#"
                aria-label={label}
                onClick={(e) => e.preventDefault()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="type-small rounded-pill border border-border px-3 py-1.5 text-ink-2">EN · USD</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}
