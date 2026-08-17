/**
 * FriendChatPanel (r24-social) - lean internal group chat for a friend
 * planning session. Polls friends.listMessages every 5s with a since-id
 * watermark; sends via the participant token; Enter-to-send. Geist via the
 * global type classes; dark pill send button per the v25/v26 language.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';

const MAX_LEN = 2000; // matches MAX_CHAT_BODY in api/friends-router

const TIME_FMT = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const DAY_FMT = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' });

type Msg = {
  id: number;
  name: string;
  body: string;
  createdAt: string | Date;
  mine: boolean;
};

export function FriendChatPanel({ token, canChat }: { token: string; canChat: boolean }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const sinceRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const send = trpc.friends.sendMessage.useMutation();

  // 5s polling with a since-id watermark.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await utils.client.friends.listMessages.query({ token, sinceId: sinceRef.current });
        if (stop) return;
        if (res.messages.length) {
          sinceRef.current = res.messages[res.messages.length - 1]!.id;
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = (res.messages as Msg[]).filter((m) => !seen.has(m.id));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
        }
      } catch {
        /* transient poll failure - try again next tick */
      }
      if (!stop) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Stick to the bottom unless the user scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    if (body.length > MAX_LEN) {
      toast.error(`Keep messages under ${MAX_LEN} characters`);
      return;
    }
    try {
      const res = await send.mutateAsync({ token, body });
      setDraft('');
      // Optimistic append; the next poll dedupes by id.
      setMessages((prev) => [...prev, { id: res.id, name: 'You', body, createdAt: new Date(), mine: true }]);
      sinceRef.current = Math.max(sinceRef.current, res.id);
      stickRef.current = true;
    } catch (e) {
      toast.error('Message not sent', { description: e instanceof Error ? e.message : undefined });
    }
  };

  let lastDay = '';
  return (
    <section aria-label="Group chat" className="rounded-lg border border-border bg-surface shadow-sm">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageCircle className="h-4 w-4 text-brand" strokeWidth={1.75} />
        <h2 className="type-small font-semibold text-ink">Group chat</h2>
        <span className="type-caption text-ink-3">just this crew, refreshes every few seconds</span>
      </header>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="max-h-[320px] min-h-[120px] space-y-2 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="type-small py-6 text-center text-ink-3">
            No messages yet, say hi and start plotting.
          </p>
        ) : (
          messages.map((m) => {
            const day = DAY_FMT.format(new Date(m.createdAt));
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {showDay && (
                  <p className="type-caption py-1 text-center text-ink-3">{day}</p>
                )}
                <div className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-3.5 py-2',
                      m.mine ? 'bg-wayfare-dark text-[#fafafa]' : 'bg-surface-2 text-ink',
                    )}
                  >
                    {!m.mine && (
                      <p className="type-caption font-semibold text-brand">{m.name}</p>
                    )}
                    <p className="type-small whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={cn('mt-0.5 text-right text-[10px]', m.mine ? 'text-white/60' : 'text-ink-3')}>
                      {TIME_FMT.format(new Date(m.createdAt))}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {canChat ? (
        <form
          className="flex items-end gap-2 border-t border-border px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN * 2))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Message the group…"
            aria-label="Message the group"
            rows={1}
            className="type-small max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-ink outline-none placeholder:text-ink-3 focus:border-brand"
          />
          <button
            type="submit"
            disabled={!draft.trim() || send.isPending}
            aria-label="Send message"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-wayfare-dark text-[#fafafa] transition-all duration-fast hover:brightness-125 active:scale-95 disabled:opacity-40"
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
        </form>
      ) : (
        <p className="type-caption border-t border-border px-4 py-3 text-ink-3">
          Join the plan with your name above to chat.
        </p>
      )}
    </section>
  );
}
