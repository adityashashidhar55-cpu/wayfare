import { Bus, Car, Sparkles, TrainFront } from "lucide-react";

/* ── Intercity transfer chips (r9-roadtrip) ─────────────────────────────────
   Road-trip transport stops carry their commute options in notes as
   JSON.stringify({ transfer: { fromCity, toCity, km, options } }). These
   helpers parse that payload (fail-soft) and render it as a compact chip
   row: "🚗 2h40 · 🚆 2h05 JR · 🚌 3h30 (est.)". */

export interface CommuteOptionView {
  kind: "car" | "train" | "bus";
  label: string;
  durationMin: number;
  km: number;
  transfers?: number;
  estimated: boolean;
}

export interface TransferView {
  fromCity: string;
  toCity: string;
  km: number;
  options: CommuteOptionView[];
  /** Famous-route name when this leg follows a matched popular route. */
  routeTag?: string;
}

/** Parse a stop's notes into transfer info; null for plain-text/absent notes. */
export function parseTransferNotes(notes: string | null | undefined): TransferView | null {
  if (!notes) return null;
  try {
    const parsed: unknown = JSON.parse(notes);
    const t = (parsed as { transfer?: unknown } | null)?.transfer as Partial<TransferView> | undefined;
    if (
      !t ||
      typeof t.fromCity !== "string" ||
      typeof t.toCity !== "string" ||
      typeof t.km !== "number" ||
      !Array.isArray(t.options) ||
      t.options.length === 0
    ) {
      return null;
    }
    return t as TransferView;
  } catch {
    return null;
  }
}

const KIND_ICON = { car: Car, train: TrainFront, bus: Bus } as const;

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? `${String(m).padStart(2, "0")}` : ""}` : `${m}m`;
}

export function TransferChips({ transfer }: { transfer: TransferView }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5" onClick={e => e.stopPropagation()}>
      {transfer.options.map((o, i) => {
        const Icon = KIND_ICON[o.kind] ?? Car;
        const changes = o.transfers ? ` · ${o.transfers} change${o.transfers === 1 ? "" : "s"}` : "";
        return (
          <span
            key={`${o.kind}-${i}`}
            title={`${transfer.fromCity} → ${transfer.toCity} · ${o.label} · ${fmtMin(o.durationMin)}${changes} · ${o.km} km${o.estimated ? " (rough estimate, no live schedule)" : ""}`}
            className="type-caption tnum inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-ink-2"
          >
            <Icon className="h-3 w-3" strokeWidth={1.75} />
            {fmtMin(o.durationMin)}
            <span className="max-w-[110px] truncate">{o.label}</span>
            {o.estimated ? "(est.)" : ""}
          </span>
        );
      })}
      {transfer.routeTag && (
        <span
          title={`This leg follows the ${transfer.routeTag}, a famous route`}
          className="type-caption inline-flex items-center gap-1 rounded-pill bg-brand-soft px-2 py-0.5 font-semibold text-brand"
        >
          <Sparkles className="h-3 w-3" strokeWidth={1.75} />
          {transfer.routeTag}
        </span>
      )}
    </span>
  );
}
