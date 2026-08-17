import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { Crown, Loader2, Lock, Route } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface OptimizePillProps {
  isVoyager: boolean;
  loading: boolean;
  /** fired on click - parent decides optimize vs upsell */
  onRun: () => void;
  upsellOpen: boolean;
  onUpsellOpenChange: (open: boolean) => void;
}

/** Animated reorder loop shown inside the free-tier upsell (§1.7 “watch it work”). */
function MiniDemo() {
  const [order, setOrder] = useState([3, 1, 4, 2]);
  useEffect(() => {
    const t = window.setInterval(() => {
      setOrder(o => {
        const next = [...o];
        const i = Math.floor(Math.random() * next.length);
        let j = Math.floor(Math.random() * next.length);
        if (j === i) j = (j + 1) % next.length;
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      });
    }, 1400);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="relative flex h-16 items-center justify-center gap-2 overflow-hidden rounded-md bg-surface-2">
      {order.map(n => (
        <motion.span
          key={n}
          layout
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-pine font-serif text-[12px] font-semibold text-white shadow-sm"
        >
          {n}
        </motion.span>
      ))}
      <span className="glass absolute inset-0 flex items-center justify-center bg-surface/40">
        <Lock className="h-4 w-4 text-ink-2" strokeWidth={1.75} />
      </span>
    </div>
  );
}

/**
 * Floating “Optimize route” pill (§1.6–1.7): pine fill, breathing idle,
 * ochre crown micro-badge. Voyager runs the optimizer; Wanderer gets the upsell.
 */
export default function OptimizePill({
  isVoyager,
  loading,
  onRun,
  upsellOpen,
  onUpsellOpenChange,
}: OptimizePillProps) {
  return (
    <Popover
      open={isVoyager ? false : upsellOpen}
      onOpenChange={onUpsellOpenChange}
    >
      <PopoverTrigger asChild>
        <span className="inline-block">
          <motion.button
            type="button"
            onClick={onRun}
            animate={loading ? { scale: 1 } : { scale: [1, 1.02, 1] }}
            transition={
              loading
                ? { duration: 0.15 }
                : { duration: 3, repeat: Infinity, ease: "easeInOut" }
            }
            whileTap={{ scale: 0.97 }}
            className="relative flex h-12 min-w-[196px] items-center justify-center gap-2 rounded-pill bg-pine px-6 text-[15px] font-semibold text-white shadow-lg transition-colors duration-fast hover:brightness-110"
            aria-label="Optimize route"
          >
            {loading ? (
              <>
                <Loader2
                  className="h-[18px] w-[18px] animate-spin"
                  strokeWidth={2}
                />
                <span className="type-small">Finding the best order…</span>
              </>
            ) : (
              <>
                <Route className="h-[18px] w-[18px]" strokeWidth={1.75} />
                Optimize route
              </>
            )}
            <span
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ochre text-white shadow-sm"
              title="Voyager feature"
            >
              <Crown className="h-3 w-3" strokeWidth={2} />
            </span>
          </motion.button>
        </span>
      </PopoverTrigger>
      {!isVoyager ? (
        <PopoverContent
          side="top"
          align="center"
          sideOffset={14}
          className="w-[min(420px,calc(100vw-32px))] rounded-xl p-4"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ochre-soft text-ochre">
                <Crown className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div>
                <p className="type-h4 text-ink">Optimize with Voyager</p>
                <p className="type-caption text-ink-3">
                  One tap untangles your day
                </p>
              </div>
            </div>
            <MiniDemo />
            <p className="type-small leading-relaxed text-ink-2">
              Voyager members save hours of backtracking, we reorder each day’s
              stops into the shortest sensible route, live on the map.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="premium"
                pill
                size="sm"
                className="flex-1"
                asChild
              >
                <Link to="/pricing">
                  <Crown className="h-3.5 w-3.5" /> Upgrade to Voyager
                </Link>
              </Button>
              <Button
                variant="ghost"
                pill
                size="sm"
                onClick={() => onUpsellOpenChange(false)}
              >
                Maybe later
              </Button>
            </div>
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
