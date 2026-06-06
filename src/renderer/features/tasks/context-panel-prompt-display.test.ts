import { describe, expect, it } from 'vitest';
import { displaySessionPromptText } from './context-panel-prompt-display';

describe('displaySessionPromptText', () => {
  it('strips UI source locators from prompt display text', () => {
    const input =
      '会话 prompt展开后无需显示 @src/renderer/features/tasks/context-panel.tsx:1137:5(ResizablePanelGroup>ResizablePanel>div>ContextMenuTrigger>details>div) ，感觉没有意义';

    expect(displaySessionPromptText(input)).toBe('会话 prompt展开后无需显示，感觉没有意义');
  });

  it('strips UI source locators without a leading space', () => {
    const input =
      '还是有@src/renderer/features/tasks/context-panel.tsx:1139:5(ResizablePanelGroup>ResizablePanel>div>div>div>ResizablePanelGroup>ResizablePanel>div>div>div>ContextMenuTrigger>details>div)';

    expect(displaySessionPromptText(input)).toBe('还是有');
  });

  it('preserves normal source mentions', () => {
    const input = 'fix @src/main/index.ts:12:3 now';

    expect(displaySessionPromptText(input)).toBe(input);
  });
});
