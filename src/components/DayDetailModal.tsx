import { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, NotebookPen, Pencil, Trash2, X } from 'lucide-react';
import { useExitMotion } from '../hooks/useExitMotion';
import { buildPlanOccurrenceKey } from '../lib/planRecurrence';
import { ActualEditorCard } from './ActualEditorCard';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';
import type { Actual, ActualDraft, MonthEvent, Plan } from '../types/domain';

interface DayDetailModalProps {
  detailPlan: Plan | null;
  monthEvent: MonthEvent | null;
  detailActual?: Actual;
  standaloneActual: Actual | null;
  plans: Plan[];
  actuals: Actual[];
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onClose: () => void;
}

type RecordSession = { plan: Plan; actual?: Actual };

export function DayDetailModal(props: DayDetailModalProps) {
  const plan = props.detailPlan;
  const key = JSON.stringify([plan?.userId, plan?.id, plan?.date, props.standaloneActual?.userId, props.standaloneActual?.id]);
  return <DayDetailSession key={key} {...props} />;
}

function DayDetailSession({
  detailPlan,
  monthEvent,
  detailActual,
  standaloneActual,
  plans,
  actuals,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onSaveStandaloneActual,
  onLinkStandaloneActualToPlan,
  onDeleteActual,
  onClose,
}: DayDetailModalProps) {
  const [recordSession, setRecordSession] = useState<RecordSession | null>(null);
  const { isExiting, requestExit } = useExitMotion(onClose);
  const sheetMotionClassName = isExiting ? 'is-closing' : 'is-open';

  if (detailPlan) {
    if (!recordSession) {
      return (
        <div
          className={`overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion ${sheetMotionClassName}`}
          onClick={() => requestExit()}
        >
          <section
            className="modal-card daily-detail-modal schedule-action-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${detailPlan.title}の操作`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="schedule-action-handle" aria-hidden="true" />
            <div className="schedule-action-topline">
              <button className="schedule-action-close" onClick={() => requestExit()} type="button" aria-label="閉じる">
                <X aria-hidden="true" size={22} />
              </button>
              <div>
                <strong>{detailPlan.title}</strong>
                <span>{detailPlan.startTime} - {detailPlan.endTime}</span>
              </div>
            </div>

            <div className="schedule-action-list">
              {!monthEvent ? (
                <button
                  className="schedule-action-item"
                  onClick={() => {
                    requestExit(() => {
                      window.requestAnimationFrame(() => onEditPlan(detailPlan));
                    });
                  }}
                  type="button"
                >
                  <span className="schedule-action-icon"><Pencil aria-hidden="true" size={24} /></span>
                  <span className="schedule-action-copy">
                    <strong>予定を編集</strong>
                    <small>時間や内容を変更</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={22} />
                </button>
              ) : null}

              <button
                className="schedule-action-item"
                onClick={() => setRecordSession(structuredClone({ plan: detailPlan, actual: detailActual }))}
                type="button"
              >
                <span className="schedule-action-icon"><NotebookPen aria-hidden="true" size={24} /></span>
                <span className="schedule-action-copy">
                  <strong>{detailActual ? '記録を編集' : '記録を保存'}</strong>
                  <small>実際の内容を保存</small>
                </span>
                <ChevronRight aria-hidden="true" size={22} />
              </button>

              {!monthEvent ? (
                <button
                  className="schedule-action-item danger"
                  onClick={() => {
                    void onDeletePlan(detailPlan).finally(() => requestExit());
                  }}
                  type="button"
                >
                  <span className="schedule-action-icon"><Trash2 aria-hidden="true" size={24} /></span>
                  <span className="schedule-action-copy">
                    <strong>削除</strong>
                    <small>この予定を削除</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={22} />
                </button>
              ) : null}
            </div>
          </section>
        </div>
      );
    }

    return <PlannedActualDetail session={recordSession} plans={plans} actuals={actuals}
      onEditPlan={onEditPlan} onDeletePlan={onDeletePlan} onSaveActual={onSaveActual}
      onDeleteActual={onDeleteActual} onClose={onClose} onBack={() => setRecordSession(null)} />;
  }

  if (!standaloneActual) {
    return null;
  }

  return <StandaloneActualDetail key={JSON.stringify([standaloneActual.userId, standaloneActual.id])}
    standaloneActual={standaloneActual} plans={plans} actuals={actuals}
    onSaveStandaloneActual={onSaveStandaloneActual} onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
    onDeleteActual={onDeleteActual} onClose={onClose} />;
}

