import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../hooks/useDialogFocus';

/** Reading a full title never starts, edits or navigates away from its plan. */
export function HomePlanTitle({ title }: { title: string }) {
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { dialogRef, initialFocusRef } = useDialogFocus<HTMLDivElement>(open, close);
  return <>
    <h1><button type="button" className="home-plan-title" aria-haspopup="dialog"
      aria-describedby={descriptionId} onClick={() => setOpen(true)}><span>{title}</span></button></h1>
    <span id={descriptionId} hidden>予定名の全文を読む</span>
    {open && createPortal(
      <div className="overlay modal-overlay home-title-overlay" onClick={close}>
        <div ref={dialogRef} tabIndex={-1} className="modal-card panel section-stack"
          role="dialog" aria-modal="true" aria-label="予定名の全文" onClick={event => event.stopPropagation()}>
          <div className="section-header"><h2>{title}</h2></div>
          <button ref={node => { initialFocusRef.current = node; }} type="button" className="ghost-button" onClick={close}>閉じる</button>
        </div>
      </div>, document.body,
    )}
  </>;
}
