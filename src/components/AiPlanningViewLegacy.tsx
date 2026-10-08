import { WeeklyPlanningRuntimeModuleError } from '../features/weeklyPlanning/application/weeklyPlanningRuntimeModule';
import {
  consumeAiPlanningModuleRecovery, readAiPlanningModuleRecovery, saveAiPlanningModuleRecovery,
  sameAiPlanningModuleRecoveryBinding, type AiPlanningModuleRecoveryBinding,
  type AiPlanningModuleRecoveryDraft,
} from '../features/weeklyPlanning/chat/aiPlanningModuleRecovery';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
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
import { searchAiPlanningChats } from '../features/weeklyPlanning/chat/aiPlanningChatStore';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import {
  buildAiPlanningStarterPromptOptions,
  type AiPlanningStarterPromptOption,
} from '../features/weeklyPlanning/ui/aiPlanningStarterPrompts';
import { buildAiPlanningImageTurn } from '../features/weeklyPlanning/ui/aiPlanningImageTurn';
import { validateAiImageFile } from '../lib/aiImageAttachment';
import {
  formatMinutes,
  minutesBetween,
  minutesFromTime,
  parseTimeToMinutes,
  sortByDateTime,
} from '../lib/date';
import { extractPlanningImageAttachment } from '../lib/planningImageAttachment';
import { plannerRepository } from '../repositories';
import { useAiPlanningViewport } from '../hooks/useAiPlanningViewport';
import type { Plan, StudyMaterial, TodoTask } from '../types/domain';
import { AiPlanningChatSidebar } from './AiPlanningChatSidebar';
import {
  buildAiPlanningPreviewDatePages,
  clampAiPlanningPreviewPageIndex,
  getAiPlanningPreviewDateRange,
  normalizeAiPlanningPreviewBlocks,
} from './aiPlanningPreviewPeriod';
import './AiPlanningView.css';
import './AiPlanningViewFixes.css';

interface AiPlanningViewProps {
  application: WeeklyPlanningApplication;
  userId: string;
  selectedDate: string;
  plans: Plan[];
  cancellationEpoch?: { readonly current: number };
  onCancelPendingTurn?: () => void;
  checkpointNotice?: ReactNode;
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

function shouldReleaseComposerFocusAfterSubmit(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 500px), (pointer: coarse)').matches;
}

