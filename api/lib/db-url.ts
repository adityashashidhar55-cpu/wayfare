/**
 * r31: make a copied-and-pasted DATABASE_URL work on the first try.
 *
 * Every managed MySQL (TiDB Cloud, PlanetScale, Aiven, Azure) REQUIRES TLS and
 * refuses the connection without it, but the string people copy out of a
 * dashboard does not always carry `?ssl=...`, and mysql2 defaults to plaintext.
 * The resulting failure is `Connections using insecure transport are
 * prohibited` at boot - accurate, and completely opaque if you have never seen
 * it. Rather than making that someone's first deploy, we add the flag
 * ourselves for any non-local host.
 *
 * We deliberately do NOT re-serialise the URL through `new URL()`: passwords
 * out of these dashboards contain characters whose round-trip through the URL
 * parser is not byte-identical, and a silently mangled password is a far worse
 * failure than a missing TLS flag. We only ever append.
 *
 * DB_SSL=on forces the flag on for any host; DB_SSL=off disables this entirely.
 */
/**
 * Hosts that REFUSE a plaintext connection. Deliberately an allowlist, not
 * "anything that is not localhost": Railway's `mysql.railway.internal` and a
 * MySQL on a private VPC subnet both work fine without TLS, and forcing it on
 * them would break a setup that was already correct. A missing flag on an
 * unlisted host costs one line in the deploy guide; a forced flag on a host
 * with no certificate costs a working deployment.
 */
const TLS_REQUIRED_SUFFIXES = [
  ".tidbcloud.com",     // TiDB Cloud Serverless
  ".psdb.cloud",        // PlanetScale
  ".aivencloud.com",    // Aiven for MySQL
  ".mysql.database.azure.com", // Azure Database for MySQL
  ".clever-cloud.com",  // Clever Cloud
];

/** Host portion of a mysql:// URL, or "" when it cannot be determined. */
export function hostOf(url: string): string {
  const afterScheme = url.split("://")[1];
  if (!afterScheme) return "";
  const authority = afterScheme.split("/")[0].split("?")[0];
  // Strip credentials. Search from the RIGHT: a password may contain "@".
  const at = authority.lastIndexOf("@");
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  if (hostPort.startsWith("[")) return hostPort.slice(0, hostPort.indexOf("]") + 1);
  return hostPort.split(":")[0];
}

/** True when this host is known to reject plaintext MySQL connections. */
export function requiresTls(host: string): boolean {
  const h = host.toLowerCase();
  return TLS_REQUIRED_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

export function normalizeDatabaseUrl(url: string, sslEnv?: string): string {
  if (!url) return url;
  const mode = (sslEnv ?? "").toLowerCase();
  if (mode === "off") return url;
  if (!url.startsWith("mysql://")) return url;
  // Already asked for TLS one way or another - leave it exactly alone.
  if (/[?&]ssl(-mode)?=/i.test(url)) return url;
  const host = hostOf(url);
  if (!host) return url;
  if (mode !== "on" && !requiresTls(host)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ssl={"rejectUnauthorized":true}`;
}
