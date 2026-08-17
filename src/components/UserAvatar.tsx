import { cn } from '@/lib/utils';

/** Avatar with initials fallback - used across nav, shell, members. */
export function UserAvatar({
  name,
  avatar,
  className,
}: {
  name?: string | null;
  avatar?: string | null;
  className?: string;
}) {
  const initials = (name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name ?? 'User'}
        className={cn('h-8 w-8 rounded-full object-cover ring-2 ring-surface', className)}
      />
    );
  }
  return (
    <span
      aria-label={name ?? 'User'}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft font-serif text-[13px] font-semibold text-brand ring-2 ring-surface',
        className,
      )}
    >
      {initials}
    </span>
  );
}
