import { PanelRightOpen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewId } from '@renderer/app/view-registry';
import { appState } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

/**
 * Shared navigation affordance for views that can either replace the main
 * surface or be pinned into the global side pane with Alt/right-click.
 */
export function GlobalSidePaneTarget({
  viewId,
  params,
  altHeld,
  tooltipSide = 'right',
  tooltipLabel,
  children,
}: {
  viewId: ViewId;
  params?: Record<string, unknown>;
  altHeld: boolean;
  tooltipSide?: 'top' | 'right';
  tooltipLabel?: string;
  children: React.ReactElement;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = React.useState(false);
  const label = t('appTabs.openInGlobalSidePane');
  const visibleTooltip = altHeld ? label : tooltipLabel;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="shrink-0"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {visibleTooltip ? (
          <Tooltip open={altHeld ? hovered : undefined}>
            <TooltipTrigger render={children} />
            <TooltipContent side={tooltipSide}>{visibleTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          children
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          className="whitespace-nowrap"
          onClick={() => appState.sidePane.pinView(viewId, params ?? {})}
        >
          <PanelRightOpen className="size-4" />
          {label}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
