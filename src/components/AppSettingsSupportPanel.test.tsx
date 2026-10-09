import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';
import { StartupTimingButton } from './StartupTimingButton';
const state = vi.hoisted(() => ({ enabled: false }));
vi.mock('../lib/startupTiming', () => ({ startupTiming: { get enabled() { return state.enabled; } } }));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; state.enabled = false; });

it.each([false, true])('offers explicit local-only startup diagnostics and retains ordinary support: enabled=%s', enabled => {
  state.enabled = enabled;
  act(() => { renderer = create(<AppSettingsSupportPanel />); });
  expect(renderer!.root.findByType(StartupTimingButton).props.enabled).toBe(enabled);
  const description = renderer!.root.findByProps({ 'aria-label': '起動時間の診断' });
  expect(JSON.stringify(description.findByType('p').children)).toContain('外部送信・保存はしません');
  expect(renderer!.root.findAllByType('a').map(link => link.props.href)).toEqual(['/contact', '/terms', '/privacy']);
});
