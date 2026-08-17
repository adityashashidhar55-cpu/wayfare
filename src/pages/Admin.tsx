import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ClipboardCheck, Compass, Database, Inbox, LayoutDashboard, LifeBuoy, MapPin, NotebookPen, ShieldCheck, Users } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Toaster } from '@/components/ui/sonner';
import { EASE_EXPO } from '@/lib/motion';
import { OverviewTab } from '@/components/admin/OverviewTab';
import { ReviewTab } from '@/components/admin/ReviewTab';
import { PlacesTab } from '@/components/admin/PlacesTab';
import { PlacesDbTab } from '@/components/admin/PlacesDbTab';
import { StoriesTab } from '@/components/admin/StoriesTab';
import { PeopleTab } from '@/components/admin/PeopleTab';
import { DiscoverTab } from '@/components/admin/DiscoverTab';
import { RequestsTab } from '@/components/admin/RequestsTab';
import { SupportTab } from '@/components/admin/SupportTab';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPO } },
};

const TABS = [
  { value: 'review', label: 'Review', icon: ClipboardCheck },
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'places', label: 'Places', icon: MapPin },
  { value: 'database', label: 'Database', icon: Database },
  { value: 'stories', label: 'Stories', icon: NotebookPen },
  { value: 'people', label: 'People', icon: Users },
  { value: 'discover', label: 'Discover', icon: Compass },
  { value: 'requests', label: 'Requests', icon: Inbox },
  { value: 'support', label: 'Support', icon: LifeBuoy },
] as const;

function AdminSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10" aria-label="Loading admin">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded-sm bg-surface-2" />
        <div className="h-8 w-40 animate-pulse rounded-md bg-surface-2" />
      </div>
      <div className="mt-6 h-10 w-full max-w-[420px] animate-pulse rounded-pill bg-surface-2" />
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-[128px] animate-pulse rounded-xl border border-border bg-surface md:first:col-span-2"
          />
        ))}
      </div>
    </div>
  );
}

/** Friendly gate for non-admins - rendered in place, no redirect. */
function AdminsOnly() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 px-4 py-16 md:px-6">
      <Empty className="rounded-xl border border-dashed border-border bg-surface shadow-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 rounded-full bg-brand-soft text-brand">
            <ShieldCheck strokeWidth={1.75} />
          </EmptyMedia>
          <EmptyTitle className="type-h3 text-ink">Admins only</EmptyTitle>
          <EmptyDescription className="type-small text-ink-2">
            This is the back room where the Wayfare atlas gets tidy. It’s reserved for the admin
            team, but your next journey is out there waiting.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link
            to="/trips"
            className="btn-sheen type-small inline-flex h-10 items-center gap-2 rounded-md bg-brand px-5 font-semibold text-brand-ink shadow-sm transition-all duration-fast hover:-translate-y-px hover:bg-brand-strong hover:shadow-md active:scale-[0.97]"
          >
            Back to your trips
          </Link>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export default function Admin() {
  const me = trpc.auth.me.useQuery();

  if (me.isLoading) return <AdminSkeleton />;
  if (me.data?.role !== 'admin') return <AdminsOnly />;
  return <AdminDashboard />;
}

/** Admin console - only rendered once the admin role is confirmed. */
function AdminDashboard() {
  const [tab, setTab] = useState('review');
  const statsQ = trpc.admin.stats.useQuery();
  const requestsQ = trpc.admin.cityRequests.useQuery();
  const ticketStatsQ = trpc.admin.ticketStats.useQuery();
  const pendingCount = statsQ.data?.pendingPlaces ?? 0;
  const requestCount = requestsQ.data?.pendingCount ?? 0;
  const openTicketCount = ticketStatsQ.data?.open ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-8 md:px-6 md:py-10">
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
        <motion.header variants={item}>
          <p className="type-eyebrow text-brand">Control room</p>
          <h2 className="type-h2 mt-1 text-ink">Admin</h2>
          <p className="type-small mt-1 text-ink-2">
            Platform health, place curation, and the stories your travelers tell.
          </p>
        </motion.header>

        <motion.div variants={item}>
          <Tabs value={tab} onValueChange={setTab} className="gap-6">
            <TabsList className="h-10 max-w-full justify-start overflow-x-auto rounded-pill bg-surface-2 p-1">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="flex-none gap-1.5 rounded-pill px-4 text-[13px] font-semibold text-ink-2 data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm"
                >
                  <t.icon strokeWidth={1.75} />
                  {t.label}
                  {t.value === 'review' && pendingCount > 0 && (
                    <span className="type-caption tnum inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-ochre-soft px-1 font-semibold text-ochre">
                      {pendingCount}
                    </span>
                  )}
                  {t.value === 'requests' && requestCount > 0 && (
                    <span className="type-caption tnum inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-ochre-soft px-1 font-semibold text-ochre">
                      {requestCount}
                    </span>
                  )}
                  {t.value === 'support' && openTicketCount > 0 && (
                    <span className="type-caption tnum inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-ochre-soft px-1 font-semibold text-ochre">
                      {openTicketCount}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="review">
              <ReviewTab />
            </TabsContent>
            <TabsContent value="overview">
              <OverviewTab onShowReview={() => setTab('review')} />
            </TabsContent>
            <TabsContent value="places">
              <PlacesTab />
            </TabsContent>
            <TabsContent value="database">
              <PlacesDbTab />
            </TabsContent>
            <TabsContent value="stories">
              <StoriesTab />
            </TabsContent>
            <TabsContent value="people">
              <PeopleTab />
            </TabsContent>
            <TabsContent value="discover">
              <DiscoverTab />
            </TabsContent>
            <TabsContent value="requests">
              <RequestsTab />
            </TabsContent>
            <TabsContent value="support">
              <SupportTab />
            </TabsContent>
          </Tabs>
        </motion.div>
      </motion.div>
      <Toaster position="bottom-center" />
    </div>
  );
}
