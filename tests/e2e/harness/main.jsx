import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AuthScreen } from '../../../src/components/AuthScreen';
import { QuickEntryModal } from '../../../src/components/QuickEntryModal';
import '../../../src/styles.css';

window.__quickEntryEvents = [];

function record(type, payload = null) {
  window.__quickEntryEvents.push({ type, payload });
}

const params = new URLSearchParams(window.location.search);
const gatedOperations = new Set(
  (params.get('gate') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const gateQueues = new Map();

function waitForGate(type) {
  if (!gatedOperations.has(type)) {
    return Promise.resolve();
  }

  record('await-gate', { type });
  return new Promise((resolve) => {
    const queue = gateQueues.get(type) ?? [];
    queue.push(resolve);
    gateQueues.set(type, queue);
  });
}

window.__quickEntryHarness = {
  release(type) {
    const queue = gateQueues.get(type) ?? [];
    const resolve = queue.shift();
    gateQueues.set(type, queue);
    if (!resolve) {
      return false;
    }
    record('release-gate', { type });
    resolve();
    return true;
  },
  pending(type) {
    return (gateQueues.get(type) ?? []).length;
  },
};

const scenario = params.get('scenario') ?? (params.get('weekly') === '1' ? 'weekly' : 'manual');
const hasWeeklySession = [
  'weekly',
  'weekly-turn-preview',
  'preview',
  'draft',
].includes(scenario);

const initialWeeklyMessages = hasWeeklySession
  ? [{
      id: 'assistant-seed',
      role: 'assistant',
      content: '週間計画の条件を教えてください。',
      createdAt: '2026-08-13T07:00:00.000Z',
    }]
  : [];

const previewCandidate = {
  stableKey: 'browser-preview-math',
  date: '2026-08-18',
  startTime: '19:00',
  endTime: '20:00',
  durationMinutes: 60,
  title: '数学のワーク',
  field: '数学',
  year: 0,
  estimatedMinutes: 60,
  source: 'weekly_exam_prep',
  approvalStatus: 'unapproved',
  workItemKey: 'math-work',
  stableV5Metadata: {
    runtime: 'stable_v5',
    conversationId: 'browser-conversation',
    graphRevision: 7,
    taskId: 'task:math-work',
    sourceFactRefs: ['fact:math-work-duration'],
    planType: 'study',
  },
};

const draftBlock = {
  id: 'browser-draft-math',
  userId: 'browser-test-user',
  date: '2026-08-18',
  startTime: '19:00',
  endTime: '20:00',
  title: '数学のワーク',
  subject: '数学',
  type: 'study',
  label: '数学',
  materialId: null,
  memo: '',
  source: 'ai',
  status: 'draft',
  userEdited: false,
  createdAt: '2026-08-13T07:00:00.000Z',
  updatedAt: '2026-08-13T07:00:00.000Z',
};

const linkablePlan = {
  id: 'browser-plan-english',
  seriesId: 'browser-plan-english',
  userId: 'browser-test-user',
  title: '英語の復習',
  subject: '英語',
  date: '2026-08-13',
  startTime: '19:00',
  endTime: '19:45',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [],
  type: 'study',
  memo: '',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

const recordedActual = {
  id: 'browser-actual-english',
  userId: 'browser-test-user',
  planId: linkablePlan.id,
  occurrenceDate: '2026-08-13',
  actualStartTime: '19:00',
  actualEndTime: '19:45',
  title: '英語の復習',
  subject: '英語',
  isAlignedToPlan: true,
  note: '',
  updatedAt: '2026-08-13T08:00:00.000Z',
};

const scenarioPlans = scenario === 'linked-actual' || scenario === 'recorded-actual'
  ? [linkablePlan]
  : [];
const scenarioActuals = scenario === 'recorded-actual' ? [recordedActual] : [];

function AuthHarness() {
  return (
    <AuthScreen
      notice={null}
      onDismissNotice={() => record('auth-dismiss-notice')}
      accessGateEnabled={false}
      accessGateUnlocked
      onUnlockAccessGate={(key) => {
        record('auth-unlock', { key });
        return false;
      }}
      onSignUpWithPassword={async (email, password, username) => {
        record('auth-sign-up', { email, password, username });
        return false;
      }}
      onSignInWithPassword={async (email, password) => {
        record('auth-sign-in', { email, password });
      }}
      onSignInWithGoogle={async () => {
        record('auth-google-sign-in');
      }}
      onSendPasswordReset={async (email) => {
        record('auth-password-reset', { email });
      }}
    />
  );
}

function Harness() {
  const [open, setOpen] = useState(true);
  const [weeklyMessages, setWeeklyMessages] = useState(initialWeeklyMessages);
  const [previewCandidates, setPreviewCandidates] = useState(
    scenario === 'preview' ? [previewCandidate] : [],
  );
  const [draftBlocks, setDraftBlocks] = useState(
    scenario === 'draft' ? [draftBlock] : [],
  );
  const [pendingTurn, setPendingTurn] = useState(undefined);
  const [pendingApproval, setPendingApproval] = useState(undefined);
  const [revision, setRevision] = useState(0);
  const activeWeeklyRequestRef = useRef(null);
  const activeApprovalRef = useRef(null);
  const weeklyRequestSequenceRef = useRef(0);
  const approvalSequenceRef = useRef(0);

  async function submitWeeklyTurn(text) {
    weeklyRequestSequenceRef.current += 1;
    const sequence = weeklyRequestSequenceRef.current;
    const requestId = `browser-request-${sequence}`;
    activeWeeklyRequestRef.current = requestId;
    record('submit-weekly-turn', { text, requestId });
    setPendingTurn({
      conversationId: 'browser-conversation',
      turnId: `browser-turn-${sequence}`,
      requestId,
      weekStartDate: '2026-08-10',
      baseRevision: revision,
      startedAt: new Date().toISOString(),
    });
    setWeeklyMessages((current) => [
      ...current,
      {
        id: `user-${sequence}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      },
    ]);

    await waitForGate('weekly');

    if (activeWeeklyRequestRef.current !== requestId) {
      record('ignore-weekly-turn', { text, requestId });
      return { accepted: false, draftCandidates: [] };
    }

    const draftCandidates = scenario === 'weekly-turn-preview' ? [previewCandidate] : [];
    activeWeeklyRequestRef.current = null;
    setPendingTurn(undefined);
    setRevision((current) => current + 1);
    if (draftCandidates.length > 0) {
      setPreviewCandidates(draftCandidates);
    }
    setWeeklyMessages((current) => [
      ...current,
      {
        id: `assistant-${requestId}`,
        role: 'assistant',
        content: `ブラウザ応答: ${text}`,
        createdAt: new Date().toISOString(),
      },
    ]);
    record('complete-weekly-turn', { text, requestId, draftCandidateCount: draftCandidates.length });
    return { accepted: true, draftCandidates };
  }

  async function approveDrafts() {
    approvalSequenceRef.current += 1;
    const requestId = `browser-approval-${approvalSequenceRef.current}`;
    activeApprovalRef.current = requestId;
    record('approve-drafts', { requestId });
    setPendingApproval({
      requestId,
      weekStartDate: '2026-08-10',
      baseRevision: revision,
      blockIds: draftBlocks.map((block) => block.id),
      startedAt: new Date().toISOString(),
    });

    await waitForGate('approval');

    if (activeApprovalRef.current !== requestId) {
      record('ignore-approval', { requestId });
      return;
    }

    activeApprovalRef.current = null;
    setPendingApproval(undefined);
    setDraftBlocks([]);
    setRevision((current) => current + 1);
    record('complete-approval', { requestId });
  }

  if (!open) {
    return (
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          モーダルを再度開く
        </button>
      </main>
    );
  }

  return (
    <QuickEntryModal
      userId="browser-test-user"
      selectedDate="2026-08-13"
      plans={scenarioPlans}
      actuals={scenarioActuals}
      materials={[]}
      subjects={[]}
      weeklyDraftBlocks={draftBlocks}
      weeklyPlanningPreviewCandidates={previewCandidates}
      weeklyPlanningMessages={weeklyMessages}
      weeklyPlanningIntakeState={null}
      weeklyPlanningWeekStartDate="2026-08-10"
      weeklyPlanningRevision={revision}
      weeklyPlanningPendingTurn={pendingTurn}
      weeklyPlanningPendingApproval={pendingApproval}
      onSubmitWeeklyPlanningTurn={submitWeeklyTurn}
      onCancelWeeklyPlanningTurn={() => {
        record('cancel-weekly-turn');
        activeWeeklyRequestRef.current = null;
        setPendingTurn(undefined);
        return true;
      }}
      onClearWeeklyPlanningConversation={() => {
        record('clear-weekly-conversation');
        setWeeklyMessages([]);
        return true;
      }}
      onAppendWeeklyPlanningMessage={(message) => {
        record('append-weekly-message', message);
        setWeeklyMessages((current) => [...current, message]);
      }}
      onResetWeeklyPlanningSession={() => {
        record('reset-weekly-session');
        activeWeeklyRequestRef.current = null;
        activeApprovalRef.current = null;
        setPendingTurn(undefined);
        setPendingApproval(undefined);
        setPreviewCandidates([]);
        setDraftBlocks([]);
        setWeeklyMessages([]);
      }}
      onCreateWeeklyDraftBlocks={(blocks) => {
        record('create-weekly-draft-blocks', blocks);
        setDraftBlocks(blocks);
        setPreviewCandidates([]);
      }}
      onRemoveWeeklyPlanningPreviewCandidate={(candidateId) => {
        record('remove-preview', candidateId);
        setPreviewCandidates((current) => current.filter((candidate) => candidate.stableKey !== candidateId));
      }}
      onRemoveWeeklyDraftBlock={(blockId) => {
        record('remove-draft', blockId);
        setDraftBlocks((current) => current.filter((block) => block.id !== blockId));
      }}
      onClearWeeklyDraftBlocks={() => {
        record('clear-drafts');
        setDraftBlocks([]);
        setPreviewCandidates([]);
      }}
      onApproveWeeklyDraftBlocks={approveDrafts}
      onClose={() => {
        record('close');
        setOpen(false);
      }}
      onSaveTodo={async (draft) => {
        record('save-todo', draft);
        await waitForGate('save-todo');
        record('complete-save-todo');
      }}
      onSavePlan={async (draft) => {
        record('save-plan', draft);
        await waitForGate('save-plan');
        record('complete-save-plan');
      }}
      onSaveStandaloneActual={async (draft) => {
        record('save-actual', draft);
        await waitForGate('save-actual');
        record('complete-save-actual');
      }}
      onSaveLinkedActual={async (plan, draft) => {
        record('save-linked-actual', { plan, draft });
        await waitForGate('save-linked-actual');
        record('complete-save-linked-actual');
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  scenario === 'auth' ? <AuthHarness /> : <Harness />,
);
