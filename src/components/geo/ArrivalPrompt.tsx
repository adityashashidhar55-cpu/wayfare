import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClock, Bell, MapPin, Wallet, X } from "lucide-react";
import { useArrivalWatch } from "@/hooks/useArrivalWatch";

type NotifPermission = NotificationPermission | "unsupported";

function currentNotifPermission(): NotifPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/**
 * Arrival expense prompt (§10.4 sheet/toast language): when the geo watcher
 * detects the user at one of today's stops, a warm glass bottom-sheet
 * (mobile) / bottom-right card (desktop) offers to log an expense, snooze the
 * stop for 30 minutes, or dismiss it for the session. Also fires a system
 * Notification when permitted, with an inline ask while permission is
 * 'default'. Mounted once in AppShell - runs for guests and members alike.
 */
export default function ArrivalPrompt() {
  const { arrival, logExpense, snooze, dismiss } = useArrivalWatch();
  const [notifPermission, setNotifPermission] = useState<NotifPermission>(currentNotifPermission);

  /* System notification per arrival (when the OS lets us). */
  useEffect(() => {
    if (!arrival || currentNotifPermission() !== "granted") return;
    try {
      const n = new Notification(`You're at ${arrival.stopName}`, {
        body: `${arrival.tripTitle}, log an expense while it's fresh?`,
        tag: `wayfare-arrival-${arrival.stopId}`,
        icon: "/logo.svg",
      });
      n.onclick = () => window.focus();
    } catch {
      /* some platforms only allow notifications from a service worker */
    }
  }, [arrival]);

  /* Ask from the button click - browsers require a user gesture. */
  const enableNotifications = () => {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission()
      .then(p => setNotifPermission(p))
      .catch(() => setNotifPermission("unsupported"));
  };

  return (
    <AnimatePresence>
      {arrival ? (
        <motion.div
          key={arrival.stopId}
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="glass fixed inset-x-3 bottom-[76px] z-50 rounded-xl border border-brand/25 p-4 shadow-lg md:inset-x-auto md:bottom-6 md:right-6 md:w-[360px]"
          style={{
            background: "color-mix(in srgb, var(--brand-soft) 55%, var(--glass-strong))",
          }}
          role="dialog"
          aria-live="polite"
          aria-label={`Arrived at ${arrival.stopName}`}
        >
          {/* header */}
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
              <MapPin className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="type-caption font-semibold uppercase tracking-[0.14em] text-brand">
                You’ve arrived
              </p>
              <p className="type-small mt-1 text-ink-2">
                You’re at{" "}
                <span className="font-semibold text-ink">{arrival.stopName}</span>
                {arrival.startTime ? (
                  <span className="text-ink-3"> · {arrival.startTime}</span>
                ) : null} · {arrival.tripTitle}. Log an expense while it’s fresh?
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="rounded-md p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          {/* actions */}
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={logExpense}
              className="btn-sheen type-small flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
            >
              <Wallet className="h-4 w-4" strokeWidth={1.75} />
              Add expense
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => snooze(30)}
                className="type-small flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface font-semibold text-ink transition-colors duration-fast hover:bg-surface-2"
              >
                <AlarmClock className="h-3.5 w-3.5" strokeWidth={1.75} />
                Snooze 30m
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="type-small flex h-9 items-center justify-center rounded-md px-3 font-semibold text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
              >
                Not now
              </button>
            </div>
          </div>

          {/* notification ask, only while the OS permission is undecided */}
          {notifPermission === "default" ? (
            <button
              type="button"
              onClick={enableNotifications}
              className="type-caption mt-3 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 font-semibold text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-brand"
            >
              <Bell className="h-3 w-3" strokeWidth={1.75} />
              Enable notifications so you don’t miss the next stop
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
