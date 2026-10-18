import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AppSettingsSupportPanel } from './AppSettingsSupportPanel';
import { StartupTimingButton } from './StartupTimingButton';
const state = vi.hoisted(() => ({ enabled: false }));
vi.mock('../lib/startupTiming', () => ({ startupTiming: { get enabled() { return state.enabled; } } }));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; state.enabled = false; });

it.each([false, true])('keeps developer diagnostics out of ordinary support: enabled=%s', enabled => {
  state.enabled = enabled;
  act(() => { renderer = create(<AppSettingsSupportPanel />); });
  expect(renderer!.root.findAllByType(StartupTimingButton)).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ 'aria-label': '起動時間の診断' })).toHaveLength(0);
  expect(renderer!.root.findAllByType('a').map(link => link.props.href)).toEqual(['/contact', '/terms', '/privacy']);
});

it('groups ordinary guidance in native disclosures and preserves the current announcement boundary', () => {
  act(() => { renderer = create(<AppSettingsSupportPanel />); });
  const root = renderer!.root;
  expect(root.findAllByType('h3').map(node => node.children.join(''))).toEqual(['予定と学習', '本棚', '設定とAI', 'お知らせとデータ']);
  const items = root.findAllByType('details');
  const questions = items.map(item => item.findByType('summary').children.join(''));
  expect(new Set(questions).size).toBe(questions.length);
  for (const group of root.findAllByProps({ className: 'faq-group' })) {
    expect(group.findAllByType('details').length).toBeGreaterThan(0);
    expect(group.props['aria-labelledby']).toBe(group.findByType('h3').props.id);
  }
  expect(items.every(item => !item.props.open && item.findAllByType('p').length === 1)).toBe(true);
  const answer = (question: string) => items.find(item => item.findByType('summary').children.includes(question))!.findByType('p').children.join('');
  expect(answer('月・日カレンダーの時間割表示をオフにするとどうなりますか')).toContain('AIの空き時間判定は変わりません');
  expect(answer('画像やPDFから何を読み取れますか')).toContain('PNG・JPEG画像');
  expect(answer('画像やPDFから何を読み取れますか')).toContain('PDFの読み取りは現在未対応');
  expect(answer('教材の章や単元は登録しないといけませんか')).toContain('登録した項目は保持されます');
  expect(answer('教材の章や単元は登録しないといけませんか')).toContain('教材詳細の目次を非表示にしても');
  expect(answer('教材の章や単元は登録しないといけませんか')).not.toContain('構成一覧');
  expect(answer('教材はどのように登録しますか')).toContain('見つからなければ手入力できます');
  // Actual recording no longer exposes the measurement-helper Apply action.
  expect(questions).not.toContain('計測補助の「反映」では何が変わりますか');
  expect(answer('ポモドーロの時間とセット数はどう設定しますか')).toContain('カスタム');
  expect(answer('ポモドーロの時間とセット数はどう設定しますか')).toContain('1〜1440分の整数');
  expect(answer('ポモドーロの時間とセット数はどう設定しますか')).toContain('最後の休憩後に計測が止まり');
  expect(answer('お休み券はいつ使われますか')).toContain('当日の先払いと手動使用はありません');
  expect(answer('お休み券はいつ使われますか')).toContain('7日');
  expect(answer('お休み券はいつ使われますか')).toContain('連続記録の中で');
  expect(answer('通知やリマインダーは使えますか')).toContain('ホームのベル');
  expect(answer('通知やリマインダーは使えますか')).toContain('既読の保存が完了');
  expect(answer('通知やリマインダーは使えますか')).toContain('端末へのプッシュ通知や予定時刻のリマインダーは未対応');
  expect(answer('データはどこに保存されますか')).toContain('このブラウザ内に保存');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('現在のMVPでは通知やリマインダーは未対応');
});
