import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import type { ListedTrip } from '@/components/trips/utils';

/**
 * Trip card overflow menu: rename (any member) + delete (owner only).
 * Trigger styles come from the parent (glass chip on cards).
 */
export function TripCardMenu({
  trip,
  isOwner,
  triggerClassName,
}: {
  trip: ListedTrip;
  isOwner: boolean;
  triggerClassName?: string;
}) {
  const utils = trpc.useUtils();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState(trip.title);

  const invalidate = () => utils.trips.list.invalidate();
  const rename = trpc.trips.update.useMutation({
    onSuccess: () => {
      invalidate();
      setRenameOpen(false);
      toast.success('Trip renamed');
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.trips.remove.useMutation({
    onSuccess: () => {
      invalidate();
      setDeleteOpen(false);
      toast.success('Trip deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Options for ${trip.title}`} className={triggerClassName}>
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={() => {
              setTitle(trip.title);
              setRenameOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" strokeWidth={1.75} />
            Rename
          </DropdownMenuItem>
          {isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                Delete trip
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[420px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="type-h3">Rename trip</DialogTitle>
            <DialogDescription className="type-small text-ink-2">
              Give this journey a name worth remembering.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = title.trim();
              if (t && t !== trip.title) rename.mutate({ id: trip.id, title: t });
              else setRenameOpen(false);
            }}
            className="space-y-5"
          >
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              className="h-11 rounded-md border-border-strong bg-surface"
              aria-label="Trip name"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={rename.isPending || !title.trim()}>
                {rename.isPending ? 'Saving…' : 'Save name'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete (owner only) */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="type-h3">Delete “{trip.title}”?</AlertDialogTitle>
            <AlertDialogDescription className="type-small text-ink-2">
              This removes the itinerary, expenses, and notes for everyone on the trip. There’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep trip</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => remove.mutate({ id: trip.id })}
              className="bg-danger text-white hover:brightness-110"
            >
              {remove.isPending ? 'Deleting…' : 'Delete trip'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
