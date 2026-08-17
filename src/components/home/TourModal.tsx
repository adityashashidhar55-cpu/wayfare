import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import tourVideo from '@/assets/wayfare-tour.mp4';

const VALUES = [
  { caption: 'Itineraries that build themselves', body: 'Drop places in. Wayfare numbers your days and keeps walk times honest.' },
  { caption: 'Maps that stay out of your way', body: 'A quiet canvas where your pins and routes do the talking.' },
  { caption: 'Budgets that split fairly', body: 'Every expense categorized, converted, and squared up with friends.' },
];

/**
 * "Watch the tour" modal - the 12s product tour video plus the three
 * value captions as a static strip (no auto-rotation).
 */
export default function TourModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] overflow-hidden rounded-xl border-border bg-surface p-0">
        <DialogTitle className="sr-only">Wayfare tour video</DialogTitle>
        <DialogDescription className="sr-only">
          A 12-second video tour of the Wayfare workspace: itineraries, maps and budgets.
        </DialogDescription>
        {open ? (
          <video
            src={tourVideo}
            controls
            autoPlay
            playsInline
            preload="metadata"
            aria-label="Wayfare tour video"
            className="aspect-video w-full bg-black object-cover"
          />
        ) : null}
        <div className="grid grid-cols-1 gap-4 border-t border-border px-6 py-5 sm:grid-cols-3">
          {VALUES.map((v) => (
            <div key={v.caption}>
              <div className="type-h4 text-ink">{v.caption}</div>
              <div className="type-small mt-0.5 text-ink-2">{v.body}</div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
