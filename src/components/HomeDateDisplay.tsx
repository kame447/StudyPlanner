import { getWeekdayLabel } from '../lib/date';

interface HomeDateDisplayProps {
  date: string;
}

export function HomeDateDisplay({ date }: HomeDateDisplayProps) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = getWeekdayLabel(date);

  const segments = [
    { key: 'year', value: String(year), suffix: '年' },
    { key: 'month', value: String(month), suffix: '月' },
    { key: 'day', value: String(day), suffix: '日' },
    { key: 'weekday', value: weekday, suffix: '' },
  ] as const;

  return (
    <time
      className="home-date-display"
      dateTime={date}
      aria-label={`${year}年${month}月${day}日 ${weekday}曜日`}
    >
      <span className="home-date-paper">
        {segments.map((segment) => (
          <span className={`home-date-segment home-date-segment-${segment.key}`} key={segment.key}>
            <span className="home-date-value">{segment.value}</span>
            {segment.suffix ? (
              <span className="home-date-unit">{segment.suffix}</span>
            ) : null}
          </span>
        ))}
      </span>
    </time>
  );
}
