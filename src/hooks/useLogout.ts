import { trpc } from '@/providers/trpc';
import { LOGIN_PATH } from '@/const';

/**
 * Bulletproof logout: clears the server session, wipes every cached query
 * and local app state, then hard-redirects to /login (full page load, so no
 * stale React state survives). Theme preference is preserved.
 */
export function useLogout() {
  const utils = trpc.useUtils();
  const mutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      try {
        const theme = localStorage.getItem('wayfare-theme');
        localStorage.clear();
        if (theme) localStorage.setItem('wayfare-theme', theme);
      } catch {
        // storage unavailable - continue regardless
      }
      try {
        await utils.invalidate();
      } catch {
        // ignore - we're leaving anyway
      }
      window.location.href = LOGIN_PATH;
    },
  });
  return {
    logout: () => mutation.mutate(),
    isPending: mutation.isPending,
  };
}
