import { useEffect, useId, useRef } from 'react';
import { minutesBetween } from '../lib/date';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import type { PlanDraft } from '../types/domain';

interface PlanEditorPanelProps {
  draft: PlanDraft | null;
  submitLabel: string;
  heading: string;
  recurringEditMode?: boolean;
  onChange: (draft: PlanDraft) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function PlanEditorPanel({
  draft,
  submitLabel,
  heading,
  recurringEditMode = false,
  onChange,
  onSubmit,
  onCancel,
}: PlanEditorPanelProps) {
  const headingId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isOpen = draft !== null;

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return undefined;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      const previousFocus = previousFocusRef.current;
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, [isOpen, onCancel]);

  if (!draft) {
    return null;
  }

  const currentDraft = draft;

  const hasInvalidTime =
    minutesBetween(currentDraft.startTime, currentDraft.endTime) <= 0;

  async function handleSubmit() {
    if (hasInvalidTime || !currentDraft.title.trim()) {
      return;
    }

    try {
      await onSubmit();
      onCancel();
    } catch {
      // Keep the editor open; the data layer already reports the failure.
    }
  }

  return (
    <div className="overlay modal-overlay">
      <aside
        ref={dialogRef}
        className="modal-card plan-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2 id={headingId}>{heading}</h2>
              <p>入力項目は最小限に絞っています。</p>
            </div>
            <button
              ref={closeButtonRef}
              className="ghost-button"
              onClick={onCancel}
              type="button"
            >
              閉じる
            </button>
          </div>

          {recurringEditMode ? (
            <div className="assistant-feedback-card">
              <strong>繰り返し予定を編集中です</strong>
              <p className="detail-note">
                保存時に適用範囲を選びます。初期対応では日付と繰り返し条件の直接変更は無効です。
              </p>
            </div>
          ) : null}

          <PlanFieldsEditor
            draft={currentDraft}
            onChange={onChange}
            disableDateField={recurringEditMode}
            disableRepeatFields={recurringEditMode}
            timeRangeMode="edit"
          />

          {hasInvalidTime ? (
            <p className="inline-error">終了時刻は開始時刻より後にしてください。</p>
          ) : null}

          <div className="drawer-actions">
            <button className="ghost-button" onClick={onCancel} type="button">
              キャンセル
            </button>
            <button
              className="primary-button"
              onClick={handleSubmit}
              type="button"
              disabled={hasInvalidTime || !currentDraft.title.trim()}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
