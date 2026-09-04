import type { CSSProperties } from 'react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { WeekSpanningOccurrenceLayout } from '../lib/scheduleOccurrencePresentation';
import type { Plan } from '../types/domain';

interface WeekSpanningEventsLaneProps {
  layout: WeekSpanningOccurrenceLayout;
  plans: readonly Plan[];
  onOpenPlan?: (plan: Plan) => void;
}

function toneClassForOccurrence(occurrence: ScheduleOccurrence): string {
  const key = (occurrence.subject || occurrence.title || occurrence.id).trim();
  const toneIndex = Array.from(key || occurrence.id).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  ) % 8;
  return `weekly-draft-tone-${toneIndex + 1}`;
}

function cardStyle(item: WeekSpanningOccurrenceLayout['items'][number]): CSSProperties {
  return {
    gridColumn: `${item.startColumn + 2} / ${item.endColumn + 2}`,
    gridRow: item.lane + 1,
    alignSelf: 'center',
    boxSizing: 'border-box',
    minWidth: 0,
    height: '24px',
    margin: '2px 1px',
    padding: '2px 2px',
    overflow: 'hidden',
    border: '1px solid color-mix(in srgb, var(--weekly-draft-tone) 46%, var(--border) 54%)',
    borderRadius: '6px',
    background: 'var(--weekly-draft-tone-bg)',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: '0.5rem',
    fontWeight: 850,
    lineHeight: 1.1,
    textAlign: 'center',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

export function WeekSpanningEventsLane({
  layout,
  plans,
  onOpenPlan,
}: WeekSpanningEventsLaneProps) {
  if (layout.items.length === 0) return null;

  return (
    <div
      data-schedule-week-spanning-events="true"
      style={{
        display: 'grid',
        gridTemplateColumns: '46px repeat(7, minmax(0, 1fr))',
        gridTemplateRows: `repeat(${Math.max(layout.laneCount, 1)}, 28px)`,
        minWidth: 0,
        borderBottom: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--surface) 96%, var(--surface-strong) 4%)',
      }}
    >
      <span
        style={{
          gridColumn: 1,
          gridRow: `1 / span ${Math.max(layout.laneCount, 1)}`,
          display: 'grid',
          placeItems: 'center end',
          paddingRight: '5px',
          borderRight: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: '0.5rem',
          fontWeight: 850,
        }}
      >
        終日
      </span>
      {layout.items.map((item) => {
        const { occurrence } = item;
        const plan = occurrence.source.backingKind === 'plan'
          ? plans.find((candidate) => candidate.id === occurrence.source.backingId)
          : undefined;
        const commonProps = {
          className: toneClassForOccurrence(occurrence),
          'data-schedule-occurrence-id': occurrence.id,
          'data-week-spanning-event': 'true',
          style: cardStyle(item),
          title: `${occurrence.title} / ${occurrence.start.date} ${occurrence.start.time} - ${occurrence.end.date} ${occurrence.end.time}`,
        };

        if (plan) {
          return (
            <button
              {...commonProps}
              key={occurrence.id}
              type="button"
              aria-label={`${occurrence.title}。終日または日を跨ぐ予定。タップで編集、長押しで操作`}
              onClick={() => onOpenPlan?.(plan)}
              onContextMenu={(event) => event.preventDefault()}
              style={{ ...commonProps.style, cursor: 'pointer' }}
            >
              {occurrence.title}
            </button>
          );
        }

        return (
          <span
            {...commonProps}
            key={occurrence.id}
            aria-label={`${occurrence.title}。終日または日を跨ぐ予定。長押しで操作`}
            onContextMenu={(event) => event.preventDefault()}
          >
            {occurrence.title}
          </span>
        );
      })}
    </div>
  );
}