export function AiPlanningView({
  application,
  userId,
  selectedDate,
  plans,
  cancellationEpoch,
  onCancelPendingTurn,
  checkpointNotice,
}: AiPlanningViewProps) {
  const { state, pendingDraftBlocks, approvalAvailability } = application;
  const canCancelTurn = Boolean(state.pendingTurn && onCancelPendingTurn);
  const [text, setText] = useState('');
  const [selectedStarterOption, setSelectedStarterOption] =
    useState<AiPlanningStarterPromptOption | null>(null);
  const [error, setError] = useState('');
  const [moduleLoadFailed, setModuleLoadFailed] = useState(false);
  const [moduleRetryAttempted, setModuleRetryAttempted] = useState(false);
  const [isRecoveringModule, setIsRecoveringModule] = useState(false);
  const recoveryOperation = useRef<symbol | null>(null);
  const moduleRetryUsed = useRef(false);
  const recoveryMounted = useRef(false);
  const restoredRecovery = useRef<{ token: string; binding: AiPlanningModuleRecoveryBinding;
    draft: AiPlanningModuleRecoveryDraft } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const chatIndex = application.chat.index;
  const [imageAttachment, setImageAttachment] =
    useState<PendingPlanningImageAttachment | null>(null);
  const [isReadingAttachment, setIsReadingAttachment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cancellationGeneration = cancellationEpoch?.current ?? 0;
  const submission = useRef({ active: false, ownerId: userId, index: chatIndex, token: null as symbol | null });
  const [isListening, setIsListening] = useState(false);
  const [starterTodos, setStarterTodos] = useState<TodoTask[]>([]);
  const [starterMaterials, setStarterMaterials] = useState<StudyMaterial[]>([]);
  const [starterCatalogStatus, setStarterCatalogStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLElement | null>(null);
  useAiPlanningViewport(viewRef, conversationRef);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseTextRef = useRef('');
  const speechFinalTextRef = useRef('');
  const previewCandidates = state.previewCandidates ?? [];
  const localPreviewBlocks = useMemo(
    () =>
      createWeeklyPlanningPreviewBlocks(previewCandidates).map((block) =>
        createWeeklyPlanningPreviewDisplayBlock(block, userId),
      ),
    [previewCandidates, userId],
  );
  const hasLocalPreview = localPreviewBlocks.length > 0;
  const allPreviewBlocks = useMemo(
    () =>
      normalizeAiPlanningPreviewBlocks(
        hasLocalPreview ? localPreviewBlocks : pendingDraftBlocks,
      ),
    [hasLocalPreview, localPreviewBlocks, pendingDraftBlocks],
  );
  const previewDateRange = useMemo(
    () => getAiPlanningPreviewDateRange(allPreviewBlocks),
    [allPreviewBlocks],
  );
  const previewDatePages = useMemo(
    () => buildAiPlanningPreviewDatePages(allPreviewBlocks),
    [allPreviewBlocks],
  );
  const activePreviewPageIndex = clampAiPlanningPreviewPageIndex(
    previewPageIndex,
    previewDatePages.length,
  );
  const previewPageDates = previewDatePages[activePreviewPageIndex] ?? [];
  const previewPageDateSet = useMemo(
    () => new Set(previewPageDates),
    [previewPageDates],
  );
  const visibleBlocks = useMemo(
    () => allPreviewBlocks.filter((block) => previewPageDateSet.has(block.date)),
    [allPreviewBlocks, previewPageDateSet],
  );
  const previewPlanSignature = useMemo(
    () => allPreviewBlocks.map((block) => `${block.id}:${block.date}`).join('|'),
    [allPreviewBlocks],
  );
  const isBusy = Boolean(state.pendingTurn || state.pendingApproval || application.chat.requiresInitialization);
  const isInteractionBusy = isBusy || isReadingAttachment || isSubmitting || isRecoveringModule;
  const isComposerBusy = isInteractionBusy || Boolean(state.approvalRecovery);
  const speechRecognitionSupported = getSpeechRecognitionConstructor() !== null;
  const totalMinutes = useMemo(
    () =>
      allPreviewBlocks.reduce(
        (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
        0,
      ),
    [allPreviewBlocks],
  );
  const previewGroups = useMemo(
    () =>
      previewPageDates.map((date) => ({
        date,
        blocks: visibleBlocks.filter((block) => block.date === date),
        existingPlans: sortByDateTime(plans.filter((plan) => plan.date === date)),
      })),
    [plans, previewPageDates, visibleBlocks],
  );
  const displayedDraftCount = allPreviewBlocks.length;
  const activePreviewPageStart = previewPageDates[0] ?? previewDateRange?.startDate ?? '';
  const activePreviewPageEnd =
    previewPageDates[previewPageDates.length - 1] ?? previewDateRange?.endDate ?? '';
  const previewGridColumns = `62px repeat(${Math.max(
    previewGroups.length,
    1,
  )}, minmax(108px, 1fr))`;
  const previewGridMinWidth = 62 + Math.max(previewGroups.length, 1) * 108;
  const visibleChats = useMemo(
    () => searchAiPlanningChats(userId, chatIndex.chats, chatQuery),
    [chatIndex.chats, chatQuery, userId],
  );
  const activeChat =
    chatIndex.chats.find((chat) => chat.id === chatIndex.activeChatId) ??
    chatIndex.chats[0];
  const validatedStarterOptions = useMemo(
    () =>
      buildAiPlanningStarterPromptOptions({
        referenceDate: selectedDate,
        plans,
        todos: starterTodos,
        materials: starterMaterials,
        limit: Number.MAX_SAFE_INTEGER,
      }),
    [plans, selectedDate, starterMaterials, starterTodos],
  );
  const starterPromptOptions = validatedStarterOptions.slice(0, 3);
  const waitingForStarterTarget = Boolean(selectedStarterOption?.target) && starterCatalogStatus !== 'ready';

  // One operation owns OCR, planner submission, and final chat persistence.
  // Revoke it synchronously on navigation/owner changes or unmount.
  useLayoutEffect(() => {
    submission.current = { active: true, ownerId: userId, index: chatIndex, token: null };
    setIsSubmitting(false);
    setIsReadingAttachment(false);
    return () => { submission.current.active = false; submission.current.token = null; };
  }, [userId, chatIndex, cancellationGeneration]);

  function ownsSubmissionScope(): boolean {
    return submission.current.active && submission.current.ownerId === userId
      && submission.current.index === chatIndex
      && (cancellationEpoch?.current ?? 0) === cancellationGeneration;
  }

  function persistActiveChat() {
    return application.chat.checkpoint();
  }

  useEffect(() => { application.chat.initialize(); }, [application.chat, state.pendingTurn, state.pendingApproval]);

  useLayoutEffect(() => {
    recoveryMounted.current = true;
    recoveryOperation.current = null;
    restoredRecovery.current = null;
    setIsRecoveringModule(false);
    setModuleLoadFailed(false);
    setModuleRetryAttempted(false);
    moduleRetryUsed.current = false;
    return () => { recoveryMounted.current = false; recoveryOperation.current = null; };
  }, [userId, chatIndex.activeChatId, cancellationGeneration]);

  const recoveryBinding = application.getModuleRecoveryBinding();
  useEffect(() => {
    const binding = application.getModuleRecoveryBinding();
    if (!binding || !sameAiPlanningModuleRecoveryBinding(binding, recoveryBinding)
      || !recoveryMounted.current || restoredRecovery.current
      || text || imageAttachment || selectedStarterOption || recoveryOperation.current) return;
    try {
      const saved = readAiPlanningModuleRecovery(window.sessionStorage, binding);
      if (!saved) return;
      // Blob URLs are document-local. Restore the original bytes and make a fresh preview.
      const attachment = saved.draft.attachment
        ? { file: saved.draft.attachment, previewUrl: URL.createObjectURL(saved.draft.attachment) } : null;
      restoredRecovery.current = { ...saved, binding };
      setText(saved.draft.text);
      setSelectedStarterOption(saved.draft.selectedStarter);
      setImageAttachment(attachment);
    } catch { setError('一時保存した入力を戻せませんでした。自動送信はしていません。'); }
  }, [application.chat, recoveryBinding?.chatId, recoveryBinding?.conversationId,
    recoveryBinding?.revision, text, imageAttachment, selectedStarterOption]);

  useEffect(() => {
    const restored = restoredRecovery.current;
    if (!restored || !sameAiPlanningModuleRecoveryBinding(restored.binding, application.getModuleRecoveryBinding())
      || text !== restored.draft.text || (imageAttachment?.file ?? null) !== restored.draft.attachment
      || selectedStarterOption !== restored.draft.selectedStarter) return;
    try { consumeAiPlanningModuleRecovery(window.sessionStorage, restored.binding, restored.token); }
    catch { /* The live draft remains intact when storage access is revoked. */ }
  }, [application, text, imageAttachment, selectedStarterOption]);

  async function recoverPlanningModule(reload: boolean) {
    if (!moduleLoadFailed || recoveryOperation.current || isComposerBusy || isListening
      || (!reload && moduleRetryUsed.current)) return;
    const binding = application.getModuleRecoveryBinding();
    if (!binding) return;
    const token = Symbol('module-recovery');
    recoveryOperation.current = token;
    setIsRecoveringModule(true);
    let reloadCheckpoint: ReturnType<WeeklyPlanningApplication['checkpointForModuleReload']> = null;
    const current = () => recoveryMounted.current && recoveryOperation.current === token
      && sameAiPlanningModuleRecoveryBinding(binding, application.getModuleRecoveryBinding())
      && (!reloadCheckpoint || reloadCheckpoint.isCurrent());
    try {
      if (!reload) {
        moduleRetryUsed.current = true;
        setModuleRetryAttempted(true);
        const preparation = await application.prepareTurn();
        if (current()) {
          if (preparation.ready) { setModuleLoadFailed(false); setError(''); }
          else {
            // Readiness revocation did not consume a module-load failure retry.
            moduleRetryUsed.current = false;
            setModuleRetryAttempted(false);
            setError(preparation.reason === 'planner-data-changed'
              ? '学習データが更新されました。確認が終わったら「機能の読み込みを再試行」を押してから、もう一度送信してください。入力内容と画像は保持しています。'
              : '送信前の状態が変わりました。現在の状態を確認し、「機能の読み込みを再試行」を押してから、もう一度送信してください。入力内容と画像は保持しています。');
          }
        }
        return;
      }
      reloadCheckpoint = application.checkpointForModuleReload();
      if (!reloadCheckpoint || !current()) {
        if (current()) setError('会話を安全に保存できませんでした。この画面は更新していません。入力を控えてから再試行してください。');
        return;
      }
      const saved = await saveAiPlanningModuleRecovery({
        storage: window.sessionStorage, binding,
        draft: { text, selectedStarter: selectedStarterOption, attachment: imageAttachment?.file ?? null },
        isCurrent: current,
      });
      if (!current()) return;
      if (!saved) {
        setError('入力や画像を一時保存できないため、画面は更新していません。入力をコピーし、画像を付け直せるようにしてから手動で更新してください。');
        return;
      }
      window.location.reload();
    } catch (failure) {
        if (current()) setError(failure instanceof WeeklyPlanningRuntimeModuleError
        ? failure.message : '安全に画面を更新できませんでした。入力内容はこの画面に保持しています。');
    } finally {
      if (recoveryMounted.current && recoveryOperation.current === token) {
        recoveryOperation.current = null;
        setIsRecoveringModule(false);
      }
    }
  }


  useEffect(() => {
    let cancelled = false;
    setStarterCatalogStatus('loading');

    void Promise.all([
      plannerRepository.getTodos(userId),
      plannerRepository.getStudyMaterials(userId),
    ]).then(
      ([todos, materials]) => {
        if (cancelled) return;
        setStarterTodos(todos);
        setStarterMaterials(materials);
        setStarterCatalogStatus('ready');
      },
      () => {
        if (cancelled) return;
        setStarterTodos([]);
        setStarterMaterials([]);
        setStarterCatalogStatus('failed');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    setPreviewPageIndex(0);
  }, [previewPlanSignature]);

  useEffect(() => {
    const node = conversationRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chatIndex.activeChatId, displayedDraftCount, isBusy, state.messages.length]);

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
    if (!ownsSubmissionScope() || submission.current.token || recoveryOperation.current || isComposerBusy || isListening) return;
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
      setSelectedStarterOption(null);
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

  function preparationRejectionMessage(reason: 'planner-data-changed' | 'request-changed'): string {
    return reason === 'planner-data-changed'
      ? '学習データが更新されました。入力内容を確認して、もう一度送信してください。'
      : '送信前の状態が変わりました。入力内容を確認して、もう一度送信してください。';
  }

  async function submitMessage() {
    const value = text.trim();
    const attachment = imageAttachment;
    if ((!value && !attachment) || isComposerBusy || isListening || !application.plannerDataReady
      || !ownsSubmissionScope() || submission.current.token || recoveryOperation.current || moduleLoadFailed || waitingForStarterTarget) return;
    const token = Symbol('planning-submission');
    submission.current.token = token;
    setIsSubmitting(true);
    const ownsRequest = () => ownsSubmissionScope() && submission.current.token === token;
    try {
      setError('');
      const starter = selectedStarterOption?.requestText === value
        ? validatedStarterOptions.find((option) => option.requestText === value
          && option.target?.kind === selectedStarterOption.target?.kind
          && option.target?.id === selectedStarterOption.target?.id
          && option.target?.label === selectedStarterOption.target?.label
          && option.target?.targetDate === selectedStarterOption.target?.targetDate) ?? null
        : null;
      if (selectedStarterOption?.target && !starter) {
        setError('保存した入力例の参照先を確認できません。入力例を選び直すか、対象がわかる文章に修正してください。');
        return;
      }
      const preparation = await application.prepareTurn();
      if (!ownsRequest()) return;
      if (!preparation.ready) {
        setError(preparationRejectionMessage(preparation.reason));
        return;
      }
      let supplementalContext: string | undefined;

      if (attachment) {
        setIsReadingAttachment(true);
        try {
          const extraction = await extractPlanningImageAttachment(attachment.file);
          if (!ownsRequest()) return;
          supplementalContext = extraction.text;
        } catch (attachmentError) {
          if (!ownsRequest()) return;
          setError(
            attachmentError instanceof Error
              ? attachmentError.message
              : '画像を読み取れませんでした。',
          );
          return;
        } finally {
          if (ownsRequest()) setIsReadingAttachment(false);
        }
      }

      if (!ownsRequest()) return;
      const requestText = starter?.requestText ?? value;
      const submittedText = attachment
        ? buildAiPlanningImageTurn(requestText, attachment.file.name).userText
        : requestText;

      const shouldReleaseComposerFocus = shouldReleaseComposerFocusAfterSubmit();
      setText('');
      if (shouldReleaseComposerFocus) {
        inputRef.current?.blur();
      }

      try {
        const result = await application.submitTurn(
          submittedText,
          supplementalContext,
          starter?.target ?? undefined,
        );
        if (!ownsRequest()) return;
        if (!result.accepted) {
          setText(text);
          setError(preparationRejectionMessage(result.rejectionReason ?? 'request-changed'));
          return;
        }
        clearImageAttachment();
        setSelectedStarterOption(null);
        persistActiveChat();
      } catch (submitError) {
        if (!ownsRequest()) return;
        setText(text);
        if (submitError instanceof WeeklyPlanningRuntimeModuleError) {
          setModuleLoadFailed(true); setModuleRetryAttempted(false); moduleRetryUsed.current = false;
        }
        setError(
          submitError instanceof Error
            ? submitError.message
            : 'メッセージを送信できませんでした。',
        );
        persistActiveChat();
      }
    } catch (preparationError) {
      if (!ownsRequest()) return;
      if (preparationError instanceof WeeklyPlanningRuntimeModuleError) {
        setModuleLoadFailed(true);
        setModuleRetryAttempted(false);
        moduleRetryUsed.current = false;
      }
      setError(preparationError instanceof Error ? preparationError.message : '必要な機能を読み込めませんでした。');
    } finally {
      if (ownsRequest()) {
        submission.current.token = null;
        setIsSubmitting(false);
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

  function useStarterPrompt(option: AiPlanningStarterPromptOption) {
    if (recoveryOperation.current || isComposerBusy) return;
    setText(option.requestText);
    setSelectedStarterOption(option);
  }

  function switchChat(chatId: string) {
    if (!ownsSubmissionScope() || submission.current.token || recoveryOperation.current || isInteractionBusy || isListening || chatId === chatIndex.activeChatId) {
      setIsChatDrawerOpen(false);
      return;
    }
    if (application.chat.select(chatId).status !== 'saved') return;
    submission.current.active = false;
    setText('');
    setSelectedStarterOption(null);
    clearImageAttachment();
    setError('');
    setIsPreviewOpen(false);
    setPreviewPageIndex(0);
    setIsChatDrawerOpen(false);
  }

  function createChat() {
    if (!ownsSubmissionScope() || submission.current.token || recoveryOperation.current || isInteractionBusy || isListening) return;
    if (application.chat.create().status !== 'saved') return;
    submission.current.active = false;
    setChatQuery('');
    setText('');
    setSelectedStarterOption(null);
    clearImageAttachment();
    setError('');
    setIsPreviewOpen(false);
    setPreviewPageIndex(0);
    setIsChatDrawerOpen(false);
  }

  function removeChat(chatId: string) {
    if (!ownsSubmissionScope() || submission.current.token || recoveryOperation.current || isInteractionBusy || isListening) return;
    const chat = chatIndex.chats.find((item) => item.id === chatId);
    if (!chat) return;
    if (!window.confirm(`「${chat.title}」を削除しますか？`)) return;

    const wasActive = chatIndex.activeChatId === chatId;
    if (application.chat.remove(chatId).status !== 'saved') return;
    submission.current.active = false;
    if (wasActive) {
      setText('');
      setSelectedStarterOption(null);
      clearImageAttachment();
      setError('');
      setIsPreviewOpen(false);
      setPreviewPageIndex(0);
    }

  }

  function promotePreview() {
    if (previewCandidates.length === 0 || allPreviewBlocks.length === 0) return;
    const planBlockIds = new Set(allPreviewBlocks.map((block) => block.id));
    const planCandidates = previewCandidates.filter((candidate) =>
      planBlockIds.has(candidate.stableKey),
    );
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: planCandidates,
      userId,
      createdAt: new Date().toISOString(),
    });
    if (blocks.length === 0) return;

    if (pendingDraftBlocks.length > 0) {
      application.clearDraftBlocks();
    }
    application.createDraftBlocks(blocks);
    persistActiveChat();
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

  function closePreviewForAdjustment() {
    setIsPreviewOpen(false);
  }

  return (
    <section ref={viewRef} className="ai-planning-view home-dashboard" aria-label="AI計画">
      <AiPlanningChatSidebar
        open={isChatDrawerOpen}
        checkpointNotice={checkpointNotice}
        chats={visibleChats}
        activeChatId={chatIndex.activeChatId}
        query={chatQuery}
        disabled={isInteractionBusy || isListening}
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
          displayedDraftCount === 0 &&
          !state.pendingTurn ? (
            <div className="ai-planning-starters" aria-label="入力例">
              <p>
                計画したいことをそのまま入力できます。登録内容に合わせた候補からも始められます。
              </p>
              <div className="ai-planning-starter-list">
                {starterPromptOptions.map((option) => (
                  <button
                    key={`${option.displayText}\u0000${option.prompt}`}
                    type="button"
                    onClick={() => useStarterPrompt(option)}
                  >
                    <span>{option.displayText}</span>
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
                  <span>計画案</span>
                  <strong>{displayedDraftCount}件の予定を作成</strong>
                </div>
                <b>{displayedDraftCount}件</b>
              </div>
              <div className="ai-planning-plan-summary">
                <span>
                  <CalendarDays size={16} aria-hidden="true" />対象{' '}
                  {previewDateRange
                    ? `${formatDateLabel(previewDateRange.startDate)} - ${formatDateLabel(
                        previewDateRange.endDate,
                      )}`
                    : '-'}
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
                計画プレビューを確認
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {state.approvalRecovery ? (
            <p className="ai-planning-error" role="status">
              保存の確認が途中です。計画プレビューから保存を再試行してください。確認が終わるまで、この会話の予定は変更できません。
            </p>
          ) : null}
          {!application.plannerDataReady ? (
            <p className="ai-planning-error" role="status">
              学習データを確認しています。入力内容と画像は保持しています。確認後にもう一度送信してください。
            </p>
          ) : null}
          {waitingForStarterTarget ? (
            <p className="ai-planning-error" role="status">
              {starterCatalogStatus === 'loading' ? '入力例の参照先を確認しています。'
                : '入力例の参照先を読み込めませんでした。対象がわかる文章に編集してから送信してください。'}
            </p>
          ) : null}
          {error || moduleLoadFailed ? (
            <div className="ai-planning-error" role="alert">
              {error || '計画に必要な機能を読み込めませんでした。入力内容はこの画面に保持しています。'}
              {moduleLoadFailed ? <div>
                <button type="button" className="ghost-button" disabled={isComposerBusy || moduleRetryAttempted}
                  onClick={() => void recoverPlanningModule(false)}>機能の読み込みを再試行</button>
                <button type="button" className="ghost-button" disabled={isComposerBusy}
                  onClick={() => void recoverPlanningModule(true)}>入力を一時保存して画面を更新</button>
                <p>入力はこのタブに30分間だけ一時保存します。更新後に自動送信はしません。</p>
              </div> : null}
            </div>
          ) : null}
        </div>

        <div className="ai-planning-composer">
          {!isChatDrawerOpen ? checkpointNotice : null}
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
                  disabled={isReadingAttachment || isRecoveringModule}
                  onClick={() => { if (!recoveryOperation.current) clearImageAttachment(); }}
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
            onChange={(event) => {
              if (recoveryOperation.current) return;
              setText(event.target.value);
              if (event.target.value !== selectedStarterOption?.requestText) {
                setSelectedStarterOption(null);
              }
            }}
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
            aria-label={canCancelTurn ? '処理をキャンセル' : '送信'}
            title={canCancelTurn ? '処理をキャンセル' : '送信'}
            disabled={!canCancelTurn && (
              (!text.trim() && !imageAttachment) || isComposerBusy || isListening || !application.plannerDataReady || moduleLoadFailed || waitingForStarterTarget
            )}
            onClick={() => {
              if (canCancelTurn) onCancelPendingTurn?.();
              else void submitMessage();
            }}
          >
            {canCancelTurn ? <X size={20} aria-hidden="true" /> : <Send size={20} aria-hidden="true" />}
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
            aria-label="計画プレビュー"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ai-planning-preview-header">
              <button type="button" onClick={() => setIsPreviewOpen(false)}>
                <X size={18} />閉じる
              </button>
              <div>
                <h2>計画プレビュー</h2>
                <p>
                  {previewDateRange
                    ? `${formatDateLabel(previewDateRange.startDate)} - ${formatDateLabel(
                        previewDateRange.endDate,
                      )}`
                    : '-'}
                </p>
              </div>
              <span>{displayedDraftCount}件</span>
            </header>

            <div
              className="ai-planning-preview-period-nav"
              aria-label="計画期間の表示範囲"
            >
              <button
                type="button"
                aria-label="前の期間を表示"
                disabled={activePreviewPageIndex <= 0}
                onClick={() =>
                  setPreviewPageIndex((current) =>
                    clampAiPlanningPreviewPageIndex(
                      current - 1,
                      previewDatePages.length,
                    ),
                  )
                }
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span>前の7日</span>
              </button>
              <div>
                <strong>
                  {activePreviewPageStart && activePreviewPageEnd
                    ? `${formatDateLabel(activePreviewPageStart)} - ${formatDateLabel(
                        activePreviewPageEnd,
                      )}`
                    : '-'}
                </strong>
                <small>
                  {previewDatePages.length > 0
                    ? `${activePreviewPageIndex + 1} / ${previewDatePages.length}`
                    : '0 / 0'}
                </small>
              </div>
              <button
                type="button"
                aria-label="次の期間を表示"
                disabled={activePreviewPageIndex >= previewDatePages.length - 1}
                onClick={() =>
                  setPreviewPageIndex((current) =>
                    clampAiPlanningPreviewPageIndex(
                      current + 1,
                      previewDatePages.length,
                    ),
                  )
                }
              >
                <span>次の7日</span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="ai-planning-preview-scroll">
              <div
                className="ai-planning-week-grid"
                style={{ minWidth: `${previewGridMinWidth}px` }}
              >
                <div
                  className="ai-planning-week-header"
                  style={{ gridTemplateColumns: previewGridColumns }}
                >
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
                    gridTemplateColumns: previewGridColumns,
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
                onClick={closePreviewForAdjustment}
              >
                {state.approvalRecovery ? '会話に戻る' : 'さらに調整'}
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
                  {state.pendingApproval ? '保存中...' : state.approvalRecovery ? '保存を再試行' : 'この内容で保存'}
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
