import { ActualMutationAdmissionError, materialUncertainMessage } from '../hooks/useActualMutationAdmission';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileText,
  NotebookPen,
  Pause,
  Play,
  Square,
  TimerReset,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
} from 'react';
import { createStudySessionDraft, sessionCrossesLocalDate, type StudySessionRequest, type StudySessionTarget } from '../lib/studySessionTarget';
import {
  formatDurationDisplay,
  getElapsedMs,
  type TrackerState,
} from '../lib/actualTracking';
import { minutesBetween } from '../lib/date';
import {
  buildActualMaterialProgressUpdatesFromInput,
  getMaterialUnitLabel,
} from '../lib/materialPace';
import type { ActualDraft, Plan, StudyMaterial } from '../types/domain';

interface StudySessionProviderProps {
  userId: string;
  materials: StudyMaterial[];
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft) => Promise<void>;
}

type StudySessionLauncher = (request: StudySessionRequest) => void;
type SessionPhase = 'timer' | 'record';
type StudyMode = 'normal' | 'pomodoro';

const POMODORO_FOCUS_MS = 25 * 60_000;
const POMODORO_BREAK_MS = 5 * 60_000;
const POMODORO_CYCLE_MS = POMODORO_FOCUS_MS + POMODORO_BREAK_MS;

const StudySessionLaunchContext = createContext<StudySessionLauncher | null>(null);

export function useStudySessionLauncher(): StudySessionLauncher | null {
  return useContext(StudySessionLaunchContext);
}

export function StudySessionProvider(props: PropsWithChildren<StudySessionProviderProps>) {
  return <OwnedStudySessionProvider key={props.userId} {...props} />;
}

function OwnedStudySessionProvider({
  children,
  userId,
  materials,
  onSaveActual,
  onSaveStandaloneActual,
}: PropsWithChildren<StudySessionProviderProps>) {
  const nextSessionId = useRef(0);
  const mounted = useRef(true);
  type ActiveSession = { id: number; target: StudySessionTarget };
  const currentSession = useRef<ActiveSession | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function closeSession(session: ActiveSession) {
    if (!mounted.current || currentSession.current !== session) return;
    currentSession.current = null;
    setActiveSession(null);
  }

  function launch(request: StudySessionRequest) {
    if (!mounted.current || currentSession.current || !userId) return;
    if (request.kind === 'planned' && request.plan.userId !== userId) return;
    const target: StudySessionTarget = request.kind === 'planned'
      ? request : { kind: 'unplanned', userId };
    const session = { id: ++nextSessionId.current, target };
    currentSession.current = session;
    setActiveSession(session);
  }

  return (
    <StudySessionLaunchContext.Provider value={launch}>
      {children}
      {activeSession ? (
        <StudySessionView
          key={activeSession.id}
          initialTarget={activeSession.target}
          userId={userId}
          materials={materials.filter(material => material.userId === userId)}
          onClose={() => closeSession(activeSession)}
          onSaveActual={async (target, draft) => {
            if (!mounted.current || currentSession.current !== activeSession || draft.userId !== userId) {
              throw new ActualMutationAdmissionError('学習画面を開き直してください。');
            }
            if (target.kind === 'planned') await onSaveActual(target.plan, draft);
            else await onSaveStandaloneActual(draft);
            closeSession(activeSession);
          }}
        />
      ) : null}
    </StudySessionLaunchContext.Provider>
  );
}

function formatMinutesLabel(totalMinutes: number): string {
  const normalized = Math.max(0, Math.round(totalMinutes));
  if (normalized < 60) return `${normalized}分`;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
}

