import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    host.remove();
  });

  it('hides agent replies at the hidden default while offering a local expand', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'hidden' }));
    });

    const text = host.textContent ?? '';
    expect(text).toContain('Build the feature');
    expect(text).not.toContain('Implemented and tested.');
    expect(text).not.toContain('I will inspect the code.');
    expect(text).toContain('tasks.sessionInfo.replyCount:2');
    expect(text).toContain('tasks.sessionInfo.expandReply');
  });

  it('reveals the closing reply on the first step, then the commentary on the second', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'hidden' }));
    });

    const affordance = () => host.querySelector('button') as HTMLButtonElement;

    await act(async () => affordance().click());
    expect(host.textContent).toContain('Implemented and tested.');
    expect(host.textContent).not.toContain('I will inspect the code.');
    expect(host.textContent).toContain('tasks.sessionInfo.expandAllReplies');

    await act(async () => affordance().click());
    expect(host.textContent).toContain('I will inspect the code.');
    expect(host.textContent).toContain('tasks.sessionInfo.collapseReplies');
  });

  it('collapses back to hidden on a third step', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'hidden' }));
    });

    const affordance = () => host.querySelector('button') as HTMLButtonElement;
    for (let step = 0; step < 3; step += 1) {
      await act(async () => affordance().click());
    }

    expect(host.textContent).not.toContain('Implemented and tested.');
    expect(host.textContent).not.toContain('I will inspect the code.');
    expect(host.textContent).toContain('tasks.sessionInfo.expandReply');
  });

  it('keeps the concise default compact: final reply only until explicitly expanded', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'concise' }));
    });

    expect(host.textContent).toContain('Implemented and tested.');
    expect(host.textContent).not.toContain('I will inspect the code.');
    expect(host.textContent).toContain('tasks.sessionInfo.expandAllReplies');
  });

  it('expands one turn independently while the other stays hidden', async () => {
    await act(async () => {
      root.render(renderList(root, { displayLevel: 'hidden' }));
    });

    const articles = host.querySelectorAll('article');
    expect(articles).toHaveLength(2);

    await act(async () => (articles[0]!.querySelector('button') as HTMLButtonElement).click());

    expect(host.textContent).toContain('Implemented and tested.');
    expect(articles[1]!.textContent).not.toContain('Implemented and tested.');
  });
});
