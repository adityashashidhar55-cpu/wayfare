import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, NotebookPen } from "lucide-react";
import { trpc } from "@/providers/trpc";
import type { TripData } from "./utils";
import { useToast } from "./Toasts";

type SaveState = "idle" | "dirty" | "saving" | "saved";

function timeAgo(date: Date): string {
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Notes tab - one calm, auto-saving doc per trip (§4 + cross-cutting autosave).
 * Debounced save → `trips.saveNote`; “Saved” tick then fades to a timestamp.
 */
export default function NotesTab({
  data,
  tripId,
}: {
  data: TripData;
  tripId: number;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [content, setContent] = useState(data.note?.content ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(
    data.note?.updatedAt ? new Date(data.note.updatedAt) : null
  );
  const [, setTick] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);
  const latest = useRef(content);
  latest.current = content;
  const serverContent = useRef(data.note?.content ?? "");
  serverContent.current = data.note?.content ?? "";

  /* auto-grow */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  /* refresh “Saved … ago” caption */
  useEffect(() => {
    if (state !== "saved") return;
    const t = window.setInterval(() => setTick(n => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [state]);

  const save = trpc.trips.saveNote.useMutation({
    onMutate: () => setState("saving"),
    onSuccess: () => {
      setState("saved");
      setSavedAt(new Date());
      utils.trips.get.setData({ id: tripId }, old =>
        old
          ? {
              ...old,
              note: {
                id: old.note?.id ?? -1,
                tripId,
                title: old.note?.title ?? "Notes",
                content: latest.current,
                updatedAt: new Date(),
              },
            }
          : old
      );
    },
    onError: e => {
      setState("dirty");
      push({
        title: "Could not save notes",
        description: e.message,
        kind: "danger",
      });
    },
  });

  const saveRef = useRef(save);
  saveRef.current = save;

  /* debounced autosave */
  useEffect(() => {
    if (content === (data.note?.content ?? "")) return;
    setState("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      saveRef.current.mutate({ tripId, content: latest.current });
    }, 800);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, tripId]);

  /* flush pending edits when the tab unmounts (tab switch) */
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (latest.current !== serverContent.current) {
        saveRef.current.mutate({ tripId, content: latest.current });
      }
    },
    [tripId]
  );

  return (
    <div className="mx-auto max-w-[820px] px-4 py-6 md:px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-lg border border-border bg-surface shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <p className="type-h4 flex items-center gap-2 text-ink">
            <NotebookPen className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
            Trip notes
          </p>
          {/* autosave indicator (§cross-cutting): check tick → fades to timestamp */}
          <span
            className="type-caption flex items-center gap-1.5 text-ink-3"
            aria-live="polite"
          >
            {state === "saving" ? (
              <>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={1.75}
                />{" "}
                Saving…
              </>
            ) : state === "saved" ? (
              <>
                <motion.svg
                  key={savedAt?.getTime() ?? "saved"}
                  viewBox="0 0 12 12"
                  className="h-3.5 w-3.5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <motion.path
                    d="M2.5 6.4l2.3 2.3L9.5 3.4"
                    fill="none"
                    stroke="var(--pine)"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.2 }}
                  />
                </motion.svg>
                <span className="text-pine">Saved</span>
                {savedAt ? (
                  <span className="text-ink-3">· {timeAgo(savedAt)}</span>
                ) : null}
              </>
            ) : state === "dirty" ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-ochre"
                  aria-hidden
                />{" "}
                Unsaved changes
              </span>
            ) : savedAt ? (
              <span>Saved {timeAgo(savedAt)}</span>
            ) : null}
          </span>
        </div>
        <textarea
          ref={areaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Trip ideas, door codes, dinner plans…"
          rows={10}
          aria-label="Trip notes"
          className="type-body min-h-[320px] w-full resize-none rounded-b-lg bg-transparent px-5 py-4 leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </motion.div>
      <p className="type-caption mt-2 px-1 text-ink-3">
        Notes save automatically as you type and are shared with everyone on
        this trip.
      </p>
    </div>
  );
}
