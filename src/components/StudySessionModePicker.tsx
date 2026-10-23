import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export type StudyMode = 'normal' | 'pomodoro';

export function StudySessionModePicker({ value, disabled, onChange }: {
  value: StudyMode;
  disabled: boolean;
  onChange: (mode: StudyMode) => void;
}) {
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  function beginGesture(event: PointerEvent<HTMLButtonElement>) {
    suppressClick.current = false;
    if (disabled || !event.isPrimary || event.button !== 0) {
      gesture.current = null;
      return;
    }
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function finishGesture(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (disabled || !start || start.id !== event.pointerId) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (Math.abs(x) < 40 || Math.abs(x) <= Math.abs(y) * 1.35) return;
    suppressClick.current = true;
    onChange(x < 0 ? 'pomodoro' : 'normal');
  }

  function select(mode: StudyMode) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!disabled) onChange(mode);
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const mode = event.key === 'ArrowLeft' || event.key === 'Home' ? 'normal' : 'pomodoro';
    onChange(mode);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();
  }

  return (
    <div className="study-session-mode-picker" role="group" aria-label="学習方式" data-mode={value}>
      <span className="study-session-mode-indicator" aria-hidden="true" />
      {(['normal', 'pomodoro'] as const).map(mode => (
        <button key={mode} type="button" data-mode={mode}
          className={value === mode ? 'active' : ''}
          aria-pressed={value === mode} disabled={disabled}
          onPointerDown={beginGesture} onPointerUp={finishGesture}
          onPointerCancel={() => { gesture.current = null; suppressClick.current = false; }}
          onClick={() => select(mode)} onKeyDown={moveWithKeyboard}>
          <strong>{mode === 'normal' ? '通常タイマー' : 'ポモドーロ'}</strong>
        </button>
      ))}
    </div>
  );
}
