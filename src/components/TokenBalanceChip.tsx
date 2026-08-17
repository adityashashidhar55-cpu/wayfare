/**
 * TokenBalanceChip (r24-smart, feature Q) - header chip showing the token
 * balance; links to /rewards.
 */
import { Coins } from "lucide-react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";

export default function TokenBalanceChip() {
  const q = trpc.tokens.state.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  const balance = q.data?.balance ?? 0;
  return (
    <Link
      to="/rewards"
      title="Your tokens, spend them on rewards"
      aria-label={`${balance} tokens, open rewards`}
      className="type-small inline-flex h-9 items-center gap-1.5 rounded-pill border border-border bg-surface px-3 font-semibold text-ink-2 transition-colors duration-fast hover:border-ochre hover:text-ink"
    >
      <Coins className="h-4 w-4 text-ochre" strokeWidth={1.75} />
      <span data-testid="token-balance" className="tnum">{balance}</span>
    </Link>
  );
}
