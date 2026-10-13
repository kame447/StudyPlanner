import { ActualMutationAdmissionError, materialUncertainMessage } from '../hooks/useActualMutationAdmission';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock3,
  NotebookPen,
  Pause,
  Play,
  Square,
  Settings2,
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
  createInitialTracker,
  startTracker,
  pauseTracker,
  resumeTracker,
  type TrackerState,
} from '../lib/actualTracking';
import { minutesBetween } from '../lib/date';
import {
  buildActualMaterialProgressUpdatesFromInput,
  getMaterialUnitLabel,
} from '../lib/materialPace';
import type { ActualDraft, Plan, StudyMaterial } from '../types/domain';
import { createDefaultPomodoroSettings, getPomodoroCompletedAt, getPomodoroProgress, resolvePomodoroSettings, type PomodoroSettings, type ResolvedPomodoroSettings } from '../lib/pomodoroSession';
import { StudySessionModePicker, type StudyMode } from './StudySessionModePicker';
import { PomodoroSettingsView } from './PomodoroSettingsView';

interface StudySessionProviderProps {
  userId: string;
  materials: StudyMaterial[];
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft) => Promise<void>;
}

type StudySessionLauncher = (request: StudySessionRequest) => void;
type SessionPhase = 'timer' | 'record' | 'settings';

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
  const pageRef = useRef<HTMLDivElement>(null);
  const [studyMode, setStudyMode] = useState<StudyMode>('normal');
  const [pomodoroSettings, setPomodoroSettings] = useState(createDefaultPomodoroSettings);
  const activePomodoro = useRef<ResolvedPomodoroSettings | null>(null);
  const pomodoroCompletedAt = useRef<number | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreSettingsFocus = useRef(false);
  const phaseRef = useRef<SessionPhase>('timer');
  const settingsRevision = useRef(0);
  const renderedSettingsRevision = settingsRevision.current;
  const [nowMs, setNowMs] = useState(initialNow);
  const [tracker, setTracker] = useState<TrackerState>(createInitialTracker);
  const [recordDraft, setRecordDraft] = useState<ActualDraft | null>(null);
  const [progressInput, setProgressInput] = useState('');
  const [observationProgressInput, setObservationProgressInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [requiresInspection, setRequiresInspection] = useState(false);

  const plannedMinutes = plan ? Math.max(1, minutesBetween(plan.startTime, plan.endTime)) : null;
  const plannedMs = plannedMinutes === null ? null : plannedMinutes * 60_000;
  const resolvedPomodoro = activePomodoro.current ?? resolvePomodoroSettings(pomodoroSettings, plannedMs);
  const readyConfiguration = useRef({ mode: studyMode, pomodoro: resolvedPomodoro });
  useLayoutEffect(() => {
    readyConfiguration.current = { mode: studyMode, pomodoro: resolvedPomodoro };
  }, [studyMode, resolvedPomodoro]);
  const measuredElapsedMs = getElapsedMs(tracker, nowMs);
  const pomodoroProgress = getPomodoroProgress(measuredElapsedMs, resolvedPomodoro);
  const isPomodoroComplete = studyMode === 'pomodoro' && pomodoroProgress.isComplete;
  const elapsedMs = studyMode === 'pomodoro' ? pomodoroProgress.elapsedMs : measuredElapsedMs;
  const isStarted = tracker.anchorMs !== null;
  const remainingMs = plannedMs === null ? null : Math.max(plannedMs - elapsedMs, 0);
  const normalProgressDegrees = plannedMs === null ? 0 : clampPercent((elapsedMs / plannedMs) * 100) * 3.6;
  const pomodoroIsFocus = pomodoroProgress.phase === 'focus';
  const pomodoroPhaseRemainingMs = pomodoroProgress.phaseRemainingMs;
  const totalPomodoroSets = resolvedPomodoro.totalSets;
  const currentPomodoroSet = pomodoroProgress.currentSet;
  const pomodoroPhaseLabel = isPomodoroComplete ? '完了' : pomodoroIsFocus ? '集中' : '休憩';
  const pomodoroNextLabel = pomodoroIsFocus
    ? `休憩 ${resolvedPomodoro.breakMs / 60_000}分`
    : `集中 ${resolvedPomodoro.focusMs / 60_000}分`;

  const progressDegrees = studyMode === 'pomodoro'
    ? pomodoroProgress.progressDegrees
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
  const dialogLabel = phase === 'settings' ? 'ポモドーロ設定' : phase === 'record'
    ? '学習を記録'
    : isStarted
      ? '学習中'
      : '学習を開始';

  // The pane survives timer/record navigation so entry motion is not replayed.
  // Each screen starts at its own heading; edits and timer ticks retain reader position.
  useLayoutEffect(() => {
    if (pageRef.current) pageRef.current.scrollTop = 0;
    if (phase === 'settings') headingRef.current?.focus();
    else if (restoreSettingsFocus.current) {
      restoreSettingsFocus.current = false;
      settingsButtonRef.current?.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'timer' || tracker.runningFromMs === null) return undefined;

    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [phase, tracker.runningFromMs]);

  useEffect(() => {
    if (isPomodoroComplete && tracker.runningFromMs !== null) {
      pomodoroCompletedAt.current ??= getPomodoroCompletedAt(tracker, resolvedPomodoro, nowMs);
      setTracker(current => ({ ...current, runningFromMs: null, elapsedBeforeMs: pomodoroProgress.elapsedMs }));
    }
  }, [isPomodoroComplete, tracker.runningFromMs, pomodoroProgress.elapsedMs]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  function startTimer() {
    if (started.current || phaseRef.current !== 'timer') return;
    started.current = true;
    if (readyConfiguration.current.mode === 'pomodoro') activePomodoro.current = readyConfiguration.current.pomodoro;
    const startedAt = Date.now();
    setNowMs(startedAt);
    setTracker(current => startTracker(current, startedAt));
    setError('');
  }

  function pauseTimer() {
    if (phaseRef.current !== 'timer') return;
    const pausedAt = Date.now();
    setNowMs(pausedAt);
    setTracker(current => {
      if (activePomodoro.current) pomodoroCompletedAt.current ??= getPomodoroCompletedAt(current, activePomodoro.current, pausedAt);
      const paused = pauseTracker(current, pausedAt);
      return activePomodoro.current
        ? { ...paused, elapsedBeforeMs: getPomodoroProgress(paused.elapsedBeforeMs, activePomodoro.current).elapsedMs }
        : paused;
    });
  }

  function resumeTimer() {
    if (phaseRef.current !== 'timer') return;
    const resumedAt = Date.now();
    setNowMs(resumedAt);
    setTracker(current => {
      if (activePomodoro.current && getPomodoroProgress(getElapsedMs(current, resumedAt), activePomodoro.current).isComplete) return current;
      return resumeTracker(current, resumedAt);
    });
  }

  function finishTimer() {
    if (phaseRef.current !== 'timer' || tracker.anchorMs === null) return;

    const finishedAt = Date.now();
    if (activePomodoro.current) pomodoroCompletedAt.current ??= getPomodoroCompletedAt(tracker, activePomodoro.current, finishedAt);
    const measuredMs = getElapsedMs(tracker, finishedAt);
    const finalElapsedMs = Math.max(activePomodoro.current ? getPomodoroProgress(measuredMs, activePomodoro.current).elapsedMs : measuredMs, 1000);
    const anchorMs = tracker.anchorMs;
    const storedDurationMs = Math.max(finalElapsedMs, 60_000);
    const draft = createStudySessionDraft(target, anchorMs, storedDurationMs, {
      title: unplannedTitle, subject: unplannedSubject, material,
    });
    const hasNewMeasurement = recordedElapsedMs.current !== finalElapsedMs;
    recordedElapsedMs.current = finalElapsedMs;
    if (target.kind === 'unplanned' && hasNewMeasurement) {
      setNeedsDateAdjustment(sessionCrossesLocalDate(anchorMs, storedDurationMs) || sessionCrossesLocalDate(anchorMs, (pomodoroCompletedAt.current ?? finishedAt) - anchorMs));
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
    phaseRef.current = 'record';
    setPhase('record');
    setError('');
  }

  function openSettings() {
    if (started.current || phaseRef.current !== 'timer') return;
    settingsRevision.current += 1;
    phaseRef.current = 'settings';
    setPhase('settings');
  }

  function closeSettings() {
    settingsRevision.current += 1;
    restoreSettingsFocus.current = true;
    phaseRef.current = 'timer';
    setPhase('timer');
  }

  function saveSettings(settings: PomodoroSettings) {
    if (started.current || phaseRef.current !== 'settings' || settingsRevision.current !== renderedSettingsRevision) return;
    readyConfiguration.current.pomodoro = resolvePomodoroSettings(settings, plannedMs);
    setPomodoroSettings(settings);
    closeSettings();
  }

  function handleBack() {
    if (phaseRef.current === 'settings') {
      closeSettings();
      return;
    }
    if (phase === 'record') {
      phaseRef.current = 'timer';
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
      <div className="study-session-page" data-phase={phase} ref={pageRef}>
        <header className="study-session-header">
          <button type="button" className="study-session-icon-button" onClick={handleBack} aria-label="戻る">
            <ArrowLeft size={24} aria-hidden="true" />
          </button>
          <h1 ref={headingRef} tabIndex={-1}>{dialogLabel}</h1>
          <span className="study-session-header-spacer" aria-hidden="true" />
        </header>

        {phase === 'timer' ? (
          <main className="study-session-content study-session-timer-view">
            <section className="study-session-card study-session-primary-card">
              <div className={plan ? "study-session-setup has-plan" : "study-session-setup"}>
                {isStarted ? <h2>{sessionTitle}</h2> : null}
                {initialTarget.kind === 'planned' && !isStarted ? (
                  <label className="study-session-target-choice">
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
                {plan ? <dl className="study-session-plan-meta study-session-plan-overview">
                  <div><dt><Clock3 size={16} aria-hidden="true" />予定</dt><dd>{plan.occurrenceDate ?? plan.date} {plan.startTime} - {plan.endTime} · {formatMinutesLabel(plannedMinutes ?? 0)}</dd></div>
                </dl> : null}
                {plan || (isStarted && material) ? (
                  <details className="study-session-details">
                    <summary>詳細</summary>
                    <dl>
                      {plan ? <div><dt>内容</dt><dd>{plan.title}</dd></div> : null}
                      {plan?.subject ? <div><dt>科目</dt><dd>{plan.subject}</dd></div> : null}
                      {material || plan?.materialName?.trim() ? <div><dt>教材</dt><dd>{material?.name ?? plan?.materialName}</dd></div> : null}
                      {plan?.memo.trim() ? <div><dt>メモ</dt><dd>{plan.memo}</dd></div> : null}
                    </dl>
                  </details>
                ) : null}
              </div>

              <StudySessionModePicker value={studyMode} disabled={isStarted}
                onChange={mode => {
                  if (started.current || phaseRef.current !== 'timer') return;
                  readyConfiguration.current.mode = mode;
                  setStudyMode(mode);
                }} />

              <div className="study-session-timer-ring" style={ringStyle} data-study-mode={studyMode}>
                <div className="study-session-timer-inner">
                  {studyMode === 'pomodoro' ? (
                    <>
                      <div className="study-session-phase-clock">
                        <span data-pomodoro-phase>{pomodoroPhaseLabel}</span>
                        <strong data-study-session-phase-remaining>{formatPomodoroTime(pomodoroPhaseRemainingMs)}</strong>
                      </div>
                      <b>{currentPomodoroSet}{totalPomodoroSets === null ? '' : ` / ${totalPomodoroSets}`} セット{isPomodoroComplete ? ' 完了' : ` ・ 次は ${pomodoroNextLabel}`}</b>
                    </>
                  ) : (
                    <>
                      {isStarted ? <span>経過時間</span> : null}
                      <strong data-study-session-elapsed aria-label="経過時間">{formatDurationDisplay(elapsedMs)}</strong>
                      {plannedMs !== null && isStarted ? <b>残り {formatDurationDisplay(remainingMs ?? 0)}</b> : null}
                    </>
                  )}
                </div>
              </div>

              {studyMode === 'pomodoro' ? (
                <div className="study-session-pomodoro-status">
                  {!isStarted ? (
                    <button ref={settingsButtonRef} type="button" className="study-session-settings-button" onClick={openSettings} aria-label="集中と休憩の設定">
                      <Settings2 size={17} aria-hidden="true" />
                      {resolvedPomodoro.focusMs / 60_000}分 / {resolvedPomodoro.breakMs / 60_000}分 ・ {totalPomodoroSets === null ? '制限なし' : `${totalPomodoroSets}セット${pomodoroSettings.setCount === null ? '（目安）' : ''}`}
                    </button>
                  ) : isPomodoroComplete ? <strong role="status">全セット完了</strong> : <div className="study-session-pomodoro-flow" aria-label="ポモドーロの進行">
                    <span className={pomodoroIsFocus ? 'active' : ''}>集中</span>
                    <i aria-hidden="true">→</i>
                    <span className={!pomodoroIsFocus ? 'active' : ''}>休憩</span>
                    <i aria-hidden="true">→</i>
                    <span>集中</span>
                  </div>}
                  <small>休憩を含めて記録</small>
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
                    disabled={isPomodoroComplete}
                    onClick={tracker.runningFromMs === null ? resumeTimer : pauseTimer}
                  >
                    {tracker.runningFromMs === null ? <Play size={22} aria-hidden="true" /> : <Pause size={22} aria-hidden="true" />}
                    {isPomodoroComplete ? '完了' : tracker.runningFromMs === null ? '再開' : '一時停止'}
                  </button>
                  <button type="button" className="study-session-control danger" onClick={finishTimer}>
                    <Square size={19} aria-hidden="true" />終了する
                  </button>
                </div>
              )}
            </section>
          </main>
        ) : phase === 'settings' ? (
          <PomodoroSettingsView initialSettings={pomodoroSettings} planned={plannedMs !== null} onSave={saveSettings} />
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
                <div className="study-session-aligned-card"><strong>{plan.title}</strong>{plan.subject ? <span>{plan.subject}</span> : null}</div>
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
                  ) : null}
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
