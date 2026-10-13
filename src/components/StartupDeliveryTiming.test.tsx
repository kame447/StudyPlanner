import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StartupDeliveryTiming } from './StartupDeliveryTiming';
import { readStartupDeliveryTiming } from '../lib/startupDeliveryTiming';
vi.mock('../lib/startupDeliveryTiming', () => ({ readStartupDeliveryTiming: vi.fn(() => ({
  navigation: { fetchStartMs: 0, requestStartMs: 2, responseStartMs: 10, responseEndMs: 15 },
  splashMountedMs: 150, deliveryToSplashGapMs: 50, assets: [
    { role: 'entry-script', status: 'observed', startMs: 20, responseEndMs: 100, transferBytes: null, encodedBytes: 50, decodedBytes: 100 },
    { role: 'react-vendor', status: 'unavailable' }, { role: 'firebase-vendor', status: 'ambiguous' },
  ],
})) }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });
it('labels unknown sizes and inferred work without presenting the residual as measured CPU or paint', () => {
  act(() => { renderer = create(<StartupDeliveryTiming splashStartMs={150} />); });
  const output = JSON.stringify(renderer.toJSON());
  expect(output).toContain('起動配信の診断');
  expect(output).toContain('未観測区間（推定）');
  expect(output).toContain('CPU時間や初回描画の実測ではありません');
  expect(output).toContain('キャッシュの種類は断定しません');
  expect(output).toContain('不明');
  expect(output).toContain('複数候補のため不明');
  expect(output).toContain('50 ms');
  // Preserve the existing phase-row JSON pre as the panel's sole pre element.
  expect(renderer.root.findAllByType('pre')).toHaveLength(0);
});
it('takes no new sample for unrelated diagnostic row changes, but can fill in the first Splash', () => {
  act(() => { renderer = create(<StartupDeliveryTiming splashStartMs={null} />); });
  expect(readStartupDeliveryTiming).toHaveBeenCalledExactlyOnceWith(null);
  act(() => renderer.update(<StartupDeliveryTiming splashStartMs={null} />));
  expect(readStartupDeliveryTiming).toHaveBeenCalledTimes(1);
  act(() => renderer.update(<StartupDeliveryTiming splashStartMs={150} />));
  expect(readStartupDeliveryTiming).toHaveBeenLastCalledWith(150);
  act(() => renderer.update(<StartupDeliveryTiming splashStartMs={150} />));
  expect(readStartupDeliveryTiming).toHaveBeenCalledTimes(2);
});
