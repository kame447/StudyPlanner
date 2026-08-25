import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  LoaderCircle,
  Menu,
  MessageCircle,
  Mic,
  Plus,
  Send,
  X,
} from 'lucide-react';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import {
  createAiPlanningChat,
  deleteAiPlanningChat,
  deriveAiPlanningChatTitle,
  hasStoredAiPlanningChatIndex,
  loadAiPlanningChatIndex,
  loadAiPlanningChatSnapshot,
  saveAiPlanningChatIndex,
  saveAiPlanningChatSnapshot,
  searchAiPlanningChats,
  setActiveAiPlanningChat,
  updateAiPlanningChatRecord,
  type AiPlanningChatIndex,
} from '../features/weeklyPlanning/chat/aiPlanningChatStore';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { buildAiPlanningStarterPrompts } from '../features/weeklyPlanning/ui/aiPlanningStarterPrompts';
import { validateAiImageFile } from '../lib/aiImageAttachment';
import {
  addDays,
  formatMinutes,
  minutesBetween,
  minutesFromTime,
  parseTimeToMinutes,
  sortByDateTime,
} from '../lib/date';
import { extractPlanningImageAttachment } from '../lib/planningImageAttachment';
import { plannerRepository } from '../repositories';
import type { Plan, StudyMaterial, TodoTask } from '../types/domain';
import { AiPlanningChatSidebar } from './AiPlanningChatSidebar';
import './AiPlanningView.css';
import './AiPlanningViewFixes.css';

interface AiPlanningViewProps {
  application: WeeklyPlanningApplication;
  userId: string;
  selectedDate: string;
  plans: Plan[];
}

interface PendingPlanningImageAttachment {
  file: File;
  previewUrl: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const PREVIEW_START_HOUR = 0;
const PREVIEW_END_HOUR = 24;
const PREVIEW_HOUR_HEIGHT = 42;
const PREVIEW_HOURS = Array.from(
  { length: PREVIEW_END_HOUR - PREVIEW_START_HOUR + 1 },
  (_, index) => PREVIEW_START_HOUR + index,
);
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function speechRecognitionErrorMessage(error: string, detail?: string): string {
  const normalizedDetail = detail?.trim();
  if (normalizedDetail) return normalizedDetail;

  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'マイクの使用が許可されていません。ブラウザのマイク権限を許可して再試行してください。';
    case 'audio-capture':
      return '利用できるマイクを確認できませんでした。端末のマイク設定を確認してください。';
    case 'no-speech':
      return '音声を認識できませんでした。もう一度話してください。';
    case 'network':
      return '音声文字起こしAPIへ接続できませんでした。Workerの接続設定を確認してください。';
    default:
      return '音声入力に失敗しました。もう一度試してください。';
  }
}

function formatDateLabel(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  const weekday = new Date(`${date}T00:00:00`).getDay();
  return `${Number(month)}/${Number(day)} ${WEEKDAY_LABELS[weekday] ?? ''}`;
}

function timelineStyle(startTime: string, endTime: string): CSSProperties {
  const rangeStart = PREVIEW_START_HOUR * 60;
  const rangeEnd = PREVIEW_END_HOUR * 60;
  const start = Math.max(rangeStart, minutesFromTime(startTime));
  const end = Math.min(rangeEnd, parseTimeToMinutes(endTime, 'end'));
  const top = ((start - rangeStart) / 60) * PREVIEW_HOUR_HEIGHT;
  const height = Math.max(
    18,
    ((Math.max(start, end) - start) / 60) * PREVIEW_HOUR_HEIGHT,
  );
  return { top: `${top}px`, height: `${height}px` };
}

function toneClass(block: WeeklyPlanDraftBlock): string {
  const key = (block.label || block.subject || block.title || block.id).trim();
  const index =
    Array.from(key).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 8;
  return `weekly-draft-tone-${index + 1}`;
}

function normalizeCurrentWeekBlocks(
  blocks: WeeklyPlanDraftBlock[],
  weekDates: readonly string[],
): WeeklyPlanDraftBlock[] {
  const weekDateSet = new Set(weekDates);
  const uniqueById = new Map<string, WeeklyPlanDraftBlock>();

  for (const block of blocks) {
    if (!weekDateSet.has(block.date)) continue;
    uniqueById.set(block.id, block);
  }

  return sortByDateTime(Array.from(uniqueById.values()));
}

function shouldKeepComposerFocusAfterSubmit(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(max-width: 500px), (pointer: coarse)').matches;
}