type StandaloneActualDetailProps = Pick<DayDetailModalProps,
  'plans' | 'actuals' | 'onSaveStandaloneActual' | 'onLinkStandaloneActualToPlan' | 'onDeleteActual' | 'onClose'>
  & { standaloneActual: Actual };

function StandaloneActualDetail({ standaloneActual, plans, actuals, onSaveStandaloneActual,
  onLinkStandaloneActualToPlan, onDeleteActual, onClose }: StandaloneActualDetailProps) {
  const [isPending, setIsPending] = useState(false);
  const pending = useRef(false);
  const observePending = useCallback((value: boolean) => { pending.current = value; setIsPending(value); }, []);
  const { isExiting, requestExit } = useExitMotion(onClose);
  const sheetMotionClassName = isExiting ? 'is-closing' : 'is-open';
  const requestClose = () => { if (!pending.current) requestExit(); };
  return (
    <div
      className={`overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion ${sheetMotionClassName}`}
      onClick={requestClose}
    >
      <div
        className="modal-card daily-detail-modal schedule-record-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="schedule-action-handle" aria-hidden="true" />
        <div className="daily-detail-modal-header">
          <span className="schedule-action-header-spacer" />
          <div className="daily-detail-modal-heading">
            <h2>記録を編集</h2>
            <p>
              {standaloneActual.actualStartTime} - {standaloneActual.actualEndTime} /{' '}
              {standaloneActual.title || '記録'}
            </p>
          </div>
          <button className="schedule-action-close" onClick={requestClose} disabled={isPending} type="button" aria-label="閉じる">
            <X aria-hidden="true" size={21} />
          </button>
        </div>

        <div className="daily-detail-modal-body">
          <StandaloneActualEditorCard
            key={standaloneActual.id}
            actual={standaloneActual}
            plans={plans}
            actuals={actuals}
            onSaveStandaloneActual={onSaveStandaloneActual}
            onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
            onDeleteActual={onDeleteActual}
            onClose={() => requestExit()}
            onPendingChange={observePending}
          />
        </div>
      </div>
    </div>
  );
}


type PlannedActualDetailProps = Pick<DayDetailModalProps,
  'plans' | 'actuals' | 'onEditPlan' | 'onDeletePlan' | 'onSaveActual' | 'onDeleteActual' | 'onClose'>
  & { session: RecordSession; onBack: () => void };

function PlannedActualDetail({ session, plans, actuals, onEditPlan, onDeletePlan,
  onSaveActual, onDeleteActual, onClose, onBack }: PlannedActualDetailProps) {
  const [isPending, setIsPending] = useState(false);
  const pending = useRef(false);
  const observePending = useCallback((value: boolean) => { pending.current = value; setIsPending(value); }, []);
  const { isExiting, requestExit } = useExitMotion(onClose);
  const sheetMotionClassName = isExiting ? 'is-closing' : 'is-open';
  const requestClose = () => { if (!pending.current) requestExit(); };
  return (
    <div
      className={`overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion ${sheetMotionClassName}`}
      onClick={requestClose}
    >
      <div
        className="modal-card daily-detail-modal schedule-record-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="schedule-action-handle" aria-hidden="true" />
        <div className="daily-detail-modal-header">
          <button className="schedule-action-back" onClick={() => { if (!pending.current) onBack(); }} disabled={isPending} type="button" aria-label="戻る">
            <ChevronLeft aria-hidden="true" size={22} />
          </button>
          <div className="daily-detail-modal-heading">
            <h2>{session.actual ? '記録を編集' : '記録を保存'}</h2>
            <p>
              {session.plan.startTime} - {session.plan.endTime} / {session.plan.title}
            </p>
          </div>
          <button className="schedule-action-close" onClick={requestClose} disabled={isPending} type="button" aria-label="閉じる">
            <X aria-hidden="true" size={21} />
          </button>
        </div>

        <div className="daily-detail-modal-body">
          <ActualEditorCard
            key={buildPlanOccurrenceKey(session.plan.id, session.plan.date)}
            plan={session.plan}
            plans={plans}
            actuals={actuals}
            actual={session.actual}
            onEditPlan={onEditPlan}
            onDeletePlan={onDeletePlan}
            onSaveActual={onSaveActual}
            onDeleteActual={onDeleteActual}
            onClose={() => requestExit()}
            onPendingChange={observePending}
            isClosing={isExiting}
            forceOpen
            hideToggleButton
            hidePlanActions
          />
        </div>
      </div>
    </div>
  );
}
