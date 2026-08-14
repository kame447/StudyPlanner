import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!open) {
      setSelectedSourceIds(new Set());
      setIsImporting(false);
      return;
    }

    setSelectedSourceIds(
      new Set(
        candidates
          .filter((candidate) => !importedSourceIds.has(candidate.sourceId))
          .map((candidate) => candidate.sourceId),
      ),
    );
  }, [candidates, importedSourceIds, open]);

  if (!open) {
    return null;
  }

  function toggleCandidate(sourceId: string) {
    setSelectedSourceIds((current) => {
      const next = new Set(current);

      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }

      return next;
    });
  }

  async function importSelectedCandidates() {
    const candidatesToImport = candidates.filter(
      (candidate) =>
        selectedSourceIds.has(candidate.sourceId) &&
        !importedSourceIds.has(candidate.sourceId),
    );

    if (candidatesToImport.length === 0) {
      onClose();
      return;
    }

    setIsImporting(true);
    try {
      for (const candidate of candidatesToImport) {
        await onSavePlan(
          createPlanDraftFromTimetableImportCandidate(candidate, userId, selectedDate),
        );
      }
      onClose();
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
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
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <section className="timetable-import-card">
            <h3>反映する授業</h3>
            {candidates.length > 0 ? (
              <div className="timetable-import-list">
                {candidates.map((candidate) => {
                  const isImported = importedSourceIds.has(candidate.sourceId);

                  return (
                    <label className="timetable-import-item" key={candidate.id}>
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.has(candidate.sourceId)}
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

          <div className="row-actions timetable-import-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              キャンセル
            </button>
            <button
              className="primary-button"
              disabled={isImporting || selectedSourceIds.size === 0}
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