export function AiPlanningView({
  application,
  userId,
  selectedDate,
  plans,
}: AiPlanningViewProps) {
  const { state, pendingDraftBlocks, approvalAvailability } = application;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [chatIndex, setChatIndex] = useState<AiPlanningChatIndex>(() =>
    loadAiPlanningChatIndex(userId),
  );
  const [imageAttachment, setImageAttachment] =
    useState<PendingPlanningImageAttachment | null>(null);
  const [isReadingAttachment, setIsReadingAttachment] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [starterTodos, setStarterTodos] = useState<TodoTask[]>([]);
  const [starterMaterials, setStarterMaterials] = useState<StudyMaterial[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const didInitializeChatsRef = useRef(false);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseTextRef = useRef('');
  const speechFinalTextRef = useRef('');
  const previewCandidates = state.previewCandidates ?? [];
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(state.weekStartDate, index)),
    [state.weekStartDate],
  );
  const localPreviewBlocks = useMemo(
    () =>
      createWeeklyPlanningPreviewBlocks(previewCandidates).map((block) =>
        createWeeklyPlanningPreviewDisplayBlock(block, userId),
      ),
    [previewCandidates, userId],
  );
  const hasLocalPreview = localPreviewBlocks.length > 0;
  const visibleBlocks = useMemo(() => {
    const sourceBlocks = hasLocalPreview ? localPreviewBlocks : pendingDraftBlocks;
    return normalizeCurrentWeekBlocks(sourceBlocks, weekDates);
  }, [hasLocalPreview, localPreviewBlocks, pendingDraftBlocks, weekDates]);
  const isBusy = Boolean(state.pendingTurn || state.pendingApproval);
  const isComposerBusy = isBusy || isReadingAttachment;
  const speechRecognitionSupported = getSpeechRecognitionConstructor() !== null;
  const totalMinutes = useMemo(
    () =>
      visibleBlocks.reduce(
        (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
        0,
      ),
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
  const displayedDraftCount = useMemo(
    () => previewGroups.reduce((count, group) => count + group.blocks.length, 0),
    [previewGroups],
  );
  const visibleChats = useMemo(
    () => searchAiPlanningChats(userId, chatIndex.chats, chatQuery),
    [chatIndex.chats, chatQuery, userId],
  );
  const activeChat =
    chatIndex.chats.find((chat) => chat.id === chatIndex.activeChatId) ??
    chatIndex.chats[0];
  const starterPrompts = useMemo(
    () =>
      buildAiPlanningStarterPrompts({
        referenceDate: selectedDate,
        plans,
        todos: starterTodos,
        materials: starterMaterials,
      }),
    [plans, selectedDate, starterMaterials, starterTodos],
  );

  function persistActiveChat(baseIndex = chatIndex): AiPlanningChatIndex {
    const chatId = baseIndex.activeChatId;
    const snapshot = application.exportConversationSnapshot();
    const messages = snapshot?.planningState.messages ?? state.messages;
    const now = snapshot?.savedAt ?? new Date().toISOString();
    let nextIndex = updateAiPlanningChatRecord(baseIndex, chatId, {
      title: deriveAiPlanningChatTitle(messages),
      updatedAt: now,
      weekStartDate:
        snapshot?.weekStartDate ??
        baseIndex.chats.find((chat) => chat.id === chatId)?.weekStartDate ??
        null,
    });

    if (snapshot) {
      saveAiPlanningChatSnapshot(userId, chatId, snapshot);
      nextIndex = updateAiPlanningChatRecord(nextIndex, chatId, {
        weekStartDate: snapshot.weekStartDate,
      });
    }

    saveAiPlanningChatIndex(userId, nextIndex);
    setChatIndex(nextIndex);
    return nextIndex;
  }

  useEffect(() => {
    if (didInitializeChatsRef.current) return;
    didInitializeChatsRef.current = true;
    const hadStoredChatIndex = hasStoredAiPlanningChatIndex(userId);
    const loadedIndex = loadAiPlanningChatIndex(userId);
    const loadedActive =
      loadedIndex.chats.find((chat) => chat.id === loadedIndex.activeChatId) ??
      loadedIndex.chats[0];
    const snapshot = loadedActive
      ? loadAiPlanningChatSnapshot(userId, loadedActive)
      : null;

    if (snapshot) {
      application.loadConversationSnapshot(snapshot);
      setChatIndex(loadedIndex);
      return;
    }

    const currentSnapshot = application.exportConversationSnapshot();
    if (!hadStoredChatIndex && loadedActive && currentSnapshot) {
      saveAiPlanningChatSnapshot(userId, loadedActive.id, currentSnapshot);
      const migratedIndex = updateAiPlanningChatRecord(loadedIndex, loadedActive.id, {
        title: deriveAiPlanningChatTitle(currentSnapshot.planningState.messages),
        updatedAt: currentSnapshot.savedAt,
        weekStartDate: currentSnapshot.weekStartDate,
      });
      saveAiPlanningChatIndex(userId, migratedIndex);
      setChatIndex(migratedIndex);
      return;
    }

    saveAiPlanningChatIndex(userId, loadedIndex);
    setChatIndex(loadedIndex);
  }, [application, userId]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      plannerRepository.getTodos(userId),
      plannerRepository.getStudyMaterials(userId),
    ]).then(
      ([todos, materials]) => {
        if (cancelled) return;
        setStarterTodos(todos);
        setStarterMaterials(materials);
      },
      () => {
        if (cancelled) return;
        setStarterTodos([]);
        setStarterMaterials([]);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const node = conversationRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chatIndex.activeChatId, isBusy, state.messages.length, visibleBlocks.length]);

  useEffect(() => {
    return () => {
      if (imageAttachment) {
        URL.revokeObjectURL(imageAttachment.previewUrl);
      }
    };
  }, [imageAttachment]);

  useEffect(() => {
    return () => {
      const recognition = speechRecognitionRef.current;
      if (!recognition) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      speechRecognitionRef.current = null;
    };
  }, []);

  function clearImageAttachment() {
    setImageAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }

  function openImagePicker() {
    if (isComposerBusy || isListening) return;
    attachmentInputRef.current?.click();
  }

  function handleImageAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const validationError = validateAiImageFile(file);

    if (validationError) {
      setError(validationError);
      event.target.value = '';
      return;
    }

    setError('');
    setImageAttachment({
      file,
      previewUrl: URL.createObjectURL(file),
    });
  }

  function toggleSpeechRecognition() {
    if (isComposerBusy) return;

    if (isListening) {
      speechRecognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setError(
        'このブラウザでは音声入力を利用できません。ChromeやSafariなど対応ブラウザで試してください。',
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = false;
    recognition.interimResults = true;
    speechBaseTextRef.current = text;
    speechFinalTextRef.current = '';
    setError('');

    recognition.onresult = (event) => {
      let finalTranscript = speechFinalTextRef.current;
      let interimTranscript = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;

        if (result.isFinal) {
          finalTranscript = [finalTranscript, transcript].filter(Boolean).join(' ');
        } else {
          interimTranscript = [interimTranscript, transcript].filter(Boolean).join(' ');
        }
      }

      speechFinalTextRef.current = finalTranscript;
      const recognizedText = [finalTranscript, interimTranscript].filter(Boolean).join(' ');
      const baseText = speechBaseTextRef.current.trimEnd();
      const nextText = [baseText, recognizedText].filter(Boolean).join('\n');
      setText(nextText.slice(0, 4000));
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      setError(speechRecognitionErrorMessage(event.error, event.message));
    };

    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null;
      }
      setIsListening(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    speechRecognitionRef.current = recognition;
    setIsListening(true);

    try {
      recognition.start();
    } catch (speechError) {
      speechRecognitionRef.current = null;
      setIsListening(false);
      setError(
        speechError instanceof Error
          ? `音声入力を開始できませんでした: ${speechError.message}`
          : '音声入力を開始できませんでした。',
      );
    }
  }

  async function submitMessage() {
    const value = text.trim();
    const attachment = imageAttachment;
    if ((!value && !attachment) || isComposerBusy || isListening) return;

    setError('');
    let supplementalContext: string | undefined;

    if (attachment) {
      setIsReadingAttachment(true);
      try {
        const extraction = await extractPlanningImageAttachment(attachment.file);
        supplementalContext = extraction.text;
      } catch (attachmentError) {
        setError(
          attachmentError instanceof Error
            ? attachmentError.message
            : '画像を読み取れませんでした。',
        );
        return;
      } finally {
        setIsReadingAttachment(false);
      }
    }

    const displayText = attachment
      ? value
        ? `${value}\n\n画像: ${attachment.file.name}`
        : `画像「${attachment.file.name}」をもとに学習計画を作って`
      : value;

    let shouldRestoreComposerFocus = shouldKeepComposerFocusAfterSubmit();
    setText('');
    if (!shouldRestoreComposerFocus) {
      inputRef.current?.blur();
    }

    try {
      const result = await application.submitTurn(displayText, supplementalContext);
      if (!result.accepted) {
        setText(value);
        shouldRestoreComposerFocus = true;
        return;
      }
      clearImageAttachment();
      persistActiveChat();
    } catch (submitError) {
      setText(value);
      shouldRestoreComposerFocus = true;
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'メッセージを送信できませんでした。',
      );
      persistActiveChat();
    } finally {
      if (shouldRestoreComposerFocus) {
        window.requestAnimationFrame(() => inputRef.current?.focus());
      }
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

  function useStarterPrompt(prompt: string) {
    setText(prompt);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function switchChat(chatId: string) {
    if (isBusy || isListening || chatId === chatIndex.activeChatId) {
      setIsChatDrawerOpen(false);
      return;
    }
    const persistedIndex = persistActiveChat();
    const target = persistedIndex.chats.find((chat) => chat.id === chatId);
    if (!target) return;
    const snapshot = loadAiPlanningChatSnapshot(userId, target);
    const loaded = snapshot ? application.loadConversationSnapshot(snapshot) : true;
    if (!snapshot) application.startConversation();
    if (!loaded) {
      setError(
        'このチャットを開けませんでした。処理中の操作を完了してから再試行してください。',
      );
      return;
    }
    const nextIndex = setActiveAiPlanningChat(persistedIndex, chatId);
    saveAiPlanningChatIndex(userId, nextIndex);
    setChatIndex(nextIndex);
    setText('');
    clearImageAttachment();
    setError('');
    setIsPreviewOpen(false);
    setIsChatDrawerOpen(false);
  }

  function createChat() {
    if (isBusy || isListening) return;
    const persistedIndex = persistActiveChat();
    const created = createAiPlanningChat(persistedIndex);
    application.startConversation();
    saveAiPlanningChatIndex(userId, created.index);
    setChatIndex(created.index);
    setChatQuery('');
    setText('');
    clearImageAttachment();
    setError('');
    setIsPreviewOpen(false);
    setIsChatDrawerOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function removeChat(chatId: string) {
    if (isBusy || isListening) return;
    const chat = chatIndex.chats.find((item) => item.id === chatId);
    if (!chat) return;
    if (!window.confirm(`「${chat.title}」を削除しますか？`)) return;

    const persistedIndex = persistActiveChat();
    const wasActive = persistedIndex.activeChatId === chatId;
    const nextIndex = deleteAiPlanningChat(userId, persistedIndex, chatId);

    if (wasActive) {
      const target =
        nextIndex.chats.find((item) => item.id === nextIndex.activeChatId) ??
        nextIndex.chats[0];
      const snapshot = target ? loadAiPlanningChatSnapshot(userId, target) : null;
      if (snapshot) application.loadConversationSnapshot(snapshot);
      else application.startConversation();
      setText('');
      clearImageAttachment();
      setError('');
      setIsPreviewOpen(false);
    }

    saveAiPlanningChatIndex(userId, nextIndex);
    setChatIndex(nextIndex);
  }

  function promotePreview() {
    if (previewCandidates.length === 0 || visibleBlocks.length === 0) return;
    const visibleIds = new Set(visibleBlocks.map((block) => block.id));
    const visibleCandidates = previewCandidates.filter((candidate) =>
      visibleIds.has(candidate.stableKey),
    );
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: visibleCandidates,
      userId,
      createdAt: new Date().toISOString(),
    });
    if (blocks.length === 0) return;

    if (pendingDraftBlocks.length > 0) {
      application.clearDraftBlocks();
    }
    application.createDraftBlocks(blocks);
    window.requestAnimationFrame(() => persistActiveChat());
  }

  async function saveDrafts() {
    if (
      pendingDraftBlocks.length === 0 ||
      approvalAvailability.kind !== 'eligible'
    ) {
      return;
    }
    setError('');
    try {
      await application.approveDraftBlocks();
      persistActiveChat();
      setIsPreviewOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : '週間計画を保存できませんでした。',
      );
      persistActiveChat();
    }
  }

  function focusComposer() {
    setIsPreviewOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <section className="ai-planning-view home-dashboard" aria-label="AI計画">
      <AiPlanningChatSidebar
        open={isChatDrawerOpen}
        chats={visibleChats}
        activeChatId={chatIndex.activeChatId}
        query={chatQuery}
        disabled={isBusy || isListening}
        onQueryChange={setChatQuery}
        onCreate={createChat}
        onSelect={switchChat}
        onDelete={removeChat}
        onClose={() => setIsChatDrawerOpen(false)}
      />

      <div className="ai-planning-card">
        <div className="ai-planning-heading">
          <button
            className="ai-planning-chat-menu-button"
            type="button"
            aria-label="チャット一覧を開く"
            onClick={() => setIsChatDrawerOpen(true)}
          >
            <Menu aria-hidden="true" size={22} />
          </button>
          <div>
            <h1>AI計画</h1>
            <p>
              {activeChat?.title === '新しいチャット'
                ? '対話で学習計画を作成・必要に応じて調整'
                : activeChat?.title ??
                  '対話で学習計画を作成・必要に応じて調整'}
            </p>
          </div>
        </div>

        <div className="ai-planning-conversation" ref={conversationRef}>
          {state.messages.length === 0 &&
          visibleBlocks.length === 0 &&
          !state.pendingTurn ? (
            <div className="ai-planning-starters" aria-label="入力例">
              <p>
                計画したいことをそのまま入力できます。登録内容に合わせた候補からも始められます。
              </p>
              <div className="ai-planning-starter-list">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => useStarterPrompt(prompt)}
                  >
                    <span>{prompt}</span>
                    <ChevronRight aria-hidden="true" size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {state.messages.map((message) => (
            <div
              className={`ai-planning-message-row ${
                message.role === 'user' ? 'user' : 'assistant'
              }`}
              key={message.id}
            >
              {message.role === 'assistant' ? (
                <span className="ai-planning-message-avatar">
                  <MessageCircle size={19} aria-hidden="true" />
                </span>
              ) : null}
              <div className="ai-planning-message-body">
                <div className="ai-planning-bubble">{message.content}</div>
              </div>
              {message.role === 'user' ? (
                <span className="ai-planning-message-avatar user">
                  <CircleUserRound size={19} aria-hidden="true" />
                </span>
              ) : null}
            </div>
          ))}

          {state.pendingTurn ? (
            <div
              className="ai-planning-message-row assistant"
              role="status"
              aria-label="AIが回答を作成中"
            >
              <span className="ai-planning-message-avatar">
                <MessageCircle size={19} aria-hidden="true" />
              </span>
              <div className="ai-planning-message-body">
                <div className="ai-planning-bubble ai-planning-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          ) : null}

          {displayedDraftCount > 0 ? (
            <div className="ai-planning-plan-card">
              <div className="ai-planning-plan-card-head">
                <div>
                  <span>今週の計画案</span>
                  <strong>{displayedDraftCount}件の予定を作成</strong>
                </div>
                <b>{displayedDraftCount}件</b>
              </div>
              <div className="ai-planning-plan-summary">
                <span>
                  <CalendarDays size={16} aria-hidden="true" />対象{' '}
                  {formatDateLabel(weekDates[0] ?? state.weekStartDate)} -{' '}
                  {formatDateLabel(weekDates[6] ?? state.weekStartDate)}
                </span>
                <span>
                  <BookOpen size={16} aria-hidden="true" />合計{' '}
                  {formatMinutes(totalMinutes)}
                </span>
              </div>
              <button
                className="ai-planning-preview-button"
                type="button"
                onClick={() => setIsPreviewOpen(true)}
              >
                <CalendarDays size={18} aria-hidden="true" />
                週プレビューを確認
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {error ? (
            <p className="ai-planning-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="ai-planning-composer">
          <input
            ref={attachmentInputRef}
            className="ai-planning-attachment-input"
            type="file"
            accept="image/png,image/jpeg"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleImageAttachmentChange}
          />
          {imageAttachment ? (
            <div
              className="ai-planning-attachment-preview"
              aria-label={`添付画像 ${imageAttachment.file.name}`}
            >
              <div className="ai-planning-attachment-thumbnail">
                <img src={imageAttachment.previewUrl} alt="添付画像のプレビュー" />
                <button
                  className="ai-planning-attachment-remove"
                  type="button"
                  aria-label="添付画像を削除"
                  disabled={isReadingAttachment}
                  onClick={clearImageAttachment}
                >
                  <X size={13} aria-hidden="true" />
                </button>
                {isReadingAttachment ? (
                  <span className="ai-planning-attachment-loading" aria-hidden="true">
                    <LoaderCircle size={20} />
                  </span>
                ) : null}
              </div>
              <span>
                {isReadingAttachment
                  ? '画像を読み取り中...'
                  : imageAttachment.file.name}
              </span>
            </div>
          ) : null}
          <button
            className="ai-planning-composer-side"
            type="button"
            aria-label="写真を追加"
            title="写真を追加"
            disabled={isComposerBusy || isListening}
            onClick={openImagePicker}
          >
            <Plus size={24} />
          </button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={4000}
            placeholder={isListening ? '音声を認識中...' : '予定や目標を入力...'}
            disabled={isComposerBusy || isListening}
          />
          <button
            className="ai-planning-mic-button"
            type="button"
            aria-label={isListening ? '音声入力を停止' : '音声入力'}
            aria-pressed={isListening}
            title={
              speechRecognitionSupported
                ? isListening
                  ? '音声入力を停止'
                  : '音声入力'
                : 'このブラウザは音声入力に対応していません'
            }
            disabled={isComposerBusy}
            onClick={toggleSpeechRecognition}
            style={
              isListening
                ? { background: '#eaf4ff', color: '#0878f9' }
                : undefined
            }
          >
            <Mic size={21} aria-hidden="true" />
          </button>
          <button
            className="ai-planning-send-button"
            type="button"
            aria-label="送信"
            disabled={
              (!text.trim() && !imageAttachment) || isComposerBusy || isListening
            }
            onClick={() => void submitMessage()}
          >
            <Send size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {isPreviewOpen && displayedDraftCount > 0 ? (
        <div
          className="ai-planning-preview-overlay"
          role="presentation"
          onClick={() => setIsPreviewOpen(false)}
        >
          <section
            className="ai-planning-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="今週の計画プレビュー"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ai-planning-preview-header">
              <button type="button" onClick={() => setIsPreviewOpen(false)}>
                <X size={18} />閉じる
              </button>
              <div>
                <h2>今週の計画プレビュー</h2>
                <p>
                  {formatDateLabel(weekDates[0] ?? state.weekStartDate)} -{' '}
                  {formatDateLabel(weekDates[6] ?? state.weekStartDate)}
                </p>
              </div>
              <span>{displayedDraftCount}件</span>
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
                <div
                  className="ai-planning-week-body"
                  style={{
                    height: `${
                      (PREVIEW_END_HOUR - PREVIEW_START_HOUR) *
                      PREVIEW_HOUR_HEIGHT
                    }px`,
                  }}
                >
                  <div className="ai-planning-time-axis">
                    {PREVIEW_HOURS.map((hour) => (
                      <span
                        key={hour}
                        style={{
                          top: `${
                            (hour - PREVIEW_START_HOUR) * PREVIEW_HOUR_HEIGHT
                          }px`,
                        }}
                      >
                        {String(hour).padStart(2, '0')}:00
                      </span>
                    ))}
                  </div>
                  {previewGroups.map((group) => (
                    <div className="ai-planning-day-column" key={group.date}>
                      {PREVIEW_HOURS.map((hour) => (
                        <span
                          className="ai-planning-hour-line"
                          key={hour}
                          style={{
                            top: `${
                              (hour - PREVIEW_START_HOUR) * PREVIEW_HOUR_HEIGHT
                            }px`,
                          }}
                        />
                      ))}
                      {group.existingPlans.map((plan) => (
                        <div
                          className="ai-planning-existing-block"
                          key={plan.id}
                          style={timelineStyle(plan.startTime, plan.endTime)}
                          title={`${plan.title} ${plan.startTime}-${plan.endTime}`}
                        >
                          <strong>{plan.title}</strong>
                          <small>
                            {plan.startTime}-{plan.endTime}
                          </small>
                        </div>
                      ))}
                      {group.blocks.map((block) => (
                        <div
                          className={`ai-planning-draft-block ${toneClass(block)}`}
                          key={block.id}
                          style={timelineStyle(block.startTime, block.endTime)}
                          title={`${block.title} ${block.startTime}-${block.endTime}`}
                        >
                          <strong>{block.title}</strong>
                          <small>
                            {block.startTime}-{block.endTime}
                          </small>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <footer className="ai-planning-preview-actions">
              <button
                className="ai-planning-secondary-action"
                type="button"
                onClick={focusComposer}
              >
                さらに調整
              </button>
              {hasLocalPreview ? (
                <button
                  className="ai-planning-primary-action"
                  type="button"
                  onClick={promotePreview}
                >
                  この内容で仮予定にする
                </button>
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