function formatPomodoroTime(totalMs: number): string {
  const safeSeconds = Math.max(0, Math.ceil(totalMs / 1000));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function resolveMaterial(plan: Plan, materials: StudyMaterial[]): StudyMaterial | null {
  if (plan.materialId) {
    const byId = materials.find((material) => material.id === plan.materialId);
    if (byId) return byId;
  }

  const materialName = plan.materialName?.trim();
  if (!materialName) return null;
  return materials.find((material) => material.name === materialName) ?? null;
}

function buildInitialTracker(): TrackerState {
  return {
    anchorMs: null,
    runningFromMs: null,
    elapsedBeforeMs: 0,
  };
}

function StudySessionView({
  initialTarget,
  userId,
  materials,
  onClose,
  onSaveActual,
}: {
  initialTarget: StudySessionTarget;
  userId: string;
  materials: StudyMaterial[];
  onClose: () => void;
  onSaveActual: (target: StudySessionTarget, draft: ActualDraft) => Promise<void>;
}) {
  const initialNow = useMemo(() => Date.now(), []);
  const [target, setTarget] = useState(initialTarget);
  const plan = target.kind === 'planned' ? target.plan : null;
  const [unplannedTitle, setUnplannedTitle] = useState('');
  const [unplannedSubject, setUnplannedSubject] = useState('');
  const [unplannedMaterialId, setUnplannedMaterialId] = useState('');
  const [needsDateAdjustment, setNeedsDateAdjustment] = useState(false);
  const started = useRef(false);
  const savePending = useRef(false);
  const saveBlocked = useRef(false);
  const recordedElapsedMs = useRef<number | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('timer');
  const [studyMode, setStudyMode] = useState<StudyMode>('normal');
  const [nowMs, setNowMs] = useState(initialNow);
  const [tracker, setTracker] = useState<TrackerState>(buildInitialTracker);
  const [recordDraft, setRecordDraft] = useState<ActualDraft | null>(null);
  const [progressInput, setProgressInput] = useState('');
  const [observationProgressInput, setObservationProgressInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [requiresInspection, setRequiresInspection] = useState(false);

  const plannedMinutes = plan ? Math.max(1, minutesBetween(plan.startTime, plan.endTime)) : null;
  const plannedMs = plannedMinutes === null ? null : plannedMinutes * 60_000;
  const elapsedMs = getElapsedMs(tracker, nowMs);
  const isStarted = tracker.anchorMs !== null;
  const remainingMs = plannedMs === null ? null : Math.max(plannedMs - elapsedMs, 0);
  const normalProgressDegrees = plannedMs === null ? 0 : clampPercent((elapsedMs / plannedMs) * 100) * 3.6;

  const pomodoroElapsedInCycle = elapsedMs % POMODORO_CYCLE_MS;
  const pomodoroIsFocus = pomodoroElapsedInCycle < POMODORO_FOCUS_MS;
  const pomodoroPhaseElapsedMs = pomodoroIsFocus
    ? pomodoroElapsedInCycle
    : pomodoroElapsedInCycle - POMODORO_FOCUS_MS;
  const pomodoroPhaseDurationMs = pomodoroIsFocus
    ? POMODORO_FOCUS_MS
    : POMODORO_BREAK_MS;
  const pomodoroPhaseRemainingMs = Math.max(
    pomodoroPhaseDurationMs - pomodoroPhaseElapsedMs,
    0,
  );
  const pomodoroProgressDegrees =
    clampPercent((pomodoroPhaseElapsedMs / pomodoroPhaseDurationMs) * 100) * 3.6;
  const totalPomodoroSets = plannedMs === null ? null : Math.max(1, Math.ceil(plannedMs / POMODORO_CYCLE_MS));
  const currentPomodoroSet = Math.min(
    totalPomodoroSets ?? Number.POSITIVE_INFINITY,
    Math.floor(elapsedMs / POMODORO_CYCLE_MS) + 1,
  );
  const pomodoroPhaseLabel = pomodoroIsFocus ? '集中' : '休憩';
  const pomodoroNextLabel = pomodoroIsFocus ? '休憩 5分' : '集中 25分';

  const progressDegrees = studyMode === 'pomodoro'
    ? pomodoroProgressDegrees
    : normalProgressDegrees;
  const material = plan ? resolveMaterial(plan, materials) : materials.find(item => item.id === unplannedMaterialId) ?? null;
  const sessionTitle = plan?.title ?? (unplannedTitle.trim() || '学習');
  const materialUnitLabel = material ? getMaterialUnitLabel(material) : '単位';
  const numericProgress = Number(progressInput);
  const validProgressDelta =
    progressInput.trim() !== '' && Number.isFinite(numericProgress) && numericProgress > 0
      ? numericProgress
      : 0;
  const previewCurrentUnit = material?.currentUnit ?? 0;
  const previewNextUnit = material
    ? Math.min(
        material.totalUnits ?? Number.POSITIVE_INFINITY,
        previewCurrentUnit + validProgressDelta,
      )
    : previewCurrentUnit;
  const previewCurrentPercent =
    material?.totalUnits && material.totalUnits > 0
      ? clampPercent((previewCurrentUnit / material.totalUnits) * 100)
      : null;
  const previewNextPercent =
    material?.totalUnits && material.totalUnits > 0
      ? clampPercent((previewNextUnit / material.totalUnits) * 100)
      : null;
  const ringStyle = {
    '--study-session-progress': `${progressDegrees}deg`,
  } as CSSProperties;
  const dialogLabel = phase === 'record'
    ? '学習を記録'
    : isStarted
      ? '学習中'
      : '学習を開始';

  useEffect(() => {
    if (phase !== 'timer' || tracker.runningFromMs === null) return undefined;

    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [phase, tracker.runningFromMs]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  function startTimer() {
    if (started.current) return;
    started.current = true;
    const startedAt = Date.now();
    setNowMs(startedAt);
    setTracker({
      anchorMs: startedAt,
      runningFromMs: startedAt,
      elapsedBeforeMs: 0,
    });
    setError('');
  }

  function pauseTimer() {
    const pausedAt = Date.now();
    setNowMs(pausedAt);
    setTracker((current) => ({
      ...current,
      runningFromMs: null,
      elapsedBeforeMs: getElapsedMs(current, pausedAt),
    }));
  }

  function resumeTimer() {
    const resumedAt = Date.now();
    setNowMs(resumedAt);
    setTracker((current) => ({
      ...current,
      anchorMs: current.anchorMs ?? resumedAt,
      runningFromMs: resumedAt,
    }));
  }

  function finishTimer() {
    if (tracker.anchorMs === null) return;

    const finishedAt = Date.now();
    const finalElapsedMs = Math.max(getElapsedMs(tracker, finishedAt), 1000);
    const anchorMs = tracker.anchorMs;
    const storedDurationMs = Math.max(finalElapsedMs, 60_000);
    const draft = createStudySessionDraft(target, anchorMs, storedDurationMs, {
      title: unplannedTitle, subject: unplannedSubject, material,
    });
    const hasNewMeasurement = recordedElapsedMs.current !== finalElapsedMs;
    recordedElapsedMs.current = finalElapsedMs;
    if (target.kind === 'unplanned' && hasNewMeasurement) {
      setNeedsDateAdjustment(sessionCrossesLocalDate(anchorMs, storedDurationMs) || sessionCrossesLocalDate(anchorMs, finishedAt - anchorMs));
    }

    setNowMs(finishedAt);
    setTracker((current) => ({
      ...current,
      runningFromMs: null,
      elapsedBeforeMs: finalElapsedMs,
    }));
    // A paused round trip preserves all edits; only resumed measurement replaces the range.
    setRecordDraft(current => {
      if (!current) return draft;
      return hasNewMeasurement
        ? { ...current, actualStartTime: draft.actualStartTime, actualEndTime: draft.actualEndTime }
        : current;
    });
    setPhase('record');
    setError('');
  }

  function handleBack() {
    if (phase === 'record') {
      setPhase('timer');
      setError('');
      return;
    }

    if (
      elapsedMs > 0 &&
      !window.confirm('学習セッションを終了してホームに戻りますか？ 計測内容は保存されません。')
    ) {
      return;
    }

    onClose();
  }

  async function saveRecord() {
    if (!recordDraft || savePending.current || saveBlocked.current) return;
    if (needsDateAdjustment) {
      setError('日付をまたいだ計測です。開始日の記録時刻を調整してください。翌日分は別の記録が必要です。');
      return;
    }
    const recordMinutes = minutesBetween(recordDraft.actualStartTime, recordDraft.actualEndTime);
    if (!Number.isFinite(recordMinutes) || recordMinutes <= 0) {
      setError('記録の終了時刻は開始時刻より後にしてください。');
      return;
    }
    if (!recordDraft.isAlignedToPlan && !recordDraft.title.trim()) {
      setError('実際にやった内容を入力してください。');
      return;
    }

    const observationSource = plan?.weeklyPlanningObservationSource;
    const observationProgress = Number(observationProgressInput);
    if (observationSource) {
      if (observationProgressInput.trim() === '') {
        setError(`この計測で進んだ${observationSource.unitLabel}数を入力してください。`);
        return;
      }
      if (
        !Number.isFinite(observationProgress) ||
        observationProgress < 0 ||
        observationProgress > observationSource.targetAmount
      ) {
        setError(`進んだ量は0〜${observationSource.targetAmount}${observationSource.unitLabel}で入力してください。`);
        return;
      }
    }

    const materialProgressUpdates = buildActualMaterialProgressUpdatesFromInput({
      materials,
      materialId: recordDraft.materialId,
      deltaUnitsInput: progressInput,
    });
    const weeklyPlanningObservationResult = observationSource
      ? {
          version: 1 as const,
          kind: 'memory_pace_calibration' as const,
          progressAmount: observationProgress,
          unitCode: observationSource.unitCode,
          unitLabel: observationSource.unitLabel,
        }
      : undefined;

    savePending.current = true;
    setSaving(true);
    setError('');
    try {
      await onSaveActual(target, {
        ...recordDraft,
        materialProgressUpdates,
        weeklyPlanningObservationResult,
      });
    } catch (error) {
      savePending.current = false;
      setSaving(false);
      const uncertain = !(error instanceof ActualMutationAdmissionError);
      saveBlocked.current = uncertain;
      setRequiresInspection(uncertain);
      setError(`${error instanceof Error ? error.message : '記録の保存に失敗しました。'}${uncertain ? ` ${materialUncertainMessage}` : ''}`);
    }
  }

  return (
    <div
      className="study-session-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
    >
      <div className="study-session-page">
        <header className="study-session-header">
          <button type="button" className="study-session-icon-button" onClick={handleBack} aria-label="戻る">
            <ArrowLeft size={24} aria-hidden="true" />
          </button>
          <h1>{dialogLabel}</h1>
          <span className="study-session-header-spacer" aria-hidden="true" />
        </header>

        {phase === 'timer' ? (
          <main className="study-session-content study-session-timer-view">
            <section className="study-session-card study-session-primary-card">
              <div className="study-session-eyebrow"><BookOpen size={18} aria-hidden="true" />現在の学習対象</div>
              <h2>{sessionTitle}</h2>
              {initialTarget.kind === 'planned' && !isStarted ? (
                <label className="study-session-target-choice">学習内容
                  <select aria-label="学習内容" value={target.kind} onChange={event => { if (!started.current) setTarget(event.target.value === 'planned' ? initialTarget : { kind: 'unplanned', userId }); }}>
                    <option value="planned">この予定で学習: {initialTarget.plan.title}</option>
                    <option value="unplanned">予定にない学習</option>
                  </select>
                </label>
              ) : null}
              {!plan && !isStarted ? (
                <div className="study-session-field-grid study-session-unplanned-setup">
                  <label>勉強する内容<input aria-label="勉強する内容" value={unplannedTitle} placeholder="学習" onChange={event => setUnplannedTitle(event.target.value)} /></label>
                  <label>教材<select aria-label="教材" value={unplannedMaterialId} onChange={event => {
                    const selected = materials.find(item => item.id === event.target.value);
                    setUnplannedMaterialId(selected?.id ?? '');
                    setUnplannedSubject(selected?.subjectName ?? '');
                    setUnplannedTitle(current => !current || current === material?.name ? selected?.name ?? '' : current);
                  }}>
                    <option value="">教材なし</option>
                    {materials.filter(item => item.status !== 'archived').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select></label>
                </div>
              ) : null}
              {plan ? <dl className="study-session-plan-meta">
                <div><dt><Clock3 size={18} aria-hidden="true" />予定</dt><dd>{plan.occurrenceDate ?? plan.date} {plan.startTime} - {plan.endTime}</dd></div>
                <div><dt><TimerReset size={18} aria-hidden="true" />予定時間</dt><dd>{formatMinutesLabel(plannedMinutes ?? 0)}</dd></div>
                <div><dt><FileText size={18} aria-hidden="true" />内容</dt><dd>{plan.memo.trim() || plan.subject || plan.title}</dd></div>
              </dl> : null}

              <div className="study-session-mode-section">
                <span className="study-session-mode-label">学習方式</span>
                <div className="study-session-mode-picker" role="group" aria-label="学習方式">
                  <button
                    type="button"
                    className={studyMode === 'normal' ? 'active' : ''}
                    aria-pressed={studyMode === 'normal'}
                    disabled={isStarted}
                    onClick={() => setStudyMode('normal')}
                  >
                    <strong>通常タイマー</strong>
                    <small>{plan ? '予定時間を通して計測' : '時間を決めずに計測'}</small>
                  </button>
                  <button
                    type="button"
                    className={studyMode === 'pomodoro' ? 'active' : ''}
                    aria-pressed={studyMode === 'pomodoro'}
                    disabled={isStarted}
                    onClick={() => setStudyMode('pomodoro')}
                  >
                    <strong>ポモドーロ</strong>
                    <small>集中25分 + 休憩5分</small>
                  </button>
                </div>
              </div>

              <div className="study-session-timer-ring" style={ringStyle} data-study-mode={studyMode}>
                <div className="study-session-timer-inner">
                  {studyMode === 'pomodoro' ? (
                    <>
                      <span data-pomodoro-phase>{pomodoroPhaseLabel}</span>
                      <strong data-study-session-phase-remaining>{formatPomodoroTime(pomodoroPhaseRemainingMs)}</strong>
                      <b>{currentPomodoroSet}{totalPomodoroSets === null ? '' : ` / ${totalPomodoroSets}`} セット ・ 次は {pomodoroNextLabel}</b>
                    </>
                  ) : (
                    <>
                      <span>{isStarted ? '経過時間' : '開始前'}</span>
                      <strong data-study-session-elapsed>{formatDurationDisplay(elapsedMs)}</strong>
                      <b>{plannedMs === null ? '予定にない学習' : isStarted ? `残り ${formatDurationDisplay(remainingMs ?? 0)}` : `予定 ${formatMinutesLabel(plannedMinutes ?? 0)}`}</b>
                    </>
                  )}
                </div>
              </div>

              {studyMode === 'pomodoro' ? (
                <div className="study-session-pomodoro-status">
                  <div className="study-session-pomodoro-flow" aria-label="ポモドーロの進行">
                    <span className={pomodoroIsFocus ? 'active' : ''}>集中</span>
                    <i aria-hidden="true">→</i>
                    <span className={!pomodoroIsFocus ? 'active' : ''}>休憩</span>
                    <i aria-hidden="true">→</i>
                    <span>集中</span>
                  </div>
                  <small>現段階では休憩もセッションの総学習時間に含めて記録します。</small>
                  {isStarted ? <span className="study-session-total-elapsed">総経過 {formatDurationDisplay(elapsedMs)}</span> : null}
                </div>
              ) : null}

              {!isStarted ? (
                <button type="button" className="study-session-control primary study-session-start-button" onClick={startTimer}>
                  <Play size={22} aria-hidden="true" />スタート
                </button>
              ) : (
                <div className="study-session-controls">
                  <button
                    type="button"
                    className="study-session-control primary"
                    onClick={tracker.runningFromMs === null ? resumeTimer : pauseTimer}
                  >
                    {tracker.runningFromMs === null ? <Play size={22} aria-hidden="true" /> : <Pause size={22} aria-hidden="true" />}
                    {tracker.runningFromMs === null ? '再開' : '一時停止'}
                  </button>
                  <button type="button" className="study-session-control danger" onClick={finishTimer}>
                    <Square size={19} aria-hidden="true" />終了する
                  </button>
                </div>
              )}
            </section>

            <section className="study-session-card study-session-context-card">
              <div className="study-session-context-row">
                <span className="study-session-context-icon material"><BookOpen size={21} aria-hidden="true" /></span>
                <span><small>教材</small><strong>{material?.name ?? (plan?.materialName?.trim() || '教材未設定')}</strong></span>
              </div>
              <div className="study-session-context-row">
                <span className="study-session-context-icon"><NotebookPen size={21} aria-hidden="true" /></span>
                <span><small>現在のメモ</small><strong>{plan?.memo.trim() || 'メモはありません'}</strong></span>
              </div>
            </section>
            <p className="study-session-helper">
              {isStarted ? '終了後にそのまま記録画面へ進みます' : 'スタートを押すまで計測されません'}
            </p>
          </main>
        ) : recordDraft ? (
          <main className="study-session-content study-session-record-view">
            <section className="study-session-card study-session-record-summary">
              <div className="study-session-eyebrow"><BookOpen size={18} aria-hidden="true" />現在の学習対象</div>
              <h2>{sessionTitle}</h2>
              {plan ? <dl className="study-session-plan-meta compact">
                <div><dt><Clock3 size={18} aria-hidden="true" />予定</dt><dd>{plan.occurrenceDate ?? plan.date} {plan.startTime} - {plan.endTime}</dd></div>
                <div><dt><TimerReset size={18} aria-hidden="true" />予定時間</dt><dd>{formatMinutesLabel(plannedMinutes ?? 0)}</dd></div>
              </dl> : <p>予定にない学習 · {recordDraft.occurrenceDate}</p>}
              <div className="study-session-actual-time">
                <span>{plan ? '実際の学習時間' : '計測した時間'}</span>
                <strong>{formatMinutesLabel(Math.max(1, Math.round(elapsedMs / 60_000)))}</strong>
              </div>
              {needsDateAdjustment ? <p role="alert" className="study-session-error">日付をまたいだ計測です。開始日の記録時刻を調整してください。翌日分は別の記録が必要です。</p> : null}
              <details className="study-session-time-adjust" open={needsDateAdjustment || undefined}>
                <summary>記録時刻を調整</summary>
                <div>
                  <label>開始<input type="time" value={recordDraft.actualStartTime} onChange={(event) => { setRecordDraft({ ...recordDraft, actualStartTime: event.target.value }); setNeedsDateAdjustment(false); setError(''); }} /></label>
                  <label>終了<input type="time" value={recordDraft.actualEndTime} onChange={(event) => { setRecordDraft({ ...recordDraft, actualEndTime: event.target.value }); setNeedsDateAdjustment(false); setError(''); }} /></label>
                </div>
              </details>
            </section>

            <section className="study-session-card study-session-record-card">
              <h3>{plan ? '予定との対応' : '学習内容'}</h3>
              {plan ? <div className="study-session-segments">
                <button type="button" className={recordDraft.isAlignedToPlan ? 'active' : ''} onClick={() => setRecordDraft({ ...recordDraft, isAlignedToPlan: true, title: plan.title, subject: plan.subject, materialId: plan.materialId ?? null, materialName: plan.materialName ?? '' })}>
                  予定通り <CheckCircle2 size={18} aria-hidden="true" />
                </button>
                <button type="button" className={!recordDraft.isAlignedToPlan ? 'active' : ''} onClick={() => setRecordDraft({ ...recordDraft, isAlignedToPlan: false })}>違う内容</button>
              </div> : null}

              {plan && recordDraft.isAlignedToPlan ? (
                <div className="study-session-aligned-card"><strong>予定ベースで記録します</strong><span>内容: {plan.title}{plan.subject ? ` / ${plan.subject}` : ''}</span></div>
              ) : (
                <div className="study-session-field-grid">
                  <label>実際にやった内容<input value={recordDraft.title} onChange={(event) => setRecordDraft({ ...recordDraft, title: event.target.value })} /></label>
                  <label>実際の科目<input value={recordDraft.subject} onChange={(event) => setRecordDraft({ ...recordDraft, subject: event.target.value })} /></label>
                </div>
              )}
            </section>

            <section className="study-session-card study-session-record-detail-card">
              <div className="study-session-record-row">
                <span className="study-session-context-icon material"><BookOpen size={21} aria-hidden="true" /></span>
                <span><small>教材</small><strong>{material?.name ?? (recordDraft.materialName?.trim() || '教材未設定')}</strong></span>
              </div>

              {material?.paceEnabled ? (
                <div className="study-session-progress-editor">
                  <label htmlFor="study-session-progress">進捗</label>
                  <div className="study-session-progress-input-row">
                    <span>+</span>
                    <input
                      id="study-session-progress"
                      data-study-progress-input
                      type="number"
                      min="0"
                      step="any"
                      value={progressInput}
                      onChange={(event) => setProgressInput(event.target.value)}
                      placeholder="0"
                    />
                    <span>{materialUnitLabel}</span>
                  </div>
                  {previewCurrentPercent !== null && previewNextPercent !== null ? (
                    <small>進捗を {Math.round(previewCurrentPercent)}% → {Math.round(previewNextPercent)}% に更新</small>
                  ) : (
                    <small>今回進んだ量を教材の進捗へ反映できます。</small>
                  )}
                </div>
              ) : null}

              {plan?.weeklyPlanningObservationSource ? (
                <div className="study-session-progress-editor">
                  <label htmlFor="study-session-observation-progress">
                    今回進んだ量（{plan.weeklyPlanningObservationSource.unitLabel}）
                  </label>
                  <div className="study-session-progress-input-row">
                    <input
                      id="study-session-observation-progress"
                      type="number"
                      min="0"
                      max={plan.weeklyPlanningObservationSource.targetAmount}
                      step="any"
                      value={observationProgressInput}
                      onChange={(event) => setObservationProgressInput(event.target.value)}
                      placeholder="0"
                    />
                    <span>{plan.weeklyPlanningObservationSource.unitLabel}</span>
                  </div>
                  <small>この1回で進んだ量を次回以降の計画調整に使います。</small>
                </div>
              ) : null}

              <label className="study-session-note-field">
                <span><NotebookPen size={19} aria-hidden="true" />メモ・気づき</span>
                <textarea
                  rows={3}
                  value={recordDraft.note}
                  onChange={(event) => setRecordDraft({ ...recordDraft, note: event.target.value })}
                  placeholder="つまずいた点や気づき"
                />
              </label>
            </section>

            {error || requiresInspection ? <p className="study-session-error" role="alert">{error || materialUncertainMessage}</p> : null}
            <button type="button" className="study-session-save-button" onClick={() => void saveRecord()} disabled={saving || requiresInspection}>
              {saving ? '保存中...' : '記録を保存'}
            </button>
          </main>
        ) : null}
      </div>
    </div>
  );
}
