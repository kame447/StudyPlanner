import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { StartupTimingButton } from './StartupTimingButton';
import { reloadWithStartupTiming } from '../lib/startupTimingNavigation';
vi.mock('../lib/startupTimingNavigation', () => ({ reloadWithStartupTiming: vi.fn() }));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.resetAllMocks(); });

it.each([false, true])('requires an explicit click and submits just one same-context reload: currently enabled=%s', enabled => {
  act(() => { renderer = create(<StartupTimingButton enabled={enabled} />); });
  const button = renderer!.root.findByType('button');
  expect(button.props.style).toMatchObject({ maxWidth: '100%', whiteSpace: 'normal', minHeight: 44 });
  expect(button.children).toEqual([enabled ? '計測を終了して再読み込み' : '起動を計測して再読み込み']);
  expect(reloadWithStartupTiming).not.toHaveBeenCalled();
  const click = button.props.onClick;
  act(() => { click(); click(); });
  expect(reloadWithStartupTiming).toHaveBeenCalledExactlyOnceWith(!enabled);
  expect(button.props.disabled).not.toBe(true);
});

it('reports a failed navigation without exposing its error and allows retry', async () => {
  vi.mocked(reloadWithStartupTiming).mockImplementationOnce(() => { throw new Error('private URL or token'); });
  act(() => { renderer = create(<StartupTimingButton enabled={false} />); });
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(renderer!.root.findByType('button').props.disabled).not.toBe(true);
  expect(renderer!.root.findByProps({ role: 'alert' }).children).toEqual(['再読み込みできませんでした。もう一度お試しください。']);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('private');
  await act(async () => { await Promise.resolve(); });
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(reloadWithStartupTiming).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});

it('allows a new click when an ordinary leave-page prompt cancels navigation without throwing', async () => {
  act(() => { renderer = create(<StartupTimingButton enabled={false} />); });
  // location.replace returns normally even if a browser leave-page prompt is cancelled.
  act(() => renderer!.root.findByType('button').props.onClick());
  await act(async () => { await Promise.resolve(); });
  expect(renderer!.root.findByType('button').props.disabled).not.toBe(true);
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(reloadWithStartupTiming).toHaveBeenCalledTimes(2);
});
