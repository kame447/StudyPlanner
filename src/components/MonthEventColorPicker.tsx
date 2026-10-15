import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Tag } from 'lucide-react';
import { MONTH_EVENT_COLOR_OPTIONS } from '../lib/scheduleEventColor';
import type { MonthEventColor } from '../types/domain';

interface MonthEventColorPickerProps {
  color?: MonthEventColor;
  automaticColor?: string;
  disabled: boolean;
  onChange: (color: MonthEventColor | undefined) => void;
}

export function MonthEventColorPicker({ color, automaticColor, disabled, onChange }: MonthEventColorPickerProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const selected = MONTH_EVENT_COLOR_OPTIONS.find(option => option.key === color);
  const options = [
    { key: undefined, label: '自動', color: automaticColor ?? 'var(--text-muted)' },
    ...MONTH_EVENT_COLOR_OPTIONS,
  ];

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || disabled || !dialog) return;
    dialog.showModal();
    // Preserve native arrow-key selection without focusing a text-capable control.
    const selectedRadio = selectedInputRef.current;
    if (selectedRadio?.type === 'radio' && selectedRadio.checked) selectedRadio.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, [open, disabled]);

  function closePicker() {
    // Close while mounted so the browser can restore focus to the label row.
    dialogRef.current?.close();
    setOpen(false);
  }

  const pickerDialog = open && !disabled ? (
    <dialog
      id={`${id}-dialog`}
      className="month-event-color-dialog"
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); closePicker(); }}
      onClick={event => { if (event.target === event.currentTarget) closePicker(); }}
    >
      <div className="month-event-color-picker-content">
        <div className="month-event-color-picker-header">
          <strong id={`${id}-title`}>ラベルを選択</strong>
          <button type="button" className="ghost-button" onClick={closePicker}>完了</button>
        </div>
        <div className="month-event-color-options" role="radiogroup" aria-labelledby={`${id}-title`}>
          {options.map(option => (
            <label key={option.key ?? 'automatic'} className="month-event-color-option">
              <span className="month-event-color-dot" style={{ backgroundColor: option.color }} aria-hidden="true" />
              <span>{option.label}</span>
              <input
                ref={color === option.key ? selectedInputRef : undefined}
                type="radio"
                name={`${id}-color`}
                aria-label={option.label}
                value={option.key ?? 'automatic'}
                checked={color === option.key}
                onChange={() => onChange(option.key)}
              />
            </label>
          ))}
        </div>
      </div>
    </dialog>
  ) : null;

  return (
    <section className="month-event-core-section month-event-color-section" aria-label="予定の色">
      <button
        className="month-event-color-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? `${id}-dialog` : undefined}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(true); }}
      >
        <Tag size={20} aria-hidden="true" />
        <span>ラベル</span>
        <span className="month-event-color-value">
          <span className="month-event-color-dot" style={{ backgroundColor: selected?.color ?? options[0].color }} aria-hidden="true" />
          <span>{selected?.label ?? '自動'}</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
      {pickerDialog && typeof document !== 'undefined'
        ? createPortal(pickerDialog, document.body)
        : pickerDialog}
    </section>
  );
}
