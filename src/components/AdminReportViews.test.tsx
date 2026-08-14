import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatMinutes } from '../lib/date';
import {
  AdminMetricCard,
  formatSignedMinutes,
  getReportModeLabel,
} from './AdminReportViews';

describe('AdminReportViews', () => {
  it('labels report modes deterministically', () => {
    expect(getReportModeLabel('day')).toBe('日');
    expect(getReportModeLabel('week')).toBe('週');
    expect(getReportModeLabel('month')).toBe('月');
  });

  it('formats signed minute deltas without changing the zero format', () => {
    expect(formatSignedMinutes(0)).toBe(formatMinutes(0));
    expect(formatSignedMinutes(90)).toBe(`+${formatMinutes(90)}`);
    expect(formatSignedMinutes(-90)).toBe(`-${formatMinutes(90)}`);
  });

  it('renders the shared metric primitive with its label and value', () => {
    const html = renderToStaticMarkup(
      <AdminMetricCard label="今日" value="1時間" />,
    );

    expect(html).toContain('今日');
    expect(html).toContain('1時間');
  });
});
