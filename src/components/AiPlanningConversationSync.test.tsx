import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationSyncUi } from '../features/weeklyPlanning/application/weeklyPlanningConversationSyncContract';
import { AiPlanningConversationSync } from './AiPlanningConversationSync';

function fixture(status: ConversationSyncUi['status']) {
  const enable = vi.fn(async () => undefined);
  const pause = vi.fn(async () => undefined);
  const ui: ConversationSyncUi = { status, message: '', unpersisted: false, remoteDeleted: false,
    localText: '', remoteText: '', enable, pause,
    retry: vi.fn(async () => undefined), resolve: vi.fn(async () => undefined) };
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<AiPlanningConversationSync sync={ui} />); });
  const action = (label: string) => renderer.root.findAllByType('button').find(button => button.children.join('') === label);
  return { action, enable, pause };
}

describe('AiPlanningConversationSync', () => {
  it('offers a device-local pause when sync is active', async () => {
    const { action, pause } = fixture('synced');
    expect(action('端末間同期を有効にする')).toBeUndefined();
    await act(async () => { action('この端末の同期を停止')?.props.onClick(); });
    expect(pause).toHaveBeenCalledOnce();
  });

  it('offers resume while paused instead of claiming that cloud copies were deleted', async () => {
    const { action, enable } = fixture('paused');
    expect(action('この端末の同期を停止')).toBeUndefined();
    await act(async () => { action('この端末の同期を再開')?.props.onClick(); });
    expect(enable).toHaveBeenCalledOnce();
  });
});
