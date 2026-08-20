import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Flame,
  House,
  Menu,
  MessageCircle,
  Mic,
  Plus,
  Send,
  X,
} from 'lucide-react';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import {
  addDays,
  formatMinutes,
  minutesBetween,
  minutesFromTime,
  sortByDateTime,
} from '../lib/date';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import type { Actual, Plan } from '../types/domain';
import { HomeDateDisplay } from './HomeDateDisplay';
import './AiPlanningView.css';

interface AiPlanningViewProps {
  application: WeeklyPlanningApplication;
  userId: string;
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  onClose: () => void;
}

const PREVIEW_START_HOUR = 6;
const PREVIEW_END_HOUR = 24;
const PREVIEW_HOUR_HEIGHT = 42;
const PREVIEW_HOURS = Array.from(
  { length: PREVIEW_END_HOUR - PREVIEW_START_HOUR + 1 },
  (_, index) => PREVIEW_START_HOUR + index,
);
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function formatDateLabel(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  const weekday = new Date(`${date}T00:00:00`).getDay();
  return `${Number(month)}/${Number(day)} ${WEEKDAY_LABELS[weekday] ?? ''}`;
}

function timelineStyle(startTime: string, endTime: string): CSSProperties {
  const rangeStart = PREVIEW_START_HOUR * 60;
  const start = Math.max(rangeStart, minutesFromTime(startTime));
  const end = Math.min(PREVIEW_END_HOUR * 60, minutesFromTime(endTime));
  const top = ((start - rangeStart) / 60) * PREVIEW_HOUR_HEIGHT;
  const height = Math.max(18, ((Math.max(start, end) - start) / 60) * PREVIEW_HOUR_HEIGHT);
  return { top: `${top}px`, height: `${height}px` };
}

function toneClass(block: WeeklyPlanDraftBlock): string {
  const key = (block.label || block.subject || block.title || block.id).trim();
  const index = Array.from(key).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 8;
  return `weekly-draft-tone-${index + 1}`;
}

