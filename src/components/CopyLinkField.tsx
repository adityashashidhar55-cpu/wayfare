import { useRef, useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Bulletproof share-link field (r14-linkfix): the FULL absolute URL lives in a
 * readonly input that selects-all on focus/click (so it can always be copied
 * by hand), a Copy button with a non-clipboard fallback (re-select + Ctrl/Cmd+C
 * hint), and an Open button so users can sanity-check the link in a new tab.
 */
export function CopyLinkField({
  url,
  label = 'Share link',
  copiedLabel = 'Copied',
  className,
  shareText,
  showWhatsApp = true,
}: {
  url: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  /** Message that precedes the link when sharing. */
  shareText?: string;
  showWhatsApp?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const selectAll = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    el.setSelectionRange(0, el.value.length); // iOS Safari
  };

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Clipboard API unavailable (insecure context / denied) - legacy path.
      try {
        selectAll();
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      toast.success(copiedLabel, { description: url });
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Last resort: leave the full URL selected for a manual copy.
      selectAll();
      toast.info('Press Ctrl+C (⌘C) to copy', {
        description: 'Your browser blocked clipboard access, the link is selected for you.',
      });
    }
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        ref={inputRef}
        readOnly
        value={url}
        aria-label={label}
        onFocus={selectAll}
        onClick={selectAll}
        className="type-caption h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-ink-2 outline-none transition-colors duration-fast focus:border-brand"
      />
      <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? (
          <Check className="h-3.5 w-3.5 text-pine" strokeWidth={2} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {/* r25: WhatsApp share. A shared trip pulls in 3-8 people and that
          referral loop is the one growth channel we control - but it only
          fires if the invite reaches people where they actually are. In
          India that is WhatsApp, not an in-app notification. wa.me works on
          web and mobile with no SDK and no Business API account. */}
      {showWhatsApp && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Share on WhatsApp"
          className="shrink-0 bg-[#25D366]/12 text-[#128C7E] hover:bg-[#25D366]/20 dark:text-[#25D366]"
          onClick={() => {
            const text = shareText ? `${shareText}\n${url}` : url;
            window.open(
              `https://wa.me/?text=${encodeURIComponent(text)}`,
              '_blank',
              'noopener,noreferrer',
            );
          }}
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          WhatsApp
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Open ${label} in a new tab`}
        onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
        Open
      </Button>
    </div>
  );
}
