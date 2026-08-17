import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Apple,
  Bot,
  Check,
  Copy,
  Download,
  MonitorSmartphone,
  PlusSquare,
  Share,
  Smartphone,
} from 'lucide-react';
import { CompassMark } from '@/components/Logo';
import { EASE_EXPO } from '@/lib/motion';
import { apiBase } from '@/lib/apiBase';

/** Chromium's install prompt event (not yet in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const section = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_EXPO } },
};

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="type-caption mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-brand">
        {n}
      </span>
      <span className="type-body text-ink-2">{children}</span>
    </li>
  );
}

export default function GetApp() {
  const origin = window.location.origin;
  const [apkAvailable, setApkAvailable] = useState<boolean | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches
  );
  const [copied, setCopied] = useState(false);

  /* The APK is committed per-deployment; show a "coming soon" state when the
     binary isn't present rather than a dead button. */
  useEffect(() => {
    fetch(`${apiBase()}/downloads/wayfare.apk`, { method: 'HEAD' })
      .then((r) => setApkAvailable(r.ok))
      .catch(() => setApkAvailable(false));
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const onInstalled = () => setInstalled(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const copyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable, the address is selectable */
    }
  };

  const promptInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 pb-24 pt-28 md:pt-36">
      {/* Hero */}
      <motion.div variants={section} initial="hidden" animate="show" className="mb-14 text-center">
        <CompassMark className="mx-auto mb-5 h-12 w-12 text-brand" />
        <h1 className="type-display mb-4">Get the Wayfare app</h1>
        <p className="type-body-l mx-auto max-w-[52ch] text-ink-2">
          Take your trips with you, on Android, iPhone, or straight from this
          browser as an installable app.
        </p>
      </motion.div>

      <div className="space-y-6">
        {/* ── Android ─────────────────────────────────────────────── */}
        <motion.section
          variants={section}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8"
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-pine-soft text-pine">
              <Bot className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h2 className="type-h2">Android</h2>
          </div>

          {apkAvailable ? (
            <a
              href={`${apiBase()}/downloads/wayfare.apk`}
              download
              className="btn-sheen mb-6 inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3.5 text-[15px] font-semibold text-brand-ink shadow-md transition-colors duration-fast hover:bg-brand-strong"
            >
              <Download className="h-[18px] w-[18px]" strokeWidth={2} />
              Download APK
            </a>
          ) : (
            <div className="mb-6">
              <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-surface-2 px-6 py-3.5 text-[15px] font-semibold text-ink-3">
                <Download className="h-[18px] w-[18px]" strokeWidth={2} />
                {apkAvailable === null ? 'Checking for APK…' : 'APK coming soon'}
              </span>
              {apkAvailable === false && (
                <p className="type-small mt-2 text-ink-3">
                  The Android package for this deployment hasn't been published
                  yet, use the browser install below in the meantime.
                </p>
              )}
            </div>
          )}

          <ol className="mb-6 space-y-3">
            <Step n={1}>Download the APK on your Android phone using the button above.</Step>
            <Step n={2}>
              When prompted, allow installs from this source (Settings → Apps →
              your browser → <em>Install unknown apps</em>).
            </Step>
            <Step n={3}>Open the downloaded file and tap <em>Install</em>.</Step>
            <Step n={4}>
              On first launch the app asks for your server address, enter the
              one shown below.
            </Step>
          </ol>

          <div className="rounded-md border border-border bg-bg p-4">
            <p className="type-caption mb-2 text-ink-3">YOUR SERVER ADDRESS</p>
            <div className="flex items-center gap-2">
              <code className="type-numeral flex-1 select-all break-all rounded-sm bg-surface px-3 py-2 text-[14px] text-brand">
                {origin}
              </code>
              <button
                type="button"
                onClick={copyOrigin}
                aria-label="Copy server address"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" strokeWidth={2} />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>
        </motion.section>

        {/* ── iPhone / iPad ───────────────────────────────────────── */}
        <motion.section
          variants={section}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8"
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-2 text-ink">
              <Apple className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h2 className="type-h2">iPhone &amp; iPad</h2>
          </div>
          <p className="type-body mb-5 text-ink-2">
            A native iOS package needs a Mac to build, so for now Wayfare
            installs as a full-screen app straight from Safari, same icon, same
            experience, no App Store required.
          </p>
          <ol className="space-y-3">
            <Step n={1}>
              Open <span className="select-all font-medium text-ink">{origin}</span> in{' '}
              <strong className="font-medium text-ink">Safari</strong>.
            </Step>
            <Step n={2}>
              Tap the <Share className="mb-0.5 inline h-4 w-4 text-info" strokeWidth={1.75} />{' '}
              <em>Share</em> button in the toolbar.
            </Step>
            <Step n={3}>
              Scroll down and tap{' '}
              <PlusSquare className="mb-0.5 inline h-4 w-4 text-ink-2" strokeWidth={1.75} />{' '}
              <em>Add to Home Screen</em>.
            </Step>
            <Step n={4}>Tap <em>Add</em>. Wayfare now launches full-screen from your Home Screen.</Step>
          </ol>
        </motion.section>

        {/* ── Install as app (PWA) ────────────────────────────────── */}
        <motion.section
          variants={section}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          className="rounded-xl border border-border bg-surface p-6 shadow-sm md:p-8"
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-soft text-brand">
              <MonitorSmartphone className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <h2 className="type-h2">Install as app</h2>
          </div>
          <p className="type-body mb-5 text-ink-2">
            On Android Chrome, desktop Chrome, or Edge you can install this site
            as an app, it gets its own window, icon, and offline shell.
          </p>
          {installed ? (
            <p className="inline-flex items-center gap-2 rounded-md bg-pine-soft px-5 py-3 text-[15px] font-medium text-pine">
              <Check className="h-[18px] w-[18px]" strokeWidth={2} />
              Wayfare is installed on this device
            </p>
          ) : installPrompt ? (
            <button
              type="button"
              onClick={promptInstall}
              className="btn-sheen inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3.5 text-[15px] font-semibold text-brand-ink shadow-md transition-colors duration-fast hover:bg-brand-strong"
            >
              <Smartphone className="h-[18px] w-[18px]" strokeWidth={2} />
              Install Wayfare
            </button>
          ) : (
            <p className="type-small text-ink-3">
              Your browser will offer installation from its menu (⋮ →{' '}
              <em>Install app</em> / <em>Add to Home Screen</em>) when it's ready.
            </p>
          )}
        </motion.section>
      </div>
    </div>
  );
}
