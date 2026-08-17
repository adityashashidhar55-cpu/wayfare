import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "info" | "danger";

export interface ToastInput {
  title: string;
  description?: string;
  kind?: ToastKind;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem extends ToastInput {
  id: number;
  kind: ToastKind;
}

const ToastContext = createContext<{ push: (t: ToastInput) => void }>({
  push: () => {},
});

export const useToast = () => useContext(ToastContext);

const KIND_STYLE: Record<
  ToastKind,
  { bar: string; icon: typeof Info; iconClass: string }
> = {
  success: { bar: "bg-pine", icon: CheckCircle2, iconClass: "text-pine" },
  info: { bar: "bg-info", icon: Info, iconClass: "text-info" },
  danger: { bar: "bg-danger", icon: AlertTriangle, iconClass: "text-danger" },
};

/**
 * Workspace toasts (design.md §10.4): bottom-center, surface + shadow-lg +
 * left 3px status color, slide-up 16px + fade 320ms spring, auto-dismiss 3.5s.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts(ts => ts.filter(t => t.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts(ts => [
        ...ts.slice(-3),
        { ...input, id, kind: input.kind ?? "info" },
      ]);
      window.setTimeout(() => dismiss(id), 3500);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-[84px] left-1/2 z-[90] flex w-full max-w-sm -translate-x-1/2 flex-col items-stretch gap-2 px-4 md:bottom-8 md:max-w-md">
        <AnimatePresence initial={false}>
          {toasts.map(t => {
            const style = KIND_STYLE[t.kind];
            const Icon = style.icon;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-md border border-border bg-surface py-2.5 pl-4 pr-2.5 shadow-lg"
                role="status"
              >
                <span
                  className={cn("absolute inset-y-0 left-0 w-[3px]", style.bar)}
                  aria-hidden
                />
                <Icon
                  className={cn("h-[18px] w-[18px] shrink-0", style.iconClass)}
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1">
                  <span className="type-small block truncate text-ink">
                    {t.title}
                  </span>
                  {t.description ? (
                    <span className="type-caption block truncate text-ink-3">
                      {t.description}
                    </span>
                  ) : null}
                </span>
                {t.actionLabel ? (
                  <button
                    type="button"
                    onClick={() => {
                      t.onAction?.();
                      dismiss(t.id);
                    }}
                    className="type-small shrink-0 rounded-sm px-2 py-1 font-semibold text-brand transition-colors duration-fast hover:bg-brand-soft"
                  >
                    {t.actionLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 rounded-sm p-1 text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
