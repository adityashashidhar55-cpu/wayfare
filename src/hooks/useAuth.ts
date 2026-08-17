import { trpc } from "@/providers/trpc";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { LOGIN_PATH } from "@/const";
import { clearReferralCode, peekReferralCode } from "@/lib/referral";

/** Module scope so the zone is reported once per page load, not once per
 *  component that happens to call useAuth. */
let reportedTz: string | null = null;

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = LOGIN_PATH } =
    options ?? {};

  const navigate = useNavigate();

  const utils = trpc.useUtils();

  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = trpc.auth.me.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      navigate(redirectPath);
    },
  });

  /* Referral claim (r14-linkfix): a ?ref= code stashed at /login is claimed
     exactly once per sign-in; the server only fills referredById when it's
     still NULL, so repeat claims are harmless. */
  const claimReferral = trpc.auth.claimReferral.useMutation({
    onSettled: () => clearReferralCode(),
  });
  useEffect(() => {
    const code = user ? peekReferralCode() : null;
    if (user && code && !claimReferral.isPending && !claimReferral.isSuccess && !claimReferral.isError) {
      claimReferral.mutate({ code });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* r25: report the browser's IANA timezone once per session.
     Every date boundary on the server (trip status, today's stops, travel
     mode) resolves in a real zone now instead of the server's UTC clock; a
     trip carries its destination's zone and this is the fallback for
     everything else. Fire-and-forget - a failure here must never block the
     app, the server just falls back to APP_DEFAULT_TZ. */
  const setTimezone = trpc.users.setTimezone.useMutation();
  useEffect(() => {
    if (!user) return;
    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!tz || reportedTz === tz) return;
    reportedTz = tz;
    setTimezone.mutate({ timezone: tz });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const logout = useCallback(() => logoutMutation.mutate(), [logoutMutation]);

  useEffect(() => {
    if (redirectOnUnauthenticated && !isLoading && !user) {
      const currentPath = window.location.pathname;
      if (currentPath !== redirectPath) {
        navigate(redirectPath);
      }
    }
  }, [redirectOnUnauthenticated, isLoading, user, navigate, redirectPath]);

  return useMemo(
    () => ({
      user: user ?? null,
      isAuthenticated: !!user,
      isLoading: isLoading || logoutMutation.isPending,
      error,
      logout,
      refresh: refetch,
    }),
    [user, isLoading, logoutMutation.isPending, error, logout, refetch],
  );
}
