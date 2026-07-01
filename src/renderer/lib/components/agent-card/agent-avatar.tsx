import { cn } from '@renderer/utils/utils';

/**
 * Shared Agent avatar. User-provided glyphs win; otherwise we fall back to a
 * brand-tinted initial so legacy Agents without an icon still have an identity.
 */
export function AgentAvatar({
  name,
  icon,
  className,
}: {
  name: string;
  icon?: string;
  className?: string;
}) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '·';
  const glyph = icon?.trim() || initial;
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-lg bg-primary-button-background font-semibold leading-none text-primary-button-foreground',
        className
      )}
    >
      {glyph}
    </span>
  );
}