export function AiPlanningView({
  application,
  userId,
  selectedDate,
  plans,
  actuals,
  onClose,
}: AiPlanningViewProps) {
  const { state, pendingDraftBlocks, approvalAvailability } = application;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const dashboard = useMemo(
    () => buildHomeDashboardModel({ plans, actuals, todos: [] }),
    [actuals, plans],
  );
  const previewCandidates = state.previewCandidates ?? [];
  const localPreviewBlocks = useMemo(
    () =>
      createWeeklyPlanningPreviewBlocks(previewCandidates).map((block) =>
        createWeeklyPlanningPreviewDisplayBlock(block, userId),
      ),
    [previewCandidates, userId],
  );
  const hasLocalPreview = pendingDraftBlocks.length === 0 && localPreviewBlocks.length > 0;
  const visibleBlocks = useMemo(
    () => sortByDateTime(pendingDraftBlocks.length > 0 ? pendingDraftBlocks : localPreviewBlocks),
    [localPreviewBlocks, pendingDraftBlocks],
  );
  const isBusy = Boolean(state.pendingTurn || state.pendingApproval);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(state.weekStartDate, index)),
    [state.weekStartDate],
  );
  const totalMinutes = useMemo(
    () => visibleBlocks.reduce((sum, block) => sum + minutesBetween(block.startTime, block.endTime), 0),
    [visibleBlocks],
  );
  const previewGroups = useMemo(
    () =>
      weekDates.map((date) => ({
        date,
        blocks: visibleBlocks.filter((block) => block.date === date),
        existingPlans: sortByDateTime(plans.filter((plan) => plan.date === date)),
      })),
    [plans, visibleBlocks, weekDates],
  );

  useEffect(() => {
    const node = conversationRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [isBusy, state.messages.length, visibleBlocks.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submitMessage() {
    const value = text.trim();
    if (!value || isBusy) return;
    setText('');
    setError('');
    try {
      await application.submitTurn(value);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'メッセージを送信できませんでした。');
    } finally {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      return;
    }
    event.preventDefault();
    void submitMessage();
  }

  function promotePreview() {
    if (previewCandidates.length === 0) return;
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: previewCandidates,
      userId,
      createdAt: new Date().toISOString(),
    });
    if (blocks.length > 0) application.createDraftBlocks(blocks);
  }

  async function saveDrafts() {
    if (pendingDraftBlocks.length === 0 || approvalAvailability.kind !== 'eligible') return;
    setError('');
    try {
      await application.approveDraftBlocks();
      setIsPreviewOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '週間計画を保存できませんでした。');
    }
  }

  function focusComposer() {
    setIsPreviewOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <section className="ai-planning-view" aria-label="AI計画">
      <header className="ai-planning-topbar">
        <div className="home-streak-card" aria-label={`連続学習 ${dashboard.currentStreak}日`}>
          <Flame className="home-streak-flame" aria-hidden="true" size={28} />
          <div>
            <span>連続学習</span>
            <strong>{dashboard.currentStreak}日</strong>
            <small>最高 {dashboard.bestStreak}日</small>
          </div>
        </div>
        <HomeDateDisplay date={dashboard.today || selectedDate} />
        <div className="ai-planning-top-actions">
          <button type="button" aria-label="通知" title="通知機能は準備中です"><Bell size={21} /></button>
          <span className="ai-planning-user-placeholder" aria-hidden="true"><CircleUserRound size={23} /></span>
          <button type="button" aria-label="メニュー" title="メニューはホームから開けます"><Menu size={23} /></button>
        </div>
      </header>

      <div className="ai-planning-card">
        <div className="ai-planning-heading">
          <span className="ai-planning-heading-icon"><MessageCircle aria-hidden="true" size={25} /></span>
          <div>
            <h1>AI計画</h1>
            <p>対話で今週の学習計画を作成・必要に応じて調整</p>
          </div>
        </div>

        <div className="ai-planning-conversation" ref={conversationRef}>
          {state.messages.length === 0 ? (
            <div className="ai-planning-message-row assistant">
              <span className="ai-planning-message-avatar"><MessageCircle size={19} aria-hidden="true" /></span>
              <div className="ai-planning-message-body">
                <div className="ai-planning-bubble">
                  こんにちは。今週の目標や予定に合わせて、学習計画を作成します。\nどのような目標や優先したいことがありますか？
                </div>
              </div>
            </div>
          ) : null}

          {state.messages.map((message) => (
            <div
              className={`ai-planning-message-row ${message.role === 'user' ? 'user' : 'assistant'}`}
              key={message.id}
            >
              {message.role === 'assistant' ? (
                <span className="ai-planning-message-avatar"><MessageCircle size={19} aria-hidden="true" /></span>
              ) : null}
              <div className="ai-planning-message-body">
                <div className="ai-planning-bubble">{message.content}</div>
              </div>
              {message.role === 'user' ? (
                <span className="ai-planning-message-avatar user"><CircleUserRound size={19} aria-hidden="true" /></span>
              ) : null}
            </div>
          ))}

          {state.pendingTurn ? (
            <div className="ai-planning-message-row assistant" role="status" aria-label="AIが回答を作成中">
              <span className="ai-planning-message-avatar"><MessageCircle size={19} aria-hidden="true" /></span>
              <div className="ai-planning-message-body">
                <div className="ai-planning-bubble ai-planning-typing"><span /><span /><span /></div>
              </div>
            </div>
          ) : null}

          {visibleBlocks.length > 0 ? (
            <div className="ai-planning-plan-card">
              <div className="ai-planning-plan-card-head">
                <div>
                  <span>今週の計画案</span>
                  <strong>{visibleBlocks.length}件の予定を作成</strong>
                </div>
                <b>{visibleBlocks.length}件</b>
              </div>
              <div className="ai-planning-plan-summary">
                <span><CalendarDays size={16} aria-hidden="true" />対象 {formatDateLabel(weekDates[0] ?? state.weekStartDate)} - {formatDateLabel(weekDates[6] ?? state.weekStartDate)}</span>
                <span><BookOpen size={16} aria-hidden="true" />合計 {formatMinutes(totalMinutes)}</span>
              </div>
              <button className="ai-planning-preview-button" type="button" onClick={() => setIsPreviewOpen(true)}>
                <CalendarDays size={18} aria-hidden="true" />
                週プレビューを確認
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <button className="ai-planning-more-button" type="button" onClick={focusComposer}>もっと変更する</button>
            </div>
          ) : null}

          {error ? <p className="ai-planning-error" role="alert">{error}</p> : null}
        </div>

        <div className="ai-planning-composer">
          <button className="ai-planning-composer-side" type="button" aria-label="追加メニュー" title="追加機能は今後対応予定"><Plus size={24} /></button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={4000}
            placeholder="予定や目標を入力..."
            disabled={isBusy}
          />
          <button className="ai-planning-mic-button" type="button" aria-label="音声入力" title="音声入力は今後対応予定"><Mic size={21} /></button>
          <button
            className="ai-planning-send-button"
            type="button"
            aria-label="送信"
            disabled={!text.trim() || isBusy}
            onClick={() => void submitMessage()}
          >
            <Send size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav className="ai-planning-bottom-nav" aria-label="主要ナビゲーション">
        <button className="active" type="button" aria-current="page"><MessageCircle aria-hidden="true" /><span>AI計画</span></button>
        <button type="button" onClick={onClose}><CalendarDays aria-hidden="true" /><span>予定</span></button>
        <button type="button" onClick={onClose}><span className="ai-planning-nav-home"><House aria-hidden="true" /></span><span>ホーム</span></button>
        <button type="button" onClick={onClose}><BookOpen aria-hidden="true" /><span>教材</span></button>
        <button type="button" onClick={onClose}><BarChart3 aria-hidden="true" /><span>分析</span></button>
      </nav>

      {isPreviewOpen && visibleBlocks.length > 0 ? (
        <div className="ai-planning-preview-overlay" role="presentation" onClick={() => setIsPreviewOpen(false)}>
          <section
            className="ai-planning-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="今週の計画プレビュー"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ai-planning-preview-header">
              <button type="button" onClick={() => setIsPreviewOpen(false)}><X size={18} />閉じる</button>
              <div>
                <h2>今週の計画プレビュー</h2>
                <p>{formatDateLabel(weekDates[0] ?? state.weekStartDate)} - {formatDateLabel(weekDates[6] ?? state.weekStartDate)}</p>
              </div>
              <span>{visibleBlocks.length}件</span>
            </header>

            <div className="ai-planning-preview-scroll">
              <div className="ai-planning-week-grid">
                <div className="ai-planning-week-header">
                  <span>時間</span>
                  {previewGroups.map((group) => (
                    <div key={group.date}>
                      <strong>{formatDateLabel(group.date)}</strong>
                      <small>{group.blocks.length}件</small>
                    </div>
                  ))}
                </div>
                <div className="ai-planning-week-body" style={{ height: `${(PREVIEW_END_HOUR - PREVIEW_START_HOUR) * PREVIEW_HOUR_HEIGHT}px` }}>
                  <div className="ai-planning-time-axis">
                    {PREVIEW_HOURS.map((hour) => (
                      <span key={hour} style={{ top: `${(hour - PREVIEW_START_HOUR) * PREVIEW_HOUR_HEIGHT}px` }}>{String(hour).padStart(2, '0')}:00</span>
                    ))}
                  </div>
                  {previewGroups.map((group) => (
                    <div className="ai-planning-day-column" key={group.date}>
                      {PREVIEW_HOURS.map((hour) => (
                        <span className="ai-planning-hour-line" key={hour} style={{ top: `${(hour - PREVIEW_START_HOUR) * PREVIEW_HOUR_HEIGHT}px` }} />
                      ))}
                      {group.existingPlans.map((plan) => (
                        <div className="ai-planning-existing-block" key={plan.id} style={timelineStyle(plan.startTime, plan.endTime)} title={`${plan.title} ${plan.startTime}-${plan.endTime}`}>
                          <strong>{plan.title}</strong><small>{plan.startTime}-{plan.endTime}</small>
                        </div>
                      ))}
                      {group.blocks.map((block) => (
                        <div className={`ai-planning-draft-block ${toneClass(block)}`} key={block.id} style={timelineStyle(block.startTime, block.endTime)} title={`${block.title} ${block.startTime}-${block.endTime}`}>
                          <strong>{block.title}</strong><small>{block.startTime}-{block.endTime}</small>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <footer className="ai-planning-preview-actions">
              <button className="ai-planning-secondary-action" type="button" onClick={focusComposer}>さらに調整</button>
              {hasLocalPreview ? (
                <button className="ai-planning-primary-action" type="button" onClick={promotePreview}>この内容で仮予定にする</button>
              ) : (
                <button
                  className="ai-planning-primary-action"
                  type="button"
                  disabled={isBusy || approvalAvailability.kind !== 'eligible'}
                  onClick={() => void saveDrafts()}
                >
                  {state.pendingApproval ? '保存中...' : 'この内容で保存'}
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
