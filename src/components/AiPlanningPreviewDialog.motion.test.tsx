import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { createEmptyPlanDraft, createPlanFromDraft } from '../domain/planner';
import type { Plan } from '../types/domain';
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

function show(blocks: WeeklyPlanDraftBlock[], hasLocalPreview = true, plans: Plan[] = []) {
  act(() => {
    const element = <AiPlanningPreviewDialog {...props} plans={plans} blocks={blocks} hasLocalPreview={hasLocalPreview} />;
    if (renderer) renderer.update(element);
    else renderer = create(element, {
      createNodeMock: node => (/ai-planning-preview-(overview-grid|day-detail)/.test(String(node.props.className ?? '')) ? body : {}),
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
  function dayMode() {
    act(() => renderer!.root.find(node => node.type === 'button' && node.children.includes('日別')).props.onClick());
  }

  const style = (key: string) => renderer!.root.findByProps({ 'data-motion-key': key }).props.style;

  it.each([390, 1280])('separates overlapping candidates at %ipx without changing their time heights', width => {
    Object.assign(window, { innerWidth: width });
    const first = { ...block('合わせ', '16:00', '17:30'), type: 'other' as const };
    const second = { ...block('カンファレンス', '17:00', '21:00'), type: 'other' as const };
    show([first, second]);
    const assertLanes = () => {
      expect(style('block:合わせ')).toMatchObject({ left: 'calc(0% + 2px)', width: 'calc(50% - 4px)', right: 'auto', minWidth: 0 });
      expect(style('block:カンファレンス')).toMatchObject({ left: 'calc(50% + 2px)', width: 'calc(50% - 4px)', right: 'auto', minWidth: 0 });
    };
    assertLanes();
    expect(style('block:合わせ').height).toBe('max(6.25%, 12px)');
    expect(style('block:カンファレンス').height).toBe(`max(${(240 / 1440) * 100}%, 12px)`);
    dayMode();
    assertLanes();
    expect(style('block:合わせ')).toMatchObject({ top: '608px', height: '57px' });
    expect(style('block:カンファレンス')).toMatchObject({ top: '646px', height: '152px' });
  });

  it.each([390, 1280])('shares lanes between existing plans and candidates at %ipx', width => {
    Object.assign(window, { innerWidth: width });
    const saved = createPlanFromDraft({ ...createEmptyPlanDraft('preview-user', '2026-10-17'), title: '既存予定', startTime: '16:00', endTime: '17:30', type: 'other' });
    show([block('候補', '17:00', '21:00')], true, [saved]);
    const assertLanes = () => {
      expect(style(`plan:${saved.id}`)).toMatchObject({ left: 'calc(0% + 2px)', width: 'calc(50% - 4px)', right: 'auto', minWidth: 0 });
      expect(style('block:候補')).toMatchObject({ left: 'calc(50% + 2px)', width: 'calc(50% - 4px)', right: 'auto', minWidth: 0 });
    };
    assertLanes();
    dayMode();
    assertLanes();
    expect(style(`plan:${saved.id}`).height).toBe('57px');
    expect(style('block:候補').height).toBe('152px');
  });

  it.each([390, 1280])('retains the exact former styles for nonoverlapping and touching blocks at %ipx', width => {
    Object.assign(window, { innerWidth: width });
    const saved = createPlanFromDraft({ ...createEmptyPlanDraft('preview-user', '2026-10-17'), title: '既存予定', startTime: '11:00', endTime: '12:00' });
    show([block('a'), block('b', '10:00', '11:00')], true, [saved]);
    expect(style('block:a')).toEqual({ top: '37.5%', height: `max(${(60 / 1440) * 100}%, 12px)`, pointerEvents: 'auto', overflow: 'hidden', zIndex: undefined });
    expect(style('block:b').left).toBeUndefined();
    expect(style(`plan:${saved.id}`)).toEqual({ top: `${(11 / 24) * 100}%`, height: `max(${(60 / 1440) * 100}%, 12px)` });
    dayMode();
    expect(style('block:a')).toEqual({ top: '342px', height: '38px' });
    expect(style('block:b')).toEqual({ top: '380px', height: '38px' });
    expect(style(`plan:${saved.id}`)).toEqual({ top: '418px', height: '38px' });
  });

  it('keeps the promotion control inert and exposes Save as a separate explicit action', () => {
    props.onPromote.mockClear();
    props.onSave.mockClear();
    const blocks = [block('a')];
    show(blocks);
    const promotion = renderer!.root.find(node => node.type === 'button' && node.children.includes('この内容で仮予定にする'));
    // Save already holds its own slot, disabled, so promotion does not reflow the dialog.
    const reservedSave = renderer!.root.find(node => node.type === 'button' && node.children.includes('この内容で保存'));
    expect(reservedSave.props.disabled).toBe(true);
    act(() => reservedSave.props.onClick());
    expect(props.onSave).not.toHaveBeenCalled();
    act(() => promotion.props.onClick({ currentTarget: promotion }));
    expect(props.onPromote).toHaveBeenCalledOnce();
    show(blocks, false);
    // React must never reuse this focused host button as an approval action.
    expect(promotion.props.disabled).toBe(true);
    act(() => promotion.props.onClick({ currentTarget: promotion }));
    expect(props.onSave).not.toHaveBeenCalled();
    const save = renderer!.root.find(node => node.type === 'button' && node.children.includes('この内容で保存'));
    expect(save).not.toBe(promotion);
    expect(save.props.className).toContain('ai-planning-preview-save-action');
    act(() => save.props.onClick());
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(blocks);
  });

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
