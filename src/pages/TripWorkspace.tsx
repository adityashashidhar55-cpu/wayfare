import { useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { isForbiddenError, shareTokenFromError } from "@/lib/trip-access";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider } from "@/components/workspace/Toasts";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import type { WorkspaceTab } from "@/components/workspace/WorkspaceHeader";
import ItineraryTab from "@/components/workspace/ItineraryTab";
import CrewTab from "@/components/workspace/CrewTab";
import ReservationsTab from "@/components/workspace/ReservationsTab";
import ChecklistsTab from "@/components/workspace/ChecklistsTab";
import NotesTab from "@/components/workspace/NotesTab";

const TABS: WorkspaceTab[] = [
  "itinerary",
  "crew",
  "reservations",
  "checklists",
  "notes",
];

/* ── full-workspace loading skeleton ── */

function WorkspaceSkeleton() {
  return (
    <div aria-busy aria-label="Loading trip">
      <div className="border-b border-border px-4 py-3 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-sm" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-3 h-9 w-[380px] max-w-full rounded-full" />
      </div>
      <div className="flex h-[calc(100dvh-176px)] min-h-[440px]">
        <div className="hidden w-[480px] shrink-0 space-y-4 border-r border-border p-4 lg:block">
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-[72px] w-full rounded-md" />
              <Skeleton className="h-[72px] w-full rounded-md" />
            </div>
          ))}
        </div>
        <div className="relative flex-1 bg-bg-subtle">
          <Skeleton className="absolute right-3 top-3 h-40 w-10 rounded-xl" />
          <Skeleton className="absolute bottom-5 left-1/2 h-12 w-[196px] -translate-x-1/2 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/* ── graceful not-found ── */

function TripNotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <img
        src="/empty-globe.svg"
        alt=""
        className="h-[140px] w-[187px] opacity-90"
      />
      <h1 className="type-h2 text-ink">We couldn’t find that trip</h1>
      <p className="type-body max-w-[44ch] text-ink-2">
        It may have been archived, or the link is incomplete. Your other
        journeys are right where you left them.
      </p>
      <Link
        to="/trips"
        className="btn-sheen type-small mt-1 flex h-10 items-center gap-2 rounded-pill bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} /> Back to your trips
      </Link>
    </div>
  );
}

/* ── friendly no-access state (r15-access) ──
   Shown when trips.get returns FORBIDDEN and the trip has NO active share
   link (otherwise we redirect to the public /shared/:token view instead). */

function TripNoAccess() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <img
        src="/empty-globe.svg"
        alt=""
        className="h-[140px] w-[187px] opacity-90"
      />
      <h1 className="type-h2 text-ink">You don’t have access to this trip</h1>
      <p className="type-body max-w-[44ch] text-ink-2">
        Ask the owner to share the trip’s public link or invite you as a
        member, then it will show up right here.
      </p>
      <Link
        to="/trips"
        className="btn-sheen type-small mt-1 flex h-10 items-center gap-2 rounded-pill bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} /> Back to your trips
      </Link>
    </div>
  );
}

/* ── tab content with the global app page-transition (§7.2).
   Itinerary stays mounted (map state preserved, no re-init flash - §cross-cutting). ── */

function TabContent({
  tab,
  ...props
}: { tab: WorkspaceTab } & React.ComponentProps<typeof ItineraryTab>) {
  return (
    <>
      <div
        className={tab === "itinerary" ? undefined : "hidden"}
        aria-hidden={tab !== "itinerary"}
      >
        <ItineraryTab {...props} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {tab !== "itinerary" ? (
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "crew" ? <CrewTab {...props} /> : null}
            {tab === "reservations" ? <ReservationsTab {...props} /> : null}
            {tab === "checklists" ? <ChecklistsTab {...props} /> : null}
            {tab === "notes" ? <NotesTab {...props} /> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

export default function TripWorkspace() {
  const { id: idParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tripId = Number(idParam);

  const tabParam = searchParams.get("tab");
  const tab: WorkspaceTab = TABS.includes(tabParam as WorkspaceTab)
    ? (tabParam as WorkspaceTab)
    : "itinerary";
  const [localTab, setLocalTab] = useState<WorkspaceTab | null>(null);
  const activeTab = localTab ?? tab;

  const setTab = (t: WorkspaceTab) => {
    setLocalTab(t);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (t === "itinerary") next.delete("tab");
        else next.set("tab", t);
        return next;
      },
      { replace: true }
    );
  };

  const { data, isLoading, isError, error } = trpc.trips.get.useQuery(
    { id: tripId },
    { enabled: Number.isFinite(tripId), retry: 1 }
  );

  if (!Number.isFinite(tripId)) return <TripNotFound />;
  if (isLoading) return <WorkspaceSkeleton />;
  if (isError || !data) {
    // r15-access: a 403 on a trip with an ACTIVE share link means the user
    // opened a copied workspace URL - send them to the public read-only
    // view instead of a dead error. Without a share link, explain kindly.
    if (isForbiddenError(error)) {
      const shareToken = shareTokenFromError(error);
      if (shareToken) return <Navigate to={`/shared/${shareToken}`} replace />;
      return <TripNoAccess />;
    }
    return <TripNotFound />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <WorkspaceHeader
          data={data}
          tripId={tripId}
          tab={activeTab}
          onTabChange={setTab}
        />
        <TabContent tab={activeTab} data={data} tripId={tripId} />
      </ToastProvider>
    </MotionConfig>
  );
}
