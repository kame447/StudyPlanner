import { useState } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { TimetableTerm } from '../types/domain';
import { TimetablePeriodSwipeItem } from './TimetablePeriodSwipeItem';

const TERM: TimetableTerm = {
  id: 'term-1',
  userId: 'user-1',
  year: 2026,
  kind: 'custom',
  label: '2026年前期',
  startDate: '2026-04-01',
  endDate: '2026-08-10',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function Harness({ onSelect, onDelete }: { onSelect: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <TimetablePeriodSwipeItem
      active
      deleting={false}
      disabled={false}
      isOpen={open}
      onDelete={onDelete}
      onOpenChange={setOpen}
      onSelect={onSelect}
      rangeLabel="4/1〜8/10"
      term={TERM}
    />
  );
}

function pointerEvent(x: number, y = 20) {
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    currentTarget: {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
  };
}

describe('TimetablePeriodSwipeItem', () => {
  it('opens the delete action after a deliberate left swipe and routes delete', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const renderer = create(<Harness onSelect={onSelect} onDelete={onDelete} />);
    let surface = renderer.root.findByProps({ 'aria-label': '2026年前期を選択' });

    act(() => {
      surface.props.onPointerDown(pointerEvent(180));
      surface.props.onPointerMove(pointerEvent(110, 22));
      surface.props.onPointerUp(pointerEvent(110, 22));
    });

    surface = renderer.root.findByProps({ 'aria-label': '2026年前期を選択' });
    expect(surface.props['aria-expanded']).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();

    const deleteAction = renderer.root.findByProps({ 'aria-label': '2026年前期を削除' });
    act(() => {
      deleteAction.props.onClick({ stopPropagation: vi.fn() });
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps an ordinary tap as the period selection action', () => {
    const onSelect = vi.fn();
    const renderer = create(<Harness onSelect={onSelect} onDelete={vi.fn()} />);
    const surface = renderer.root.findByProps({ 'aria-label': '2026年前期を選択' });

    act(() => {
      surface.props.onClick({ preventDefault: vi.fn() });
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
