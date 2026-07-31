import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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

describe('AppSettingsDialog weekly planning runtime', () => {
  it('shows Stable V5 as fixed and exposes no legacy selection', () => {
    const html = renderToStaticMarkup(
      <AppSettingsDialog
        open
        themeMode="light"
        themePalette="mint"
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
