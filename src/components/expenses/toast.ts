/**
 * Toast emitter (design.md §10.4). Kept component-free so fast-refresh rules
 * stay happy - the visual host lives in `ToastHost.tsx`.
 */

export type ToastTone = 'success' | 'info' | 'danger';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

type ToastInput = { tone?: ToastTone; action?: ToastItem['action'] };

const listeners = new Set<(t: ToastItem) => void>();
let nextId = 1;

export function toast(message: string, opts?: ToastInput) {
  const item: ToastItem = {
    id: nextId++,
    message,
    tone: opts?.tone ?? 'success',
    action: opts?.action,
  };
  listeners.forEach((l) => l(item));
}

export function subscribeToasts(l: (t: ToastItem) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
