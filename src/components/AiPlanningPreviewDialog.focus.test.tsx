import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { installFakeMotionEnvironment } from '../lib/motionPreference.testUtils';
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';

vi.mock('./DragUndoRedoControls', () => ({ DragUndoRedoControls: () => null }));

let renderer: ReactTestRenderer | undefined;
let env: ReturnType<typeof installFakeMotionEnvironment> | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; env?.restore(); env = undefined; vi.unstubAllGlobals(); });

const block = { id: 'b1', userId: 'u', date: '2026-10-17', startTime: '09:00', endTime: '10:00', title: 'b1', subject: 'math', type: 'study',
  source: 'ai', status: 'draft', userEdited: false, createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z' } as WeeklyPlanDraftBlock;

// Opening the plan preview moves focus into it, Escape closes it, and Tab cannot leave it (the same contract as the other dialogs).
it('takes focus when opened and closes on Escape', () => {
  env = installFakeMotionEnvironment();
  const keydown = new Set<(event: KeyboardEvent) => void>();
  let active: unknown = null;
  class FakeElement { focus = vi.fn(() => { active = this; }); getClientRects() { return [{}]; } getAttribute() { return null; }
    querySelectorAll() { return []; } contains(other: unknown) { return other === this; } isConnected = true; dataset = {}; }
  const dialog = new FakeElement();
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('document', { documentElement: { dataset: {} }, body: new FakeElement(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    get activeElement() { return active; } });
  vi.stubGlobal('window', { ...window, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined,
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => { if (type === 'keydown') keydown.add(listener); },
    removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => { if (type === 'keydown') keydown.delete(listener); } });
  const onClose = vi.fn();
  act(() => {
    renderer = create(<AiPlanningPreviewDialog plans={[]} error="" hasLocalPreview isBusy={false} isSaving={false} canSave blocks={[block]}
      onClose={onClose} onAdjust={vi.fn()} onRemove={vi.fn()} onPromote={vi.fn()} onSave={vi.fn()} />,
    { createNodeMock: node => (node.type === 'section' && node.props.role === 'dialog' ? dialog : {}) });
  });
  expect(dialog.focus).toHaveBeenCalled();
  const preventDefault = vi.fn();
  keydown.forEach(listener => listener({ key: 'Escape', preventDefault } as unknown as KeyboardEvent));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(preventDefault).toHaveBeenCalled();
});
