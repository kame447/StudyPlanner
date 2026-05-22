import { useEffect, useMemo, useState } from 'react';
import { formatMinutes, minutesBetween } from '../lib/date';
import { supportsScopedRecurringPlanEdits } from '../domain/recurringPlan';
import { getPlanTypeLabel } from '../lib/plans';
import { expandPlansForDate, getPlanOccurrenceDate } from '../lib/planRecurrence';
import { buildActualPlanLinkCandidates } from '../lib/actualPlanMatching';
import {
  buildActualMaterialProgressUpdatesFromInput,
  getMaterialUnitLabel,
} from '../lib/materialPace';
import type { Actual, ActualDraft, Plan, StudyMaterial } from '../types/domain';
import { ActualTrackingTools } from './ActualTrackingTools';

interface ActualEditorCardProps {
  plan: Plan;
  plans: Plan[];
  actuals: Actual[];
  materials: StudyMaterial[];
  actual?: Actual;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onClose?: () => void;
  forceOpen?: boolean;
  hideToggleButton?: boolean;
  hidePlanActions?: boolean;
}

function resolveActualTitle(plan: Plan, actual?: Actual): string {
  return actual?.title?.trim() || plan.title;
}

function resolveActualSubject(plan: Plan, actual?: Actual): string {
  return actual?.subject?.trim() || plan.subject;
}

function resolveAlignedToPlan(plan: Plan, actual?: Actual): boolean {
  if (typeof actual?.isAlignedToPlan === 'boolean') {
    return actual.isAlignedToPlan;
  }

  return (
    resolveActualTitle(plan, actual) === plan.title &&
    resolveActualSubject(plan, actual) === plan.subject
  );
}

function buildDraft(plan: Plan, actual?: Actual): ActualDraft {
  return {
    userId: plan.userId,
    planId: plan.id,
    occurrenceDate: actual?.occurrenceDate ?? getPlanOccurrenceDate(plan),
    actualStartTime: actual?.actualStartTime ?? plan.startTime,
    actualEndTime: actual?.actualEndTime ?? plan.endTime,
    title: resolveActualTitle(plan, actual),
    subject: resolveActualSubject(plan, actual),
    isAlignedToPlan: resolveAlignedToPlan(plan, actual),
    note: actual?.note ?? '',
    materialId: actual?.materialId ?? plan.materialId ?? null,
    materialName: actual?.materialName ?? plan.materialName ?? '',
    materialProgressUpdates: actual?.materialProgressUpdates,
  };
}

