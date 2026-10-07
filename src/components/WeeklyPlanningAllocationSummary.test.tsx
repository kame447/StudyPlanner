import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningTestDraftBlock } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanningAllocationBreakdown } from '../features/weeklyPlanning/semantic/weeklyPlanningAllocationBreakdown';
import { WeeklyPlanningAllocationSummary } from './WeeklyPlanningAllocationSummary';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); });

const breakdown: WeeklyPlanningAllocationBreakdown = {
  estimatedMinutes: 60, calibratedMinutes: 60, bufferedMinutes: 66,
  allocatedMinutes: 70, marginMinutes: 10, reasons: ['estimate_margin', 'rounding'],
};

describe('preview allocation summary', () => {
  it('shows the estimate and margin amounts next to the allocated total', () => {
    const block = createWeeklyPlanningTestDraftBlock({ id: 'allocated', overrides: {
      startTime: '09:00', endTime: '10:10', allocationBreakdown: breakdown,
    } });
    act(() => { renderer = create(<WeeklyPlanningAllocationSummary blocks={[block]} />); });
    const label = renderer!.root.findByProps({ 'aria-label': '確保時間の内訳' });
    const text = label.children.join('');
    expect(text).toContain('1時間');
    expect(text).toContain('10分');
  });

  it('does not show a margin label for an exact intrinsic duration', () => {
    const block = createWeeklyPlanningTestDraftBlock({ id: 'intrinsic', overrides: { startTime: '09:00', endTime: '11:00', allocationBreakdown: {
      estimatedMinutes: 120, calibratedMinutes: 120, bufferedMinutes: 120,
      allocatedMinutes: 120, marginMinutes: 0, reasons: [],
    } } });
    act(() => { renderer = create(<WeeklyPlanningAllocationSummary blocks={[block]} />); });
    expect(renderer!.toJSON()).toBeNull();
  });

  it('hides stale evidence when the preview duration has changed', () => {
    const block = createWeeklyPlanningTestDraftBlock({ id: 'edited', overrides: {
      startTime: '09:00', endTime: '10:00', allocationBreakdown: breakdown,
    } });
    act(() => { renderer = create(<WeeklyPlanningAllocationSummary blocks={[block]} />); });
    expect(renderer!.toJSON()).toBeNull();
  });
});
