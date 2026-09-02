import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { SessionConversationList } from '@renderer/features/tasks/session-conversation-list';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));

vi.mock('@renderer/lib/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => createElement('span', null, content),
}));

vi.mock('@renderer/features/tasks/context-panel-prompt-display', () => ({
  displaySessionPromptText: (text: string) => text,
}));

vi.mock('@renderer/features/tasks/conversations/session-compaction-marker', () => ({
  SessionCompactionMarker: () => null,
}));

vi.mock('@renderer/features/tasks/conversations/session-prompt-restore-button', () => ({
  SessionPromptRestoreButton: () => null,
}));

const prompts = [
  { id: 'user-1', text: 'Build the feature', timestamp: null },
  { id: 'user-2', text: 'Polish it', timestamp: null },
];

const messages = [
  { id: 'user-1', role: 'user', text: 'Build the feature', timestamp: null },
  {
    id: 'assistant-1',
    role: 'assistant',
    text: 'I will inspect the code.',
    timestamp: null,
    phase: 'commentary',
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    text: 'Implemented and tested.',
    timestamp: null,
    phase: 'final',
  },
  { id: 'user-2', role: 'user', text: 'Polish it', timestamp: null },
];

function renderList(
  root: Root,
  {
    displayLevel = 'hidden',
    variant = 'full',
  }: { displayLevel?: 'hidden' | 'concise' | 'detailed'; variant?: 'preview' | 'full' } = {}
) {
  return createElement(SessionConversationList, {
    prompts,
    messages,
    displayLevel,
    variant,
  } as never);
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('SessionConversationList', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll('[data-slot="dropdown-menu-content"]')
      .forEach((node) => node.remove());
    host.remove();
  });

  const drillTriggers = () =>
    host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="tasks.sessionInfo.replyDetailLevel"]'
    );
  const radioItems = () =>
    document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-radio-item"]');

  it('hides agent replies at the hidden default while offering a per-card drill-down', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'hidden' }));
    });

    const text = host.textContent ?? '';
    expect(text).toContain('Build the feature');
    expect(text).not.toContain('Implemented and tested.');
    expect(text).not.toContain('I will inspect the code.');
    expect(drillTriggers()).toHaveLength(2);
  });

  it('drills a card to detailed through its own menu', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'hidden' }));
    });

    await userEvent.click(drillTriggers()[0]!);
    await settle();

    const detailed = Array.from(radioItems()).find((item) =>
      item.textContent?.includes('detailed')
    );
    expect(detailed).toBeTruthy();
    await userEvent.click(detailed!);
    await settle();

    expect(host.textContent).toContain('Implemented and tested.');
    expect(host.textContent).toContain('I will inspect the code.');
  });

  it('keeps the concise default compact: final reply only until drilled deeper', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'concise' }));
    });

    expect(host.textContent).toContain('Implemented and tested.');
    expect(host.textContent).not.toContain('I will inspect the code.');
  });

  it('drills one turn independently while the other stays hidden', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'hidden' }));
    });

    const articles = host.querySelectorAll('article');
    expect(articles).toHaveLength(2);

    await userEvent.click(
      articles[0]!.querySelector<HTMLButtonElement>(
        'button[aria-label^="tasks.sessionInfo.replyDetailLevel"]'
      )!
    );
    await settle();

    const detailed = Array.from(radioItems()).find((item) =>
      item.textContent?.includes('detailed')
    );
    await userEvent.click(detailed!);
    await settle();

    expect(host.textContent).toContain('Implemented and tested.');
    expect(articles[1]!.textContent).not.toContain('Implemented and tested.');
  });
});
