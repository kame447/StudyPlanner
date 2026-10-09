import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPlanDraftFromTimetableImportCandidate } from '../lib/timetableImport';
import type { TimetableImportCandidate } from '../lib/timetableImport';
import type { PlanDraft } from '../types/domain';

interface DayTimetableImportDialogProps {
  open: boolean;
  dateLabel: string;
  selectedDate: string;
  userId: string;
  candidates: TimetableImportCandidate[];
  importedSourceIds: Set<string>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onClose: () => void;
}

export function DayTimetableImportDialog({
  open,
  dateLabel,
  selectedDate,
  userId,
  candidates,
  importedSourceIds,
  onSavePlan,
  onClose,
}: DayTimetableImportDialogProps) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isImporting, setIsImporting] = useState(false);
  const context = useMemo(() => ({ userId, selectedDate }), [userId, selectedDate]);
  const session = useMemo(() => (open ? {} : null), [context, open]);
  const activeContext = useRef<typeof context | null>(null);
  const activeSession = useRef<object | null>(null);
  const pending = useRef<{ context: typeof context; sourceIds: Set<string> } | null>(null);
  const selectionSession = useRef<object | null>(null);
  const imported = useRef(importedSourceIds);
  const completed = useRef({ context, sourceIds: new Set<string>() });
  const [completionRevision, setCompletionRevision] = useState(0);
  const [failure, setFailure] = useState<{ context: typeof context; message: string } | null>(null);

  useLayoutEffect(() => {
    activeContext.current = context;
    completed.current = { context, sourceIds: new Set() };
    return () => { activeContext.current = null; };
  }, [context]);
  useLayoutEffect(() => {
    activeSession.current = session;
    return () => { activeSession.current = null; };
  }, [session]);
  useLayoutEffect(() => {
    imported.current = importedSourceIds;
    // Receipts only bridge the gap before parent props publish a saved plan.
    // Once published, normal plan deletion can make the source importable again.
    for (const sourceId of completed.current.sourceIds) {
      if (importedSourceIds.has(sourceId)) completed.current.sourceIds.delete(sourceId);
    }
  }, [importedSourceIds]);

  const reflectedSourceIds = useMemo(() => new Set([
    ...importedSourceIds,
    ...(completed.current.context === context ? completed.current.sourceIds : []),
  ]), [context, importedSourceIds, completionRevision]);

  useEffect(() => {
    const available = new Set(candidates.filter(candidate => !reflectedSourceIds.has(candidate.sourceId)
      || (pending.current?.context === context && pending.current.sourceIds.has(candidate.sourceId)))
      .map(candidate => candidate.sourceId));
    const isNewSession = selectionSession.current !== session;
    selectionSession.current = session;
    // A parent may publish an optimistic plan before its write settles. Keep
    // the selection intent so a rollback makes the failed row retryable.
    const candidateIds = new Set(candidates.map(candidate => candidate.sourceId));
    setSelectedSourceIds(current => !session ? new Set() : isNewSession ? available
      : new Set([...current].filter(sourceId => candidateIds.has(sourceId))));
  }, [candidates, context, reflectedSourceIds, session]);

  if (!open) return null;

  function closeDialog() {
    if (!session || activeSession.current !== session) return;
    activeSession.current = null;
    onClose();
  }

  function toggleCandidate(sourceId: string) {
    if (pending.current || activeSession.current !== session) return;
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  async function importSelectedCandidates() {
    // React state alone cannot reject two callbacks in the same event turn.
    // This admission survives a closed/reopened dialog until the batch settles.
    if (!session || activeSession.current !== session || activeContext.current !== context || pending.current) return;
    const candidatesToImport = candidates.filter(candidate => selectedSourceIds.has(candidate.sourceId)
      && !imported.current.has(candidate.sourceId) && !completed.current.sourceIds.has(candidate.sourceId));
    if (candidatesToImport.length === 0) return;
    const operation = { context, sourceIds: new Set(candidatesToImport.map(candidate => candidate.sourceId)) };
    pending.current = operation;
    setFailure(null);
    setIsImporting(true);
    try {
      for (const candidate of candidatesToImport) {
        // Navigation/account changes stop work that has not been dispatched.
        // Closing alone does not cancel the user's already-requested batch.
        if (activeContext.current !== context) return;
        if (imported.current.has(candidate.sourceId)) continue;
        await onSavePlan(createPlanDraftFromTimetableImportCandidate(candidate, userId, selectedDate));
        if (activeContext.current !== context) return;
        operation.sourceIds.delete(candidate.sourceId);
        if (!imported.current.has(candidate.sourceId)) completed.current.sourceIds.add(candidate.sourceId);
        setCompletionRevision(value => value + 1);
      }
      if (activeSession.current === session) closeDialog();
    } catch {
      if (activeContext.current === context) {
        setFailure({ context, message: '時間割をすべて反映できませんでした。反映済みの授業を除いて、もう一度お試しください。' });
      }
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        if (activeContext.current) setIsImporting(false);
      }
    }
  }

  return (
    <div className="overlay modal-overlay" onClick={closeDialog}>
      <div
        className="modal-card timetable-import-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>今日の時間割を反映</h2>
              <p>{dateLabel}</p>
            </div>
            <button className="ghost-button" onClick={closeDialog} type="button">
              閉じる
            </button>
          </div>

          <section className="timetable-import-card">
            <h3>反映する授業</h3>
            {candidates.length > 0 ? (
              <div className="timetable-import-list">
                {candidates.map((candidate) => {
                  const isImported = reflectedSourceIds.has(candidate.sourceId);

                  return (
                    <label className="timetable-import-item" key={candidate.id}>
                      <input
                        type="checkbox"
                        checked={!isImported && selectedSourceIds.has(candidate.sourceId)}
                        disabled={isImported || isImporting}
                        onChange={() => toggleCandidate(candidate.sourceId)}
                      />
                      <span>
                        <strong>{candidate.title}</strong>
                        <span>
                          {candidate.startTime}-{candidate.endTime}
                          {candidate.periodLabel ? ` / ${candidate.periodLabel}` : ''}
                          {candidate.subject ? ` / ${candidate.subject}` : ''}
                          {candidate.classroom ? ` / ${candidate.classroom}` : ''}
                          {isImported ? ' / 反映済み' : ''}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="empty-copy">この曜日の時間割はありません。</p>
            )}
          </section>

          {isImporting ? <p role="status">時間割を反映しています。閉じても処理は続きます。</p> : null}
          {failure?.context === context ? <p role="alert">{failure.message}</p> : null}

          <div className="row-actions timetable-import-actions">
            <button className="ghost-button" onClick={closeDialog} type="button">
              キャンセル
            </button>
            <button
              className="primary-button"
              disabled={isImporting || !candidates.some(candidate => selectedSourceIds.has(candidate.sourceId) && !reflectedSourceIds.has(candidate.sourceId))}
              onClick={() => {
                void importSelectedCandidates();
              }}
              type="button"
            >
              反映
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
