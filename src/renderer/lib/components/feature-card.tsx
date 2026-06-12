import { Plus } from 'lucide-react';
import { cn } from '@renderer/utils/utils';

/**
 * An "add this panel" feature card shown in empty strips (task sidebar, bottom
 * drawer). Click adds the panel to the strip and activates it.
 */
export function FeatureCard({
  icon,
  label,
  description,
  index,
  className,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  /** Position in the list — staggers the entrance animation. */
  index: number;
  className?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'group/card flex animate-in items-center gap-3 rounded-lg border border-border bg-background-1 px-3 py-2.5 text-left fade-in-0 slide-in-from-bottom-2 fill-mode-backwards transition-colors hover:border-primary/40 hover:bg-background-2',
        className
      )}
      style={{ animationDelay: `${(index + 1) * 60}ms` }}
      onClick={onSelect}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background-2 text-foreground-muted transition-colors group-hover/card:border-primary/30 group-hover/card:bg-primary/10 group-hover/card:text-primary [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="truncate text-[11px] leading-4 text-foreground-passive">
          {description}
        </span>
      </span>
      <Plus className="size-3.5 shrink-0 text-foreground-passive opacity-0 transition-opacity group-hover/card:opacity-100" />
    </button>
  );
}
