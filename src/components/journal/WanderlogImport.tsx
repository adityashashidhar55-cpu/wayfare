/**
 * Wanderlog import modal (journal feature): two modes - paste a public
 * Wanderlog trip/guide URL, or paste the page text/notes. Calls
 * trpc.journal.importWanderlog, shows the match summary, then opens the new
 * draft in the editor.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowDownToLine, Check, ClipboardPaste, Link2, Loader2 } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Mode = 'url' | 'text';

interface ImportResult {
  id: number;
  matched: number;
  total: number;
}

export default function WanderlogImport({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importMut = trpc.journal.importWanderlog.useMutation({
    onSuccess: (data) => {
      setResult(data);
      void utils.journal.list.invalidate();
      // Brief beat so the traveler sees the match summary, then open the draft.
      window.setTimeout(() => {
        reset();
        onOpenChange(false);
        navigate(`/journal/${data.id}/edit`);
      }, 1500);
    },
    onError: (e) =>
      setError(e.message || 'That import did not work, try pasting the page text instead.'),
  });

  function reset() {
    setMode('url');
    setUrl('');
    setText('');
    setError(null);
    setResult(null);
  }

  const canSubmit =
    !importMut.isPending && (mode === 'url' ? url.trim().length > 8 : text.trim().length >= 20);

  function submit() {
    setError(null);
    if (mode === 'url') importMut.mutate({ url: url.trim() });
    else importMut.mutate({ text: text.trim() });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="rounded-xl sm:max-w-[520px]">
        <DialogHeader>
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-md bg-brand-soft text-brand">
            <ArrowDownToLine className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <DialogTitle className="type-h3">Import from Wanderlog</DialogTitle>
          <DialogDescription className="type-small text-ink-2">
            Bring a Wanderlog trip or guide in as a draft journal entry. Places we recognize are
            attached automatically.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-2.5 py-6 text-center"
          >
            <motion.span
              initial={{ scale: 0.55 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-pine-soft text-pine"
            >
              <Check className="h-5 w-5" strokeWidth={2} />
            </motion.span>
            <p className="type-h4 text-ink">Imported draft ready</p>
            <p className="type-small max-w-[40ch] text-ink-2">
              {result.total > 0
                ? `Imported draft with ${result.matched} of ${result.total} places matched.`
                : 'Imported draft, attach places to it in the editor.'}
            </p>
            <p className="type-caption inline-flex items-center gap-1.5 text-ink-3">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              Opening the editor…
            </p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {/* Mode switch */}
            <div className="inline-flex rounded-pill bg-surface-2 p-1" role="tablist" aria-label="Import mode">
              {(
                [
                  { key: 'url', label: 'Paste link', icon: Link2 },
                  { key: 'text', label: 'Paste text', icon: ClipboardPaste },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={mode === t.key}
                  onClick={() => {
                    setMode(t.key);
                    setError(null);
                  }}
                  className={cn(
                    'relative inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-fast',
                    mode === t.key ? 'text-ink' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {mode === t.key && (
                    <motion.span
                      layoutId="wanderlog-mode-pill"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                      className="absolute inset-0 rounded-pill bg-surface shadow-sm"
                    />
                  )}
                  <t.icon className="relative z-[1] h-3.5 w-3.5" strokeWidth={1.75} />
                  <span className="relative z-[1]">{t.label}</span>
                </button>
              ))}
            </div>

            {mode === 'url' ? (
              <div>
                <label htmlFor="wanderlog-url" className="type-caption text-ink-3">
                  WANDERLOG LINK
                </label>
                <Input
                  id="wanderlog-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://wanderlog.com/view/…"
                  inputMode="url"
                  autoFocus
                  className="mt-1.5 h-11 rounded-md border-border-strong bg-surface"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit) submit();
                  }}
                />
                <p className="type-caption mt-2 text-ink-3">
                  Works with public wanderlog.com trip and guide pages.
                </p>
              </div>
            ) : (
              <div>
                <label htmlFor="wanderlog-text" className="type-caption text-ink-3">
                  PAGE TEXT OR NOTES
                </label>
                <Textarea
                  id="wanderlog-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Copy the Wanderlog page (Ctrl/Cmd+A, Ctrl/Cmd+C) and paste it here…"
                  rows={7}
                  className="mt-1.5 rounded-md border-border-strong bg-surface"
                />
                <p className="type-caption mt-2 text-ink-3">
                  Handy when the link is private, we scan the text for place names.
                </p>
              </div>
            )}

            {error && (
              <p className="type-small rounded-md bg-ochre-soft px-3 py-2 text-ink">{error}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!canSubmit}>
                {importMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <ArrowDownToLine className="h-4 w-4" strokeWidth={1.75} />
                )}
                {importMut.isPending ? 'Importing…' : 'Import as draft'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
