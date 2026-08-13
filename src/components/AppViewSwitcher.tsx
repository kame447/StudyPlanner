import type { ViewMode } from '../types/domain';

const VIEW_OPTIONS: ReadonlyArray<{ mode: ViewMode; label: string }> = [
  { mode: 'month', label: '月' },
  { mode: 'week', label: '週' },
  { mode: 'day', label: '日' },
  { mode: 'todo', label: 'Todo' },
  { mode: 'report', label: 'レポート' },
  { mode: 'timetable', label: '時間割' },
  { mode: 'bookshelf', label: '本棚' },
];

export function AppViewSwitcher({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (viewMode: ViewMode) => void;
}) {
  return (
    <div className="toolbar panel app-view-switcher print-hide">
      <div className="segmented-control">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.mode}
            className={viewMode === option.mode ? 'segment active' : 'segment'}
            onClick={() => onChange(option.mode)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
