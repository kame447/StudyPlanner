import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AiPlanningChatSidebar } from './AiPlanningChatSidebar';
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
it('dismisses a nested reset confirmation when navigation closes the retained sidebar', () => {
  const onCreate = vi.fn();
  const props = { chats: [], activeChatId: '', query: '', onQueryChange() {},
    onSelect() {}, onDelete() {}, onClose() {}, onCreate };
  act(() => { renderer = create(<AiPlanningChatSidebar {...props} open />); });
  act(() => { renderer!.root.findByProps({ className: 'ai-chat-week-reset-button' }).props.onClick(); });
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
  act(() => { renderer!.update(<AiPlanningChatSidebar {...props} open={false} />); });
  expect(renderer!.toJSON()).toBeNull();
  act(() => { renderer!.update(<AiPlanningChatSidebar {...props} open />); });
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  expect(onCreate).not.toHaveBeenCalled();
});
