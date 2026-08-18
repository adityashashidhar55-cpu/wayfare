/**
 * CrewTab (r32) - the group half of a trip, in one screen.
 *
 * The chat, voting and shared-checklist APIs shipped in r29 and had no UI at
 * all: fully tested procedures nobody could reach. This is that UI. It is one
 * tab rather than three because they are one activity - you argue about a
 * stop, you vote on it, you drop it.
 *
 * Chat polls rather than holding a socket. A trip has single-digit members
 * and a message every few minutes; a 5s poll with an `afterId` watermark
 * costs one indexed lookup that usually returns zero rows, and it survives
 * the sleeping laptops and flaky hotel wifi this app is actually used on.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2,
  MessageCircle,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import type { TripData, WsStop } from "./utils";
import { useToast } from "./Toasts";

const MAX_LEN = 2000; // matches the zod max in api/collab-router.ts
const POLL_MS = 5000;

const TIME_FMT = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });

type Msg = {
  id: number;
  authorName: string | null;
  body: string;
  userId: number | null;
  createdAt: string | Date;
};

function dayKey(at: string | Date): string {
  return new Date(at).toISOString().slice(0, 10);
}

/* ── chat ─────────────────────────────────────────────────────────────── */

function TripChat({ tripId, meId }: { tripId: number; meId: number | null }) {
  const { push } = useToast();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  // Watermark, held in a ref so the poll interval never restarts when it
  // moves - restarting it on every message would reset the 5s clock and, on
  // a busy trip, mean the poll effectively never fires.
  const sinceRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);

  const utils = trpc.useUtils();

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await utils.collab.messages.fetch({ tripId, afterId: sinceRef.current });
        if (cancelled || !res.messages.length) return;
        setMessages((prev) => {
          // The first page arrives whole; later pages are strictly newer. Dedupe
          // on id anyway - a retry after a timeout can deliver the same rows.
          const seen = new Set(prev.map((m) => m.id));
          const fresh = (res.messages as Msg[]).filter((m) => !seen.has(Number(m.id)));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        sinceRef.current = Math.max(sinceRef.current, Number(res.latestId));
      } catch {
        // A failed poll is not worth a toast; the next one is 5s away.
      }
    }
    void pull();
    const t = setInterval(pull, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tripId, utils]);

  // Stick to the bottom as messages arrive.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = trpc.collab.sendMessage.useMutation({
    onError: (e) => push({ title: e.message || "Could not send that", kind: "danger" }),
  });

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await send.mutateAsync({ tripId, body });
      setDraft("");
      // Pull immediately so the sender sees their own message at once rather
      // than up to 5s later. The server row is the source of truth - no
      // optimistic insert, so no duplicate when the poll catches up.
      const res = await utils.collab.messages.fetch({ tripId, afterId: sinceRef.current });
      if (res.messages.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = (res.messages as Msg[]).filter((m) => !seen.has(Number(m.id)));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        sinceRef.current = Math.max(sinceRef.current, Number(res.latestId));
      }
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => {
    const out: { day: string; items: Msg[] }[] = [];
    for (const m of messages) {
      const k = dayKey(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === k) last.items.push(m);
      else out.push({ day: k, items: [m] });
    }
    return out;
  }, [messages]);

  return (
    <section className="flex min-h-[26rem] flex-col rounded-2xl border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageCircle className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
        <h2 className="text-[13px] font-semibold text-ink">Trip chat</h2>
        <span className="ml-auto text-[11px] text-ink-3">Only this trip&rsquo;s members</span>
      </header>

      <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink-3">
            No messages yet. Start the argument about day three.
          </p>
        ) : null}
        {grouped.map((g) => (
          <div key={g.day} className="space-y-2">
            <div className="text-center text-[11px] font-medium text-ink-3">
              {DAY_FMT.format(new Date(g.day))}
            </div>
            {g.items.map((m) => {
              const mine = meId != null && Number(m.userId) === meId;
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2",
                      mine ? "bg-ink text-surface" : "bg-surface-2 text-ink",
                    )}
                  >
                    {!mine ? (
                      <div className="mb-0.5 text-[11px] font-semibold text-ink-3">
                        {m.authorName ?? "Someone"}
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                      {m.body}
                    </p>
                    <div
                      className={cn(
                        "mt-0.5 text-[10px]",
                        mine ? "text-surface/60" : "text-ink-3",
                      )}
                    >
                      {TIME_FMT.format(new Date(m.createdAt))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder="Message the group"
          aria-label="Message the group"
          className="max-h-28 flex-1 resize-none rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        <button
          onClick={() => void submit()}
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-ink text-surface transition-opacity disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Send className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </section>
  );
}

/* ── voting ───────────────────────────────────────────────────────────── */

type Tally = { stopId: number; up: number; down: number; mine: "up" | "down" | null; score: number };

function StopVotes({
  tripId,
  stops,
  canEdit,
}: {
  tripId: number;
  stops: WsStop[];
  canEdit: boolean;
}) {
  const { push } = useToast();
  const utils = trpc.useUtils();
  const votesQ = trpc.collab.votes.useQuery({ tripId });

  const byStop = useMemo(() => {
    const m = new Map<number, Tally>();
    for (const v of (votesQ.data?.votes ?? []) as Tally[]) m.set(Number(v.stopId), v);
    return m;
  }, [votesQ.data]);

  const vote = trpc.collab.voteStop.useMutation({
    onSuccess: () => utils.collab.votes.invalidate({ tripId }),
    onError: (e) => push({ title: e.message || "Could not record that vote", kind: "danger" }),
  });

  const apply = trpc.collab.applyVotes.useMutation({
    onSuccess: async (res) => {
      // `removed` is a COUNT, not a list - the names come back separately so
      // the toast can say what actually left the plan instead of a bare number.
      const n = res.removed;
      push(
        n
          ? {
              title: `Dropped ${n} stop${n === 1 ? "" : "s"}`,
              description: `${res.names.slice(0, 3).join(", ")}${n > 3 ? ` and ${n - 3} more` : ""}`,
              kind: "success",
            }
          : { title: "Nothing was voted down", kind: "info" },
      );
      await Promise.all([
        utils.collab.votes.invalidate({ tripId }),
        utils.trips.get.invalidate({ id: tripId }),
      ]);
    },
    onError: (e) => push({ title: e.message || "Could not apply the votes", kind: "danger" }),
  });

  // Contested stops first - a stop nobody has voted on is the least
  // interesting thing on this screen, and burying the disputed ones under
  // forty untouched ones is how a voting feature goes unused.
  const ordered = useMemo(() => {
    return [...stops].sort((a, b) => {
      const ta = byStop.get(Number(a.id));
      const tb = byStop.get(Number(b.id));
      const na = (ta?.up ?? 0) + (ta?.down ?? 0);
      const nb = (tb?.up ?? 0) + (tb?.down ?? 0);
      if (na !== nb) return nb - na;
      return (ta?.score ?? 0) - (tb?.score ?? 0);
    });
  }, [stops, byStop]);

  const downCount = ordered.filter((s) => (byStop.get(Number(s.id))?.score ?? 0) < 0).length;

  return (
    <section className="flex min-h-[26rem] flex-col rounded-2xl border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Users className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
        <h2 className="text-[13px] font-semibold text-ink">What the group thinks</h2>
        {votesQ.isLoading ? (
          <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-ink-3" strokeWidth={2} />
        ) : null}
      </header>

      <div className="flex-1 divide-y divide-border overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink-3">
            Add some stops first, then vote on them here.
          </p>
        ) : null}
        {ordered.map((s) => {
          const t = byStop.get(Number(s.id));
          const score = t?.score ?? 0;
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{s.name}</div>
                {t && t.up + t.down > 0 ? (
                  <div className="text-[11px] text-ink-3">
                    {t.up} for &middot; {t.down} against
                  </div>
                ) : (
                  <div className="text-[11px] text-ink-3">No votes yet</div>
                )}
              </div>
              <span
                className={cn(
                  "w-7 shrink-0 text-center text-[13px] font-semibold tabular-nums",
                  score > 0 ? "text-[#44604F]" : score < 0 ? "text-[#BC5934]" : "text-ink-3",
                )}
              >
                {score > 0 ? `+${score}` : score}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => vote.mutate({ tripId, stopId: Number(s.id), vote: "up" })}
                  aria-label={`Vote for ${s.name}`}
                  aria-pressed={t?.mine === "up"}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-pill transition-colors",
                    t?.mine === "up" ? "bg-[#44604F] text-white" : "bg-surface-2 text-ink-3 hover:text-ink",
                  )}
                >
                  <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                <button
                  onClick={() => vote.mutate({ tripId, stopId: Number(s.id), vote: "down" })}
                  aria-label={`Vote against ${s.name}`}
                  aria-pressed={t?.mine === "down"}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-pill transition-colors",
                    t?.mine === "down" ? "bg-[#BC5934] text-white" : "bg-surface-2 text-ink-3 hover:text-ink",
                  )}
                >
                  <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {canEdit ? (
        <div className="border-t border-border p-3">
          <button
            onClick={() => apply.mutate({ tripId, minNetDown: 1 })}
            disabled={downCount === 0 || apply.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-pill bg-surface-2 px-3.5 py-2 text-[13px] font-semibold text-ink transition-opacity disabled:opacity-40"
          >
            {apply.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {downCount === 0
              ? "Nothing is voted down"
              : `Drop ${downCount} voted-down stop${downCount === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/* ── tab ──────────────────────────────────────────────────────────────── */

export default function CrewTab({ data, tripId }: { data: TripData; tripId: number }) {
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const meId = me.data?.id != null ? Number(me.data.id) : null;

  // Voting is open to every member; applying the result changes the plan, so
  // the server restricts that to owner/editor. Mirror the rule here rather
  // than showing a button that always fails.
  const myRole = useMemo(() => {
    if (meId == null) return null;
    const mine = data.members.find((m) => m.userId != null && Number(m.userId) === meId);
    return mine?.role ?? null;
  }, [data.members, meId]);
  const canEdit = myRole === "owner" || myRole === "editor";

  return (
    <AnimatePresence initial={false}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="grid gap-4 px-4 py-4 md:px-6 lg:grid-cols-2"
      >
        <TripChat tripId={tripId} meId={meId} />
        <StopVotes tripId={tripId} stops={data.stops} canEdit={canEdit} />
      </motion.div>
    </AnimatePresence>
  );
}
