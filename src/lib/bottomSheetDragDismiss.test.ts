import { describe, expect, it } from 'vitest';
import {
  getBottomSheetDismissDistance,
  getBottomSheetDragIntent,
  isBottomSheetDismissGesture,
} from './bottomSheetDragDismiss';

describe('bottomSheetDragDismiss', () => {
  it('locks onto a downward vertical drag but rejects upward and horizontal gestures', () => {
    expect(getBottomSheetDragIntent(2, 4)).toBe('pending');
    expect(getBottomSheetDragIntent(4, 18)).toBe('vertical');
    expect(getBottomSheetDragIntent(24, 8)).toBe('cancel');
    expect(getBottomSheetDragIntent(2, -10)).toBe('cancel');
  });

  it('uses a bounded dismissal threshold across compact and tall sheets', () => {
    expect(getBottomSheetDismissDistance(240)).toBe(72);
    expect(getBottomSheetDismissDistance(600)).toBe(108);
    expect(getBottomSheetDismissDistance(1000)).toBe(140);
  });

  it('dismisses by distance or a deliberate fast downward flick', () => {
    expect(isBottomSheetDismissGesture(110, 0.05, 600)).toBe(true);
    expect(isBottomSheetDismissGesture(40, 0.5, 600)).toBe(true);
    expect(isBottomSheetDismissGesture(40, 0.1, 600)).toBe(false);
    expect(isBottomSheetDismissGesture(-120, 1, 600)).toBe(false);
    expect(isBottomSheetDismissGesture(150, 1, 600, false)).toBe(false);
  });
});
