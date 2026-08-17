import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { dayLabel, shortDate } from "./utils";
import type { WsDay, WsStop } from "./utils";
import { useToast } from "./Toasts";

const FIELD =
  "type-small h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40";

export interface StopEditDialogProps {
  stop: WsStop | null;
  days: WsDay[];
  tripId: number;
  onClose: () => void;
}

/** Stop detail sheet (§1.3): edit time, duration, notes, category, day; delete. */
export default function StopEditDialog({
  stop,
  days,
  tripId,
  onClose,
}: StopEditDialogProps) {
  return (
    <Dialog
      open={stop != null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="rounded-xl sm:max-w-md"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="type-h3 text-ink">Edit stop</DialogTitle>
        </DialogHeader>
        {stop ? (
          <StopEditForm
            key={stop.id}
            stop={stop}
            days={days}
            tripId={tripId}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* Form is keyed by stop id so fields reset per stop without sync effects. */
function StopEditForm({
  stop,
  days,
  tripId,
  onClose,
}: {
  stop: WsStop;
  days: WsDay[];
  tripId: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const [name, setName] = useState(stop.name);
  const [category, setCategory] = useState(stop.category ?? "activity");
  const [dayId, setDayId] = useState<number | null>(stop.dayId ?? null);
  const [startTime, setStartTime] = useState(stop.startTime ?? "");
  const [durationMin, setDurationMin] = useState(
    stop.durationMin != null ? String(stop.durationMin) : ""
  );
  const [notes, setNotes] = useState(stop.notes ?? "");

  const addStop = trpc.trips.addStop.useMutation({
    onSuccess: () => utils.trips.get.invalidate({ id: tripId }),
  });

  const updateStop = trpc.trips.updateStop.useMutation({
    onSuccess: () => {
      utils.trips.get.invalidate({ id: tripId });
      push({ title: "Stop updated", kind: "success" });
      onClose();
    },
    onError: e =>
      push({
        title: "Could not update stop",
        description: e.message,
        kind: "danger",
      }),
  });

  const deleteStop = trpc.trips.deleteStop.useMutation({
    onSuccess: () => {
      utils.trips.get.invalidate({ id: tripId });
      if (stop) {
        const snapshot = stop;
        push({
          title: `Removed ${snapshot.name}`,
          kind: "info",
          actionLabel: "Undo",
          onAction: () =>
            addStop.mutate({
              tripId,
              dayId: snapshot.dayId ?? null,
              name: snapshot.name,
              category: snapshot.category,
              address: snapshot.address ?? undefined,
              lat: snapshot.lat ?? undefined,
              lng: snapshot.lng ?? undefined,
              startTime: snapshot.startTime ?? null,
              durationMin: snapshot.durationMin ?? null,
              notes: snapshot.notes ?? undefined,
              image: snapshot.image ?? undefined,
            }),
        });
      }
      onClose();
    },
    onError: e =>
      push({
        title: "Could not delete stop",
        description: e.message,
        kind: "danger",
      }),
  });

  const save = () => {
    if (!stop || !name.trim()) return;
    updateStop.mutate({
      id: stop.id,
      tripId,
      dayId,
      name: name.trim(),
      category,
      startTime: startTime || null,
      durationMin: durationMin ? Number(durationMin) : null,
      notes: notes.trim() || null,
    });
  };

  const orderedDays = [...days].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="ws-stop-name" className="type-caption text-ink-3">
          Name
        </Label>
        <input
          id="ws-stop-name"
          value={name}
          onChange={e => setName(e.target.value)}
          className={FIELD}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ws-stop-cat" className="type-caption text-ink-3">
            Category
          </Label>
          <select
            id="ws-stop-cat"
            value={category}
            onChange={e => setCategory(e.target.value)}
            className={FIELD}
          >
            <option value="activity">Activity</option>
            <option value="food">Food</option>
            <option value="lodging">Lodging</option>
            <option value="transport">Transport</option>
            <option value="shopping">Shopping</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-stop-day" className="type-caption text-ink-3">
            Day
          </Label>
          <select
            id="ws-stop-day"
            value={dayId == null ? "none" : String(dayId)}
            onChange={e =>
              setDayId(
                e.target.value === "none" ? null : Number(e.target.value)
              )
            }
            className={FIELD}
          >
            {orderedDays.map((d, i) => (
              <option key={d.id} value={d.id}>
                {dayLabel(i)} · {shortDate(d.date)}
              </option>
            ))}
            <option value="none">Unscheduled</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-stop-time" className="type-caption text-ink-3">
            Start time
          </Label>
          <input
            id="ws-stop-time"
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-stop-dur" className="type-caption text-ink-3">
            Duration (min)
          </Label>
          <input
            id="ws-stop-dur"
            type="number"
            min={5}
            step={5}
            value={durationMin}
            onChange={e => setDurationMin(e.target.value)}
            placeholder="60"
            className={FIELD}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-stop-notes" className="type-caption text-ink-3">
          Notes
        </Label>
        <textarea
          id="ws-stop-notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Reservation code, tips, what to order…"
          className="type-small w-full resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="danger-ghost"
          size="sm"
          onClick={() => deleteStop.mutate({ id: stop.id, tripId })}
          disabled={deleteStop.isPending}
        >
          <Trash2 className="h-4 w-4" /> Remove stop
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={!name.trim() || updateStop.isPending}
          >
            {updateStop.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
