import { useEffect, useMemo, useState } from 'react';

type TrackingMode = 'stopwatch' | 'timer';

interface TrackerState {
  anchorMs: number | null;
  runningFromMs: number | null;
  elapsedBeforeMs: number;
}

interface ActualTrackingToolsProps {
  onApplyMeasuredRange: (startTime: string, endTime: string) => void;
  canApplyMeasuredRange?: boolean;
  applyDisabledReason?: string;
  onDisplayChange?: (display: string) => void;
}

function formatClockTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatDurationDisplay(totalMs: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(safeSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((safeSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function getElapsedMs(tracker: TrackerState, nowMs: number): number {
  return tracker.elapsedBeforeMs + (tracker.runningFromMs ? nowMs - tracker.runningFromMs : 0);
}

function clampTimerMinutes(value: number): number {
  if (Number.isNaN(value)) {
    return 30;
  }

  return Math.min(Math.max(Math.round(value), 1), 1439);
}

function formatTimerInputValue(totalMinutes: number): string {
  const clampedMinutes = clampTimerMinutes(totalMinutes);
  const hours = Math.floor(clampedMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (clampedMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimerInputValue(value: string, fallbackMinutes: number): number {
  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return clampTimerMinutes(fallbackMinutes);
  }

  return clampTimerMinutes(hours * 60 + minutes);
}

function buildMeasuredRange(anchorMs: number, durationMs: number) {
  const startAt = new Date(anchorMs);
  const endAt = new Date(anchorMs + durationMs);

  return {
    startTime: formatClockTime(startAt),
    endTime: formatClockTime(endAt),
  };
}

export function ActualTrackingTools({
  onApplyMeasuredRange,
  canApplyMeasuredRange = true,
  applyDisabledReason = '',
  onDisplayChange,
}: ActualTrackingToolsProps) {
  const [mode, setMode] = useState<TrackingMode>('stopwatch');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stopwatch, setStopwatch] = useState<TrackerState>({
    anchorMs: null,
    runningFromMs: null,
    elapsedBeforeMs: 0,
  });
  const [timer, setTimer] = useState<TrackerState>({
    anchorMs: null,
    runningFromMs: null,
    elapsedBeforeMs: 0,
  });
  const [timerMinutes, setTimerMinutes] = useState(30);

  const stopwatchElapsedMs = useMemo(
    () => getElapsedMs(stopwatch, nowMs),
    [nowMs, stopwatch],
  );
  const timerTargetMs = timerMinutes * 60 * 1000;
  const timerElapsedMs = useMemo(() => getElapsedMs(timer, nowMs), [nowMs, timer]);
  const timerRemainingMs = Math.max(timerTargetMs - timerElapsedMs, 0);
  const isTimerLocked =
    timer.anchorMs !== null || timer.runningFromMs !== null || timer.elapsedBeforeMs > 0;

  useEffect(() => {
    onDisplayChange?.(
      mode === 'stopwatch'
        ? formatDurationDisplay(stopwatchElapsedMs)
        : formatDurationDisplay(timerRemainingMs),
    );
  }, [mode, onDisplayChange, stopwatchElapsedMs, timerRemainingMs]);

  useEffect(() => {
    if (!stopwatch.runningFromMs && !timer.runningFromMs) {
      return;
    }

    const timerId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [stopwatch.runningFromMs, timer.runningFromMs]);

  useEffect(() => {
    if (!timer.runningFromMs || timerElapsedMs < timerTargetMs) {
      return;
    }

    setTimer((current) => ({
      ...current,
      runningFromMs: null,
      elapsedBeforeMs: timerTargetMs,
    }));
  }, [timer.runningFromMs, timerElapsedMs, timerTargetMs]);

  function startStopwatch() {
    const startAt = Date.now();

    setNowMs(startAt);
    setStopwatch((current) => ({
      anchorMs: current.anchorMs ?? startAt,
      runningFromMs: startAt,
      elapsedBeforeMs: current.elapsedBeforeMs,
    }));
  }

  function pauseStopwatch() {
    const pausedAt = Date.now();

    setNowMs(pausedAt);
    setStopwatch((current) => ({
      ...current,
      runningFromMs: null,
      elapsedBeforeMs: getElapsedMs(current, pausedAt),
    }));
  }

  function resetStopwatch() {
    setStopwatch({
      anchorMs: null,
      runningFromMs: null,
      elapsedBeforeMs: 0,
    });
    setNowMs(Date.now());
  }

  function applyStopwatchRange() {
    if (!stopwatch.anchorMs || stopwatchElapsedMs <= 0) {
      return;
    }

    const measuredRange = buildMeasuredRange(stopwatch.anchorMs, stopwatchElapsedMs);
    onApplyMeasuredRange(measuredRange.startTime, measuredRange.endTime);
  }

  function startTimer() {
    const startAt = Date.now();

    setNowMs(startAt);
    setTimer((current) => ({
      anchorMs: current.anchorMs ?? startAt,
      runningFromMs: startAt,
      elapsedBeforeMs: current.elapsedBeforeMs,
    }));
  }

  function pauseTimer() {
    const pausedAt = Date.now();

    setNowMs(pausedAt);
    setTimer((current) => ({
      ...current,
      runningFromMs: null,
      elapsedBeforeMs: Math.min(getElapsedMs(current, pausedAt), timerTargetMs),
    }));
  }

  function resetTimer(nextMinutes = timerMinutes) {
    setTimer({
      anchorMs: null,
      runningFromMs: null,
      elapsedBeforeMs: 0,
    });
    setTimerMinutes(nextMinutes);
    setNowMs(Date.now());
  }

  function applyTimerRange() {
    if (!timer.anchorMs || timerElapsedMs <= 0) {
      return;
    }

    const appliedDurationMs = Math.min(timerElapsedMs, timerTargetMs);
    const measuredRange = buildMeasuredRange(timer.anchorMs, appliedDurationMs);
    onApplyMeasuredRange(measuredRange.startTime, measuredRange.endTime);
  }

  return (
    <section className="assistant-settings-card tracking-tools-card">
      <div className="section-header">
        <div>
          <h2>計測補助</h2>
          <p>学習中にストップウォッチやタイマーを使って、そのまま記録時刻へ反映できます。</p>
        </div>
      </div>

      <div className="segmented-control">
        <button
          className={mode === 'stopwatch' ? 'segment active' : 'segment'}
          onClick={() => setMode('stopwatch')}
          type="button"
        >
          ストップウォッチ
        </button>
        <button
          className={mode === 'timer' ? 'segment active' : 'segment'}
          onClick={() => setMode('timer')}
          type="button"
        >
          タイマー
        </button>
      </div>

      {mode === 'stopwatch' ? (
        <div className="section-stack">
          <div className="tracking-display">{formatDurationDisplay(stopwatchElapsedMs)}</div>
          <p className="detail-note">
            開始からの経過時間を測ります。反映すると、開始時刻と終了時刻を記録入力へセットします。
          </p>
          <div className="row-actions">
            <button
              className="ghost-button"
              onClick={stopwatch.runningFromMs ? pauseStopwatch : startStopwatch}
              type="button"
            >
              {stopwatch.runningFromMs ? '一時停止' : '開始'}
            </button>
            <button className="ghost-button" onClick={resetStopwatch} type="button">
              リセット
            </button>
            <button
              className="mini-button"
              onClick={applyStopwatchRange}
              type="button"
              disabled={
                !canApplyMeasuredRange || !stopwatch.anchorMs || stopwatchElapsedMs <= 0
              }
              title={!canApplyMeasuredRange ? applyDisabledReason : undefined}
            >
              記録時刻へ反映
            </button>
          </div>
        </div>
      ) : (
        <div className="section-stack">
          <div className="tracking-timer-row">
            <label className="field">
              <span>タイマー時間</span>
              <input
                step={60}
                type="time"
                value={formatTimerInputValue(timerMinutes)}
                disabled={isTimerLocked}
                onChange={(event) => {
                  const nextMinutes = parseTimerInputValue(
                    event.target.value,
                    timerMinutes,
                  );
                  setTimerMinutes(nextMinutes);
                }}
              />
            </label>
          </div>

          <div className="tracking-display">{formatDurationDisplay(timerRemainingMs)}</div>
          <p className="detail-note">
            カウントダウンします。反映すると、開始から実際に進んだ分だけを記録時刻へ入れます。
          </p>

          <div className="row-actions">
            <button
              className="ghost-button"
              onClick={timer.runningFromMs ? pauseTimer : startTimer}
              type="button"
              disabled={timerRemainingMs <= 0 && !timer.runningFromMs}
            >
              {timer.runningFromMs ? '一時停止' : '開始'}
            </button>
            <button
              className="ghost-button"
              onClick={() => resetTimer()}
              type="button"
            >
              リセット
            </button>
            <button
              className="mini-button"
              onClick={applyTimerRange}
              type="button"
              disabled={!canApplyMeasuredRange || !timer.anchorMs || timerElapsedMs <= 0}
              title={!canApplyMeasuredRange ? applyDisabledReason : undefined}
            >
              記録時刻へ反映
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