export function ActualEditorCard({
  plan,
  plans,
  actuals,
  materials,
  actual,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onDeleteActual,
  onClose,
  forceOpen = false,
  hideToggleButton = false,
  hidePlanActions = false,
}: ActualEditorCardProps) {
  const [draft, setDraft] = useState<ActualDraft>(buildDraft(plan, actual));
  const [isOpen, setIsOpen] = useState(forceOpen || !actual);
  const [error, setError] = useState('');
  const [selectedCandidatePlanId, setSelectedCandidatePlanId] = useState<string | null>(null);
  const [progressMaterialId, setProgressMaterialId] = useState('');
  const [deltaUnitsInput, setDeltaUnitsInput] = useState('');
  const [toUnitInput, setToUnitInput] = useState('');

  useEffect(() => {
    setDraft(buildDraft(plan, actual));
    setError('');
    setIsOpen(forceOpen || !actual);
    setSelectedCandidatePlanId(null);
    setDeltaUnitsInput('');
    setToUnitInput('');
  }, [actual?.id, forceOpen, plan]);

  const planMinutes = minutesBetween(plan.startTime, plan.endTime);
  const actualMinutes = actual
    ? minutesBetween(actual.actualStartTime, actual.actualEndTime)
    : 0;
  const deltaMinutes = actual ? actualMinutes - planMinutes : null;
  const isScopedRecurringPlan = supportsScopedRecurringPlanEdits(plan);
  const actualTitle = resolveActualTitle(plan, actual);
  const actualSubject = resolveActualSubject(plan, actual);
  const alignedToPlan = resolveAlignedToPlan(plan, actual);
  const isActualDateChanged = Boolean(actual && draft.occurrenceDate !== actual.occurrenceDate);
  const candidateActual =
    actual && isActualDateChanged
      ? {
          ...actual,
          occurrenceDate: draft.occurrenceDate,
          actualStartTime: draft.actualStartTime,
          actualEndTime: draft.actualEndTime,
          title: draft.title,
          subject: draft.subject,
          isAlignedToPlan: false,
          note: draft.note,
        }
      : null;
  const candidatePlans = useMemo(
    () => expandPlansForDate(plans, draft.occurrenceDate),
    [draft.occurrenceDate, plans],
  );
  const linkCandidates = candidateActual
    ? buildActualPlanLinkCandidates(candidateActual, candidatePlans, actuals)
    : [];
  const selectedCandidate = linkCandidates.find(
    (candidate) => candidate.plan.id === selectedCandidatePlanId,
  );
  const paceMaterials = useMemo(
    () =>
      materials.filter(
        (material) =>
          material.userId === plan.userId &&
          material.status !== 'archived' &&
          material.paceEnabled === true,
      ),
    [materials, plan.userId],
  );
  const selectedProgressMaterial =
    paceMaterials.find((material) => material.id === progressMaterialId) ?? null;

  useEffect(() => {
    const existingProgressMaterialId = actual?.materialProgressUpdates?.[0]?.materialId;
    const preferredMaterialId =
      existingProgressMaterialId ?? actual?.materialId ?? plan.materialId ?? '';
    const hasPreferredMaterial = paceMaterials.some(
      (material) => material.id === preferredMaterialId,
    );

    setProgressMaterialId(hasPreferredMaterial ? preferredMaterialId : '');
  }, [actual?.id, actual?.materialId, actual?.materialProgressUpdates, paceMaterials, plan.materialId]);

  function setAlignedToPlan(nextAligned: boolean) {
    setDraft((current) => ({
      ...current,
      isAlignedToPlan: nextAligned,
      title: nextAligned ? plan.title : current.title || plan.title,
      subject: nextAligned ? plan.subject : current.subject || plan.subject,
      materialId: nextAligned ? plan.materialId ?? null : current.materialId,
      materialName: nextAligned ? plan.materialName ?? '' : current.materialName,
    }));
  }

  function applyMeasuredRange(startTime: string, endTime: string) {
    setDraft((current) => ({
      ...current,
      actualStartTime: startTime,
      actualEndTime: endTime,
    }));
    setError('');
  }

  async function handleSave() {
    if (minutesBetween(draft.actualStartTime, draft.actualEndTime) <= 0) {
      setError('記録の終了時刻は開始時刻より後にしてください。');
      return;
    }

    if (!draft.isAlignedToPlan && !draft.title.trim()) {
      setError('違う内容で記録する場合は、実際にやった内容を入れてください。');
      return;
    }

    setError('');
    try {
      const nextPlan = isActualDateChanged && selectedCandidate ? selectedCandidate.plan : plan;
      const materialProgressUpdates = buildActualMaterialProgressUpdatesFromInput({
        materials: paceMaterials,
        materialId: progressMaterialId,
        deltaUnitsInput,
        toUnitInput,
      });
      const nextDraft: ActualDraft = isActualDateChanged
        ? {
            ...draft,
            planId: selectedCandidate?.plan.id ?? null,
            isAlignedToPlan: false,
            materialProgressUpdates,
          }
        : {
            ...draft,
            materialProgressUpdates,
          };

      setIsOpen(false);
      await onSaveActual(nextPlan, nextDraft, actual?.id);
    } catch {
      setIsOpen(true);
      setError('記録の保存に失敗しました。');
    }
  }

  async function handleDeletePlan() {
    try {
      await onDeletePlan(plan);
      setIsOpen(false);
      if (!isScopedRecurringPlan) {
        onClose?.();
      }
    } catch {
      setError('予定の削除に失敗しました。');
    }
  }

  async function handleDeleteActual() {
    if (!actual) {
      return;
    }

    try {
      await onDeleteActual(actual);
      setIsOpen(false);
      onClose?.();
    } catch {
      setError('記録の削除に失敗しました。');
    }
  }

  return (
    <article className="plan-detail-card actual-editor-card">
      <div className="plan-detail-head actual-editor-head">
        <div>
          <div className="label-row">
            <strong>{plan.title}</strong>
            <span className="type-badge">{getPlanTypeLabel(plan.type, plan.sourceType)}</span>
          </div>
          <p className="comparison-subtitle">
            計画 {getPlanOccurrenceDate(plan)} / {plan.startTime} - {plan.endTime}
            {plan.subject ? ` / ${plan.subject}` : ''}
          </p>
          <p className="comparison-metrics">
            {actual
              ? `記録 ${actual.actualStartTime} - ${actual.actualEndTime} / ${
                  alignedToPlan
                    ? '予定通り'
                    : `実施内容: ${actualTitle}${actualSubject ? ` / ${actualSubject}` : ''}`
                } / 差分 ${
                  deltaMinutes && deltaMinutes !== 0
                    ? `${deltaMinutes > 0 ? '+' : ''}${formatMinutes(
                        Math.abs(deltaMinutes),
                      )}`
                    : 'ぴったり'
                }`
              : '記録未入力'}
          </p>
        </div>

        <div className="row-actions actual-editor-head-actions">
          {isOpen ? (
            <button
              className="primary-button"
              onClick={() => void handleSave()}
              type="button"
            >
              記録保存
            </button>
          ) : null}
          {hidePlanActions ? null : (
            <>
              <button
                className="mini-button"
                onClick={() => onEditPlan(plan)}
                type="button"
              >
                予定編集
              </button>
              <button
                className="mini-button danger"
                onClick={() => {
                  if (
                    isScopedRecurringPlan ||
                    window.confirm('この予定を削除しますか？')
                  ) {
                    void handleDeletePlan();
                  }
                }}
                type="button"
              >
                削除
              </button>
            </>
          )}
          {hideToggleButton ? null : (
            <button
              className="mini-button"
              onClick={() => setIsOpen((current) => !current)}
              type="button"
            >
              {isOpen ? '入力を閉じる' : actual ? '記録修正' : '記録入力'}
            </button>
          )}
        </div>
      </div>

      {plan.memo ? <p className="detail-note">{plan.memo}</p> : null}

      {isOpen ? (
        <div className="actual-form actual-form-compact">
          <section className="actual-editor-section">
            <div className="actual-editor-section-title">
              <strong>記録時刻</strong>
            </div>
            <div className="actual-time-grid">
              <label className="field">
                <span>日付</span>
                <input
                  type="date"
                  value={draft.occurrenceDate}
                  onChange={(event) => {
                    setSelectedCandidatePlanId(null);
                    setDraft({
                      ...draft,
                      occurrenceDate: event.target.value,
                    });
                  }}
                />
              </label>
              <label className="field">
                <span>開始</span>
                <input
                  type="time"
                  value={draft.actualStartTime}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      actualStartTime: event.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>終了</span>
                <input
                  type="time"
                  value={draft.actualEndTime}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      actualEndTime: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="actual-editor-section">
            <div className="actual-editor-section-title">
              <strong>内容</strong>
            </div>
            <label className="field">
              <span>予定との対応</span>
              <div className="segmented-control">
                <button
                  className={draft.isAlignedToPlan ? 'segment active' : 'segment'}
                  onClick={() => setAlignedToPlan(true)}
                  type="button"
                >
                  予定通り
                </button>
                <button
                  className={!draft.isAlignedToPlan ? 'segment active' : 'segment'}
                  onClick={() => setAlignedToPlan(false)}
                  type="button"
                >
                  違う内容
                </button>
              </div>
            </label>

            {draft.isAlignedToPlan ? (
              <div className="assistant-feedback-card actual-editor-summary-card">
                <strong>予定ベースで記録します</strong>
                <p className="detail-note">
                  内容: {plan.title}
                  {plan.subject ? ` / ${plan.subject}` : ''}
                </p>
              </div>
            ) : (
              <div className="actual-content-grid">
                <label className="field">
                  <span>実際にやった内容</span>
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        title: event.target.value,
                      })
                    }
                    placeholder="例: 重要問題集 力学"
                  />
                </label>

                <label className="field">
                  <span>実際の科目</span>
                  <input
                    value={draft.subject}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        subject: event.target.value,
                      })
                    }
                    placeholder="例: 物理"
                  />
                </label>
              </div>
            )}

            <label className="field">
              <span>{draft.isAlignedToPlan ? 'メモ・気づき' : 'ズレの理由・メモ'}</span>
              <textarea
                value={draft.note}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    note: event.target.value,
                  })
                }
                rows={2}
                placeholder={
                  draft.isAlignedToPlan
                    ? 'つまずいた点や気づき'
                    : '予定との差分や実際にやったことの補足'
                }
              />
            </label>

            {paceMaterials.length > 0 ? (
              <div className="actual-progress-input-panel">
                <div className="actual-editor-section-title">
                  <strong>教材進捗</strong>
                </div>
                <div className="material-quick-progress-grid">
                  <label className="field">
                    <span>教材</span>
                    <select
                      value={progressMaterialId}
                      onChange={(event) => setProgressMaterialId(event.target.value)}
                    >
                      <option value="">記録しない</option>
                      {paceMaterials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.name}（{material.subjectName || '科目未設定'}）
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>進めた量</span>
                    <input
                      min="0"
                      step="1"
                      type="number"
                      value={deltaUnitsInput}
                      onChange={(event) => setDeltaUnitsInput(event.target.value)}
                      placeholder={
                        selectedProgressMaterial
                          ? getMaterialUnitLabel(selectedProgressMaterial)
                          : '例: 5'
                      }
                    />
                  </label>
                  <label className="field">
                    <span>到達位置</span>
                    <input
                      min="0"
                      step="1"
                      type="number"
                      value={toUnitInput}
                      onChange={(event) => setToUnitInput(event.target.value)}
                      placeholder={
                        selectedProgressMaterial
                          ? `${selectedProgressMaterial.currentUnit ?? 0}${getMaterialUnitLabel(
                              selectedProgressMaterial,
                            )}`
                          : '例: 30'
                      }
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </section>

          {isActualDateChanged ? (
            <section className="actual-editor-section standalone-link-section">
              <div className="actual-editor-section-title">
                <strong>変更後の日付の紐づけ候補</strong>
              </div>
              {linkCandidates.length > 0 ? (
                <>
                  <div className="standalone-link-candidates">
                    {linkCandidates.map((candidate, index) => {
                      const isSelected = selectedCandidatePlanId === candidate.plan.id;

                      return (
                        <article
                          className={
                            isSelected
                              ? 'standalone-link-candidate selected'
                              : 'standalone-link-candidate'
                          }
                          key={candidate.occurrenceKey}
                        >
                          <div>
                            <div className="label-row">
                              <strong>
                                {candidate.plan.startTime}-{candidate.plan.endTime} {candidate.plan.title}
                              </strong>
                              {index === 0 && candidate.score >= 70 ? (
                                <span className="type-badge">おすすめ</span>
                              ) : null}
                              {candidate.isRecorded ? (
                                <span className="type-badge">記録済み</span>
                              ) : null}
                              {isSelected ? <span className="type-badge">選択中</span> : null}
                            </div>
                            <p className="comparison-subtitle">
                              {candidate.plan.subject || '科目未設定'}
                              {candidate.reasons.length > 0
                                ? ` / ${candidate.reasons.join('・')}`
                                : ''}
                            </p>
                          </div>
                          <button
                            className="mini-button"
                            disabled={candidate.isRecorded}
                            onClick={() => setSelectedCandidatePlanId(candidate.plan.id)}
                            type="button"
                          >
                            {isSelected ? '選択中' : 'この予定に紐づける'}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  <p className="inline-note">
                    候補を選ばず保存すると、予定なし記録として保存されます。
                  </p>
                </>
              ) : (
                <p className="inline-note">
                  候補を選ばず保存すると、予定なし記録として保存されます。
                </p>
              )}
            </section>
          ) : null}

          <details className="actual-tracking-details">
            <summary>計測補助</summary>
            <ActualTrackingTools onApplyMeasuredRange={applyMeasuredRange} />
          </details>

          {error ? <p className="inline-error">{error}</p> : null}

          {actual ? (
            <div className="row-actions actual-editor-actions">
              <button
                className="ghost-button danger"
                onClick={() => {
                  if (window.confirm('この記録を削除しますか？')) {
                    void handleDeleteActual();
                  }
                }}
                type="button"
              >
                記録削除
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
