import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { installFakeMotionEnvironment } from '../lib/motionPreference.testUtils';
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';

// The undo/redo bar renders through a portal, which the test renderer lacks.
vi.mock('./DragUndoRedoControls', () => ({ DragUndoRedoControls: () => null }));

let env: ReturnType<typeof installFakeMotionEnvironment>;
let renderer: ReactTestRenderer | undefined;
const played: string[] = [];
const nodes = new Map<string, { dataset: Record<string, string>; animate: () => unknown }>();

// The preview body, mirroring what the dialog last committed.
const body = {
  querySelectorAll: () => (renderer?.root.findAll(node => typeof node.props['data-motion-key'] === 'string') ?? []).map(node => {
    const key = node.props['data-motion-key'] as string;
    let element = nodes.get(key);
    if (!element) {
      element = { dataset: {}, animate: () => { played.push(key); return { cancel: vi.fn(), addEventListener: vi.fn() }; } };
      nodes.set(key, element);
    }
    element.dataset = { motionKey: key, motionSignature: String(node.props['data-motion-signature']) };
    return element;
  }),
};

const block = (id: string, startTime = '09:00', endTime = '10:00'): WeeklyPlanDraftBlock => ({
  id, userId: 'preview-user', date: '2026-10-17', startTime, endTime, title: id, subject: 'math', type: 'study',
  source: 'ai', status: 'draft', userEdited: false, createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z',
} as WeeklyPlanDraftBlock);

const props = {
  plans: [], error: '', hasLocalPreview: true, isBusy: false, isSaving: false, canSave: true,
  onClose: vi.fn(), onAdjust: vi.fn(), onRemove: vi.fn(), onPromote: vi.fn(), onSave: vi.fn(),
};

function show(blocks: WeeklyPlanDraftBlock[]) {
  act(() => {
    const element = <AiPlanningPreviewDialog {...props} blocks={blocks} />;
    if (renderer) renderer.update(element);
    else renderer = create(element, {
      createNodeMock: node => (String(node.props.className ?? '').includes('ai-planning-preview-overview-grid') ? body : {}),
    });
  });
}

beforeEach(() => {
  env = installFakeMotionEnvironment();
  vi.stubGlobal('document', { ...globalThis.document, addEventListener: vi.fn(), removeEventListener: vi.fn(), documentElement: { dataset: {} } });
  played.length = 0;
  nodes.clear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  env.restore();
});

describe('plan preview motion', () => {
  it('shows a revised proposal as a new view instead of replaying every block', () => {
    show([block('revision1:a'), block('revision1:b', '11:00', '12:00')]);
    show([block('revision2:a'), block('revision2:b', '11:00', '12:00')]);
    expect(played).toEqual([]);
  });

  it('still explains an edit of the same proposal', () => {
    show([block('a'), block('b', '11:00', '12:00')]);
    show([block('a'), block('b', '13:00', '14:00'), block('c', '15:00', '16:00')]);
    expect(played.sort()).toEqual(['block:b', 'block:c', 'count:2026-10-17']);
  });
});
