import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BedDouble, Check, Loader2, Mail, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { isUpgradeRequired } from "./utils";
import { useToast } from "./Toasts";

const SAMPLE_HOTEL_EMAIL = `From: confirmations@booking.com
Subject: Your booking at Park Hyatt Kyoto is confirmed

Dear traveler,
Your booking at Park Hyatt Kyoto is confirmed.
Hotel: Park Hyatt Kyoto
Address: 360 Kodaiji Masuyacho, Higashiyama-ku, Kyoto, Japan
Check-in: 2026-08-07 (from 15:00)
Check-out: 2026-08-10 (until 12:00)
Confirmation number: 3821.556.901
Total price: JPY 412,000

We look forward to welcoming you.`;

export interface HotelCandidate {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/**
 * "Import hotel from email" dialog (Voyager): paste a booking confirmation,
 * the server heuristically extracts the property + geocodes candidates with
 * Photon, and the traveler confirms one - filed as the trip's home base
 * (setHotel source "email"). UPGRADE_REQUIRED bubbles to the parent upsell.
 */
export default function EmailHotelImport({
  tripId,
  open,
  onOpenChange,
  onUpgradeRequired,
  onImported,
}: {
  tripId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpgradeRequired: () => void;
  onImported: () => void;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number | null>(null);

  const parse = trpc.trips.parseHotelEmail.useMutation({
    onError: e => {
      if (isUpgradeRequired(e)) {
        onOpenChange(false);
        onUpgradeRequired();
      } else {
        push({
          title: "Could not parse that email",
          description: e.message,
          kind: "danger",
        });
      }
    },
  });

  const setHotel = trpc.trips.setHotel.useMutation({
    onSuccess: () => {
      utils.trips.get.invalidate({ id: tripId });
      push({ title: "Hotel imported as home base", kind: "success" });
      resetAndClose();
      onImported();
    },
    onError: e => {
      if (isUpgradeRequired(e)) {
        resetAndClose();
        onUpgradeRequired();
      } else {
        push({
          title: "Could not save hotel",
          description: e.message,
          kind: "danger",
        });
      }
    },
  });

  const resetAndClose = () => {
    setText("");
    setPicked(null);
    parse.reset();
    setHotel.reset();
    onOpenChange(false);
  };

  const result = parse.data ?? null;
  const candidates: HotelCandidate[] = result?.candidates ?? [];

  const confirm = () => {
    const c = picked != null ? candidates[picked] : undefined;
    if (!c) return;
    setHotel.mutate({
      tripId,
      name: c.name,
      address: c.address || undefined,
      lat: c.lat,
      lng: c.lng,
      source: "email",
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => (o ? onOpenChange(true) : resetAndClose())}>
      <DialogContent
        style={{ maxWidth: "min(560px, calc(100% - 2rem))" }}
        className="rounded-xl border-border bg-surface p-5 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          <h3 className="type-h4 text-ink">Import hotel from email</h3>
        </div>
        <p className="type-caption mt-1 text-ink-3">
          Paste a booking confirmation (Booking.com, Agoda, Expedia, Airbnb,
          Hotels.com…), we’ll find the property and pin it as your home base.
        </p>

        <textarea
          value={text}
          onChange={e => {
            setText(e.target.value);
            setPicked(null);
            if (parse.data) parse.reset();
          }}
          rows={6}
          placeholder="Paste your hotel confirmation email…"
          aria-label="Paste your hotel confirmation email"
          className="type-small mt-3 w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={text.trim().length < 20 || parse.isPending || setHotel.isPending}
            onClick={() => {
              setPicked(null);
              parse.mutate({ tripId, text: text.trim() });
            }}
          >
            {parse.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <BedDouble className="h-4 w-4" strokeWidth={1.75} />
            )}
            {parse.isPending ? "Parsing…" : "Find my hotel"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setText(SAMPLE_HOTEL_EMAIL);
              setPicked(null);
              if (parse.data) parse.reset();
            }}
            className="type-small font-semibold text-brand transition-colors duration-fast hover:text-brand-strong"
          >
            Try a sample
          </button>
        </div>

        {/* parsed + geocoded candidates, traveler confirms one */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="mt-3"
            >
              {result.parsed.rawName ? (
                <p className="type-caption text-ink-3">
                  Found{" "}
                  <span className="font-semibold text-ink-2">
                    {result.parsed.rawName}
                  </span>
                  {result.parsed.rawCity ? (
                    <>
                      {" "}
                      in{" "}
                      <span className="font-semibold text-ink-2">
                        {result.parsed.rawCity}
                      </span>
                    </>
                  ) : null}. Confirm the right match:
                </p>
              ) : (
                <p className="type-caption text-ink-3">
                  We couldn’t spot a hotel name in that email, try pasting the
                  full confirmation, including the property details.
                </p>
              )}

              {candidates.length > 0 ? (
                <ul className="mt-2 space-y-1.5" role="listbox" aria-label="Hotel matches">
                  {candidates.map((c, i) => {
                    const active = picked === i;
                    return (
                      <li key={`${c.name}-${c.lat.toFixed(4)}-${c.lng.toFixed(4)}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => setPicked(i)}
                          className={`flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-all duration-fast ${
                            active
                              ? "border-brand bg-brand-soft"
                              : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-fast ${
                              active
                                ? "border-brand bg-brand text-brand-ink"
                                : "border-border-strong text-transparent"
                            }`}
                          >
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold text-ink">
                              {c.name}
                            </span>
                            {c.address ? (
                              <span className="type-caption mt-0.5 flex items-center gap-1 text-ink-3">
                                <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                                <span className="truncate">{c.address}</span>
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : result.parsed.rawName ? (
                <p className="type-caption mt-2 text-ink-3">
                  No map matches, check the name or add the city to the email
                  text.
                </p>
              ) : null}

              {candidates.length > 0 ? (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={resetAndClose}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="pine"
                    disabled={picked == null || setHotel.isPending}
                    onClick={confirm}
                  >
                    {setHotel.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : (
                      <BedDouble className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    Set as home base
                  </Button>
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
