import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsDialog } from './AppSettingsDialog';

vi.mock(
  '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext',
  () => ({
    useWeeklyPlanningPersonalization: () => ({
      weekStartsOn: 'monday',
      setWeekStartsOn: vi.fn(),
      resetProfile: vi.fn(),
    }),
  }),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderDialog(): string {
  return renderToStaticMarkup(
    <AppSettingsDialog
      open
      themeMode="light"
      themePalette="forest"
      onChangeTheme={vi.fn()}
      onChangeThemePalette={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('AppSettingsDialog weekly planning runtime', () => {
  it('offers the Issue #488 architecture selector only while the evaluation gate is enabled', () => {
    const hidden = renderDialog();
    expect(hidden).not.toContain('旧Stable V5');
    expect(hidden).not.toContain('新Interaction V1');
    expect(hidden).not.toContain('次の新規AI計画会話から適用');

    vi.stubEnv('VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED', '1');
    const shown = renderDialog();
    expect(shown).toContain('旧Stable V5');
    expect(shown).toContain('新Interaction V1');
    expect(shown).toContain('次の新規AI計画会話から適用');
  });

  it('shows Stable V5 as fixed and exposes no legacy selection', () => {
    const html = renderToStaticMarkup(
      <AppSettingsDialog
        open
        themeMode="light"
        themePalette="forest"
        onChangeTheme={vi.fn()}
        onChangeThemePalette={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('週間計画AI');
    expect(html).toContain('Stable V5');
    expect(html).toContain('固定');
    expect(html).not.toContain('現行方式');
    expect(html).not.toContain('旧方式を選択');
  });
});
