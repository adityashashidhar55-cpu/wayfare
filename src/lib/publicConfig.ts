import { useQuery } from "@tanstack/react-query";
import { apiBase } from "@/lib/apiBase";

/** Public, non-secret runtime config exposed by the backend (`GET /api/config/public`). */
export interface PublicConfig {
  googleMapsKey: string | null;
}

async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await fetch(`${apiBase()}/api/config/public`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load public config (${res.status})`);
  return (await res.json()) as PublicConfig;
}

/**
 * Fetched once per session (staleTime Infinity) - safe to call from any
 * component. Returns undefined while loading.
 */
export function usePublicConfig() {
  return useQuery<PublicConfig>({
    queryKey: ["wayfare-public-config"],
    queryFn: fetchPublicConfig,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}
