import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Apple, Bot, Download, MonitorSmartphone, Smartphone } from 'lucide-react';
import { apiBase } from '@/lib/apiBase';

/** Chromium's install prompt event (not yet in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Get the app" strip on the landing page - the APK download, PWA install and
 * iOS Add-to-Home-Screen guidance, right on the first screen.
 */
export default function AppDownloadStrip() {
  const [apkExists, setApkExists] = useState(true);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    fetch(`${apiBase()}/downloads/wayfare.apk`, { method: 'HEAD' })
      .then((r) => setApkExists(r.ok))
      .catch(() => setApkExists(false));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return (
    <section className="relative border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-8 sm:flex-row sm:justify-between sm:gap-8">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Smartphone size={22} strokeWidth={1.75} />
          </span>
          <div>
            <p className="type-h4 text-ink">Wayfare in your pocket</p>
            <p className="type-body text-ink-3">
              Free Android app · installable on iPhone too, no store needed.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {apkExists && (
            <a
              href={`${apiBase()}/downloads/wayfare.apk`}
              download
              className="inline-flex items-center gap-2 rounded-pill bg-brand px-4 py-2.5 type-small font-medium text-white shadow-sm transition hover:brightness-105"
            >
              <Bot size={16} /> Download APK
            </a>
          )}
          {installEvt ? (
            <button
              type="button"
              onClick={() => void installEvt.prompt()}
              className="inline-flex items-center gap-2 rounded-pill border border-border bg-white/70 px-4 py-2.5 type-small font-medium text-ink transition hover:border-brand/40"
            >
              <Download size={15} /> Install as app
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-white/70 px-4 py-2.5 type-small font-medium text-ink-3">
              <Apple size={15} /> iPhone: Share → Add to Home Screen
            </span>
          )}
          <Link
            to="/get-app"
            className="inline-flex items-center gap-2 rounded-pill px-3 py-2.5 type-small font-medium text-brand transition hover:bg-brand-soft"
          >
            <MonitorSmartphone size={15} /> All options
          </Link>
        </div>
      </div>
    </section>
  );
}
