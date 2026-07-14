import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

/** One 14px terminal-style tree guide slot (vertical rail or row elbow). */
export function TreeGuideSlot({
  continues,
  isElbow,
  highlighted = false,
  fadeOnRowHover = false,
  children,
}: {
  continues: boolean;
  isElbow: boolean;
  highlighted?: boolean;
  /** Fade the guide lines out on row hover when the slot becomes an action. */
  fadeOnRowHover?: boolean;
  children?: ReactNode;
}) {
  const lineClassName = highlighted ? 'bg-foreground-tertiary' : 'bg-border';

  return (
    <span className="relative h-full w-3.5 shrink-0">
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 transition-opacity duration-150',
          fadeOnRowHover && 'group-hover/row:opacity-0'
        )}
      >
        {isElbow ? (
          <>
            <span className={cn('absolute left-[5px] top-0 h-1/2 w-px', lineClassName)} />
            <span className={cn('absolute left-[5px] top-1/2 h-px w-1.5', lineClassName)} />
            {continues ? (
              <span className={cn('absolute bottom-0 left-[5px] top-1/2 w-px', lineClassName)} />
            ) : null}
          </>
        ) : continues ? (
          <span className={cn('absolute bottom-0 left-[5px] top-0 w-px', lineClassName)} />
        ) : null}
      </span>
      {children}
    </span>
  );
}
