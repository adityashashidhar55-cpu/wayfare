import { cn } from '@/lib/utils';

/**
 * Wayfare compass-star mark: an 8-point star whose north point extends
 * into a map-pin teardrop (design.md §2). Stroke 1.75, currentColor.
 */
export function CompassMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M16 19.2 C14.1 17.2 11.9 14.6 11.9 11.1 A4.1 4.1 0 1 1 20.1 11.1 C20.1 14.6 17.9 17.2 16 19.2 Z" />
      <path d="M16 19.2 L16 27.4" />
      <path d="M7.8 19.2 L24.2 19.2" />
      <path d="M11.4 14.6 L20.6 23.8" />
      <path d="M20.6 14.6 L11.4 23.8" />
    </svg>
  );
}

/** Wordmark + mark. r23: Special Elite typewriter wordmark, lowercase. */
export default function Logo({
  className,
  markClassName,
  wordmark = true,
}: {
  className?: string;
  markClassName?: string;
  wordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 select-none', className)}>
      <CompassMark className={cn('h-7 w-7 text-brand', markClassName)} />
      {wordmark && (
        <span className="font-display text-[24px] leading-none text-ink">
          wayfare
        </span>
      )}
    </span>
  );
}
