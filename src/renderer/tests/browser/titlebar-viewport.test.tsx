import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = { children?: ReactNode };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/app/app-tab-strip', () => ({
  AppTabStrip: () =>
    createElement(
      'div',
      { 'data-testid': 'tab-strip', className: 'flex min-w-0 items-center gap-1 overflow-x-auto' },
      Array.from({ length: 12 }, (_, index) =>
        createElement(
          'button',
          { key: index, className: 'h-7 shrink-0', style: { width: 176 } },
          `Tab ${index + 1}`
        )
      )
    ),
}));

vi.mock('@renderer/lib/components/nav-buttons', () => ({
  NavButtons: () => createElement('div', { className: 'h-7 w-16 shrink-0' }),
  NavIconButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props),
}));

vi.mock('@renderer/lib/layout/layout-provider', () => ({
  useWorkspaceLayoutContext: () => ({
    setCollapsed: vi.fn(),
    isLeftOpen: true,
  }),
}));

vi.mock('@renderer/lib/ui/shortcut-hint', () => ({
  ShortcutHint: () => null,
}));

vi.mock('@renderer/lib/ui/tooltip', () => ({
  Tooltip: ({ children }: ChildrenProps) => createElement(Fragment, null, children),
  TooltipContent: ({ children }: ChildrenProps) => createElement(Fragment, null, children),
  TooltipProvider: ({ children }: ChildrenProps) => createElement(Fragment, null, children),
  TooltipTrigger: ({ children }: ChildrenProps) => createElement(Fragment, null, children),
}));

describe('Titlebar viewport containment', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '440px';
    host.style.height = '200px';
    host.style.overflow = 'auto';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('clips nested overflow at each flexible titlebar boundary', async () => {
    const { Titlebar } = await import('@renderer/lib/components/titlebar/Titlebar');

    await act(async () => {
      root.render(
        createElement(Titlebar, {
          leftSlot: createElement('div', { className: 'h-7 w-24 shrink-0' }),
          rightSlot: createElement('button', { className: 'h-7 w-48 shrink-0' }, 'Controls'),
        })
      );
    });

    const titlebar = host.querySelector<HTMLElement>('header');
    expect(titlebar).not.toBeNull();
    expect(titlebar?.classList.contains('min-w-0')).toBe(true);
    expect(titlebar?.classList.contains('max-w-full')).toBe(true);
    expect(titlebar?.classList.contains('overflow-hidden')).toBe(true);

    const outerRow = titlebar?.firstElementChild as HTMLElement | null;
    const contentRow = outerRow?.children.item(0) as HTMLElement | null;
    const centerRegion = contentRow?.children.item(1) as HTMLElement | null;
    for (const element of [outerRow, contentRow, centerRegion]) {
      expect(element?.classList.contains('min-w-0')).toBe(true);
      expect(element?.classList.contains('overflow-hidden')).toBe(true);
    }
  });
});
