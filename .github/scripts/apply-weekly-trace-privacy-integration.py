from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


worker = Path('workers/ai-proxy/src/index.ts')
replace_once(
    worker,
    """} from './modelPolicy';\n\ninterface Env {\n""",
    """} from './modelPolicy';\nimport {\n  handleWeeklyPlanningTraceApi,\n  isWeeklyPlanningTracePath,\n  type WeeklyPlanningTraceApiEnv,\n} from './weeklyPlanningTraceApi';\n\ninterface Env extends WeeklyPlanningTraceApiEnv {\n""",
    'worker trace API import',
)
replace_once(
    worker,
    """    if (pathname === '/__debug/route') {\n      return jsonResponse(request, env, 200, {\n        name: 'studyplanner-ai-proxy',\n        path: pathname,\n        method: request.method,\n        hasOpenAiKey: Boolean(env.OPENAI_API_KEY),\n        hasAiGatewayAccount: Boolean(env.AI_GATEWAY_ACCOUNT_ID),\n        hasAiGatewayId: Boolean(env.AI_GATEWAY_ID),\n        hasGeminiKey: Boolean(env.GEMINI_API_KEY),\n        hasFirebaseWebApiKey: Boolean(env.FIREBASE_WEB_API_KEY),\n      });\n    }\n\n    if (pathname === TIMETABLE_OCR_PATH && request.method !== 'POST') {\n""",
    """    if (pathname === '/__debug/route') {\n      return jsonResponse(request, env, 200, {\n        name: 'studyplanner-ai-proxy',\n        path: pathname,\n        method: request.method,\n        hasOpenAiKey: Boolean(env.OPENAI_API_KEY),\n        hasAiGatewayAccount: Boolean(env.AI_GATEWAY_ACCOUNT_ID),\n        hasAiGatewayId: Boolean(env.AI_GATEWAY_ID),\n        hasGeminiKey: Boolean(env.GEMINI_API_KEY),\n        hasFirebaseWebApiKey: Boolean(env.FIREBASE_WEB_API_KEY),\n        hasTraceHmacSecrets: Boolean(env.WEEKLY_PLANNING_TRACE_HMAC_SECRETS),\n        hasFirestoreServiceAccount: Boolean(\n          env.FIREBASE_PROJECT_ID\n            && env.FIREBASE_SERVICE_ACCOUNT_EMAIL\n            && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY,\n        ),\n      });\n    }\n\n    if (isWeeklyPlanningTracePath(pathname)) {\n      const originError = enforceAllowedOrigin(request, env);\n      if (originError) return originError;\n      const session = await requireVerifiedFirebaseSession(request, env);\n      const result = await handleWeeklyPlanningTraceApi(request, env, session);\n      return jsonResponse(request, env, result.status, result.body);\n    }\n\n    if (pathname === TIMETABLE_OCR_PATH && request.method !== 'POST') {\n""",
    'worker trace API route',
)

api = Path('workers/ai-proxy/src/weeklyPlanningTraceApi.ts')
replace_once(
    api,
    """function safeDocuments(documents: Record<string, unknown>[]): Record<string, unknown>[] {\n  return documents.flatMap((document) => {\n    const redacted = redactWeeklyPlanningTraceValue(document);\n    return isRecord(redacted) ? [redacted] : [];\n  });\n}\n""",
    """function safeDocuments(documents: Record<string, unknown>[]): Record<string, unknown>[] {\n  return documents.flatMap((document) => {\n    const token = typeof document.traceSubjectToken === 'string'\n      ? document.traceSubjectToken\n      : '';\n    const prepared = {\n      ...document,\n      ...(token ? { subjectAlias: `subject-${token.slice(-12)}` } : {}),\n    };\n    delete prepared.traceSubjectToken;\n    delete prepared.traceSubjectEpoch;\n    const redacted = redactWeeklyPlanningTraceValue(prepared);\n    return isRecord(redacted) ? [redacted] : [];\n  });\n}\n""",
    'server admin subject alias',
)

repository = Path('src/features/weeklyPlanning/trace/weeklyPlanningTraceRepository.ts')
replace_once(
    repository,
    """export function resolveWeeklyPlanningTraceEnabled(\n  configuredValue: string | undefined,\n): boolean {\n  return configuredValue !== 'false';\n}\n\nexport function isWeeklyPlanningTraceEnabled(): boolean {\n  return resolveWeeklyPlanningTraceEnabled(\n    import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED,\n  );\n}\n""",
    """export function resolveWeeklyPlanningTraceEnabled(\n  configuredValue: string | undefined,\n  isDevelopment = import.meta.env.DEV,\n): boolean {\n  if (configuredValue === 'true') return true;\n  if (configuredValue === 'false') return false;\n  return isDevelopment;\n}\n\nexport function isWeeklyPlanningTraceEnabled(): boolean {\n  return resolveWeeklyPlanningTraceEnabled(\n    import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED,\n    import.meta.env.DEV,\n  );\n}\n""",
    'trace feature flag safety',
)

runtime = Path('src/features/weeklyPlanning/trace/weeklyPlanningTraceRuntime.ts')
replace_once(
    runtime,
    """import { getFirestoreDb } from '../../../lib/firebaseClient';\n""",
    """import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';\nimport { getFirestoreDb } from '../../../lib/firebaseClient';\n""",
    'runtime proxy config import',
)
replace_once(
    runtime,
    """import {\n  createFirestoreWeeklyPlanningTraceRepository,\n  createLocalWeeklyPlanningTraceRepository,\n  createNoopWeeklyPlanningTraceRepository,\n  isWeeklyPlanningTraceEnabled,\n  serializeWeeklyPlanningTraceWrites,\n  type WeeklyPlanningTraceRepository,\n} from './weeklyPlanningTraceRepository';\n""",
    """import {\n  createFirestoreWeeklyPlanningTraceRepository,\n  createLocalWeeklyPlanningTraceRepository,\n  createNoopWeeklyPlanningTraceRepository,\n  isWeeklyPlanningTraceEnabled,\n  serializeWeeklyPlanningTraceWrites,\n  type WeeklyPlanningTraceRepository,\n} from './weeklyPlanningTraceRepository';\nimport { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';\n""",
    'runtime remote repository import',
)
replace_once(
    runtime,
    """  const firestoreDb = getFirestoreDb();\n  const storageRepository = firestoreDb\n    ? createFirestoreWeeklyPlanningTraceRepository(firestoreDb)\n    : createLocalWeeklyPlanningTraceRepository();\n  repository = serializeWeeklyPlanningTraceWrites(storageRepository);\n""",
    """  if (import.meta.env.PROD) {\n    if (!getCloudflareAiProxyUrl().trim()) {\n      repository = createNoopWeeklyPlanningTraceRepository();\n      return repository;\n    }\n    repository = serializeWeeklyPlanningTraceWrites(\n      createRemoteWeeklyPlanningTraceRepository(),\n    );\n    return repository;\n  }\n  const firestoreDb = getFirestoreDb();\n  const developmentRepository = firestoreDb\n    ? createFirestoreWeeklyPlanningTraceRepository(firestoreDb)\n    : createLocalWeeklyPlanningTraceRepository();\n  repository = serializeWeeklyPlanningTraceWrites(developmentRepository);\n""",
    'runtime production remote selection',
)

rules = Path('firestore.rules')
replace_once(
    rules,
    """    match /weekly_planning_trace_sessions/{sessionId} {\n      allow read: if isAdmin();\n      allow create: if canCreateOwnedResource()\n        && request.resource.data.id == sessionId;\n      allow update: if (\n          canUpdateOwnedResource()\n          && request.resource.data.id == resource.data.id\n          && request.resource.data.userId == resource.data.userId\n          && request.resource.data.logicalConversationId == resource.data.logicalConversationId\n          && request.resource.data.startedAt == resource.data.startedAt\n          && request.resource.data.schemaVersion == resource.data.schemaVersion\n          && request.resource.data.get('archivedAt', null) == resource.data.get('archivedAt', null)\n        ) || (\n          isAdmin()\n          && request.resource.data.archivedAt is string\n          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['archivedAt'])\n        );\n      allow delete: if false;\n    }\n\n    match /weekly_planning_trace_entries/{entryId} {\n      allow read: if isAdmin();\n      allow create: if canCreateOwnedResource()\n        && request.resource.data.id == entryId;\n      allow update: if canUpdateOwnedResource()\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([]);\n      allow delete: if false;\n    }\n""",
    """    match /weekly_planning_trace_sessions/{sessionId} {\n      allow read, write: if false;\n    }\n\n    match /weekly_planning_trace_entries/{entryId} {\n      allow read, write: if false;\n    }\n\n    match /weekly_planning_trace_access_audit/{auditId} {\n      allow read, write: if false;\n    }\n""",
    'deny direct trace access',
)

app = Path('src/App.tsx')
replace_once(
    app,
    """import { useWeeklyPlanningState } from './features/weeklyPlanning/useWeeklyPlanningState';\n""",
    """import { useWeeklyPlanningState } from './features/weeklyPlanning/useWeeklyPlanningState';\nimport { useWeeklyPlanningTracePolicy } from './features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy';\n""",
    'App trace policy import',
)
replace_once(
    app,
    """  const planningUserId = user?.id ?? 'anonymous';\n  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(\n""",
    """  const planningUserId = user?.id ?? 'anonymous';\n  const weeklyPlanningTracePolicy = useWeeklyPlanningTracePolicy(planningUserId);\n  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(\n""",
    'App trace policy hook',
)
replace_once(
    app,
    """              weeklyPlanningPendingApproval={planningState.pendingApproval}\n              onSubmitWeeklyPlanningTurn={submitWeeklyPlanningTurn}\n""",
    """              weeklyPlanningPendingApproval={planningState.pendingApproval}\n              weeklyPlanningTraceConsentStatus={weeklyPlanningTracePolicy.status}\n              weeklyPlanningTraceConsentError={weeklyPlanningTracePolicy.error}\n              onAcceptWeeklyPlanningTracePolicy={weeklyPlanningTracePolicy.accept}\n              onRefreshWeeklyPlanningTracePolicy={weeklyPlanningTracePolicy.refresh}\n              onSubmitWeeklyPlanningTurn={submitWeeklyPlanningTurn}\n""",
    'App trace policy props',
)

quick = Path('src/components/QuickEntryModal.tsx')
replace_once(
    quick,
    """import type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';\n""",
    """import type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';\nimport type { WeeklyPlanningTraceConsentStatus } from '../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy';\n""",
    'QuickEntry trace consent import',
)
replace_once(
    quick,
    """  weeklyPlanningPendingTurn?: WeeklyPlanningPendingTurn;\n  weeklyPlanningPendingApproval?: WeeklyPlanningPendingApproval;\n  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n""",
    """  weeklyPlanningPendingTurn?: WeeklyPlanningPendingTurn;\n  weeklyPlanningPendingApproval?: WeeklyPlanningPendingApproval;\n  weeklyPlanningTraceConsentStatus: WeeklyPlanningTraceConsentStatus;\n  weeklyPlanningTraceConsentError: string;\n  onAcceptWeeklyPlanningTracePolicy: () => Promise<boolean>;\n  onRefreshWeeklyPlanningTracePolicy: () => Promise<void>;\n  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n""",
    'QuickEntry trace consent props',
)
replace_once(
    quick,
    """  weeklyPlanningPendingTurn,\n  weeklyPlanningPendingApproval,\n  onSubmitWeeklyPlanningTurn,\n""",
    """  weeklyPlanningPendingTurn,\n  weeklyPlanningPendingApproval,\n  weeklyPlanningTraceConsentStatus,\n  weeklyPlanningTraceConsentError,\n  onAcceptWeeklyPlanningTracePolicy,\n  onRefreshWeeklyPlanningTracePolicy,\n  onSubmitWeeklyPlanningTurn,\n""",
    'QuickEntry trace consent destructure',
)
replace_once(
    quick,
    """              weeklyPlanningPendingApproval={weeklyPlanningPendingApproval}\n              onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}\n""",
    """              weeklyPlanningPendingApproval={weeklyPlanningPendingApproval}\n              weeklyPlanningTraceConsentStatus={weeklyPlanningTraceConsentStatus}\n              weeklyPlanningTraceConsentError={weeklyPlanningTraceConsentError}\n              onAcceptWeeklyPlanningTracePolicy={onAcceptWeeklyPlanningTracePolicy}\n              onRefreshWeeklyPlanningTracePolicy={onRefreshWeeklyPlanningTracePolicy}\n              onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}\n""",
    'QuickEntry pass trace consent',
)

assistant = Path('src/components/NaturalLanguageAssistant.tsx')
replace_once(
    assistant,
    """import type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';\n""",
    """import type { WeeklyPlanningTurnSubmissionResult } from '../features/weeklyPlanning/weeklyPlanningTurnExecutor';\nimport type { WeeklyPlanningTraceConsentStatus } from '../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy';\n""",
    'assistant trace consent import',
)
replace_once(
    assistant,
    """  weeklyPlanningPendingTurn?: WeeklyPlanningPendingTurn;\n  weeklyPlanningPendingApproval?: WeeklyPlanningPendingApproval;\n  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n""",
    """  weeklyPlanningPendingTurn?: WeeklyPlanningPendingTurn;\n  weeklyPlanningPendingApproval?: WeeklyPlanningPendingApproval;\n  weeklyPlanningTraceConsentStatus: WeeklyPlanningTraceConsentStatus;\n  weeklyPlanningTraceConsentError: string;\n  onAcceptWeeklyPlanningTracePolicy: () => Promise<boolean>;\n  onRefreshWeeklyPlanningTracePolicy: () => Promise<void>;\n  onSubmitWeeklyPlanningTurn: (text: string) => Promise<WeeklyPlanningTurnSubmissionResult>;\n""",
    'assistant trace consent props',
)
replace_once(
    assistant,
    """  weeklyPlanningPendingTurn,\n  weeklyPlanningPendingApproval,\n  onSubmitWeeklyPlanningTurn,\n""",
    """  weeklyPlanningPendingTurn,\n  weeklyPlanningPendingApproval,\n  weeklyPlanningTraceConsentStatus,\n  weeklyPlanningTraceConsentError,\n  onAcceptWeeklyPlanningTracePolicy,\n  onRefreshWeeklyPlanningTracePolicy,\n  onSubmitWeeklyPlanningTurn,\n""",
    'assistant trace consent destructure',
)
replace_once(
    assistant,
    """  const isWeeklyPlanningBusy = Boolean(weeklyPlanningPendingTurn || weeklyPlanningPendingApproval);\n""",
    """  const isWeeklyPlanningBusy = Boolean(weeklyPlanningPendingTurn || weeklyPlanningPendingApproval);\n  const weeklyPlanningTraceConsentGranted =\n    weeklyPlanningTraceConsentStatus === 'accepted'\n    || weeklyPlanningTraceConsentStatus === 'disabled';\n""",
    'assistant trace consent state',
)
replace_once(
    assistant,
    """  const canCreateWeeklyDraft = text.trim().length > 0 && !isWeeklyPlanningBusy;\n""",
    """  const canCreateWeeklyDraft = text.trim().length > 0\n    && !isWeeklyPlanningBusy\n    && weeklyPlanningTraceConsentGranted;\n""",
    'assistant consent submit guard',
)
replace_once(
    assistant,
    """  async function handleCreateWeeklyDrafts(rawText = text) {\n    const trimmedText = rawText.trim();\n\n    if (!trimmedText) {\n""",
    """  async function handleCreateWeeklyDrafts(rawText = text) {\n    const trimmedText = rawText.trim();\n\n    if (!weeklyPlanningTraceConsentGranted) {\n      setError(\n        weeklyPlanningTraceConsentStatus === 'required'\n          ? '週間計画を始める前に、trace利用について確認してください。'\n          : '週間計画traceの利用状態を確認できるまで送信できません。',\n      );\n      return;\n    }\n\n    if (!trimmedText) {\n""",
    'assistant consent handler guard',
)
replace_once(
    assistant,
    """          {renderWeeklyPlanningHistory()}\n\n          {!isWeeklyPlanningBusy ? (\n""",
    """          {renderWeeklyPlanningHistory()}\n\n          {!weeklyPlanningTraceConsentGranted ? (\n            <div className=\"assistant-feedback-card warning\">\n              <strong>週間計画traceの確認</strong>\n              {weeklyPlanningTraceConsentStatus === 'loading' ? (\n                <p className=\"detail-note\">利用状態を確認しています。</p>\n              ) : weeklyPlanningTraceConsentStatus === 'required' ? (\n                <>\n                  <p className=\"detail-note\">\n                    週間計画の品質改善と不具合調査のため、入力内容、内部状態、preview、承認結果を最大180日保存します。\n                    保存前にaccount識別子をserver側でtoken化し、連絡先やtokenなどをredactionします。\n                  </p>\n                  <button\n                    className=\"primary-button\"\n                    onClick={() => void onAcceptWeeklyPlanningTracePolicy()}\n                    type=\"button\"\n                  >\n                    内容を確認して週間計画を使う\n                  </button>\n                </>\n              ) : (\n                <>\n                  <p className=\"detail-note\">\n                    {weeklyPlanningTraceConsentError || '利用状態を確認できませんでした。'}\n                  </p>\n                  <button\n                    className=\"ghost-button\"\n                    onClick={() => void onRefreshWeeklyPlanningTracePolicy()}\n                    type=\"button\"\n                  >\n                    状態を再確認\n                  </button>\n                </>\n              )}\n            </div>\n          ) : !isWeeklyPlanningBusy ? (\n""",
    'assistant consent UI',
)

controls_test = Path('src/components/NaturalLanguageAssistant.weeklyPlanningControls.test.tsx')
replace_once(
    controls_test,
    """        weeklyPlanningRevision={0}\n        onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}\n""",
    """        weeklyPlanningRevision={0}\n        weeklyPlanningTraceConsentStatus=\"accepted\"\n        weeklyPlanningTraceConsentError=\"\"\n        onAcceptWeeklyPlanningTracePolicy={async () => true}\n        onRefreshWeeklyPlanningTracePolicy={async () => undefined}\n        onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}\n""",
    'assistant test consent fixtures',
)
replace_once(
    controls_test,
    """  it('connects clear conversation and explicit cancellation as separate operations', () => {\n""",
    """  it('requires explicit trace acceptance before weekly planning submission', async () => {\n    const onAcceptWeeklyPlanningTracePolicy = vi.fn(async () => true);\n    const required = renderAssistant({\n      weeklyPlanningTraceConsentStatus: 'required',\n      onAcceptWeeklyPlanningTracePolicy,\n    });\n\n    expect(required.renderer.root.findAllByProps({\n      placeholder: '例: 来週、計算理論と英語を少しずつ進めたい',\n    })).toHaveLength(0);\n    const acceptButton = required.renderer.root.findAllByType('button').find(\n      (button) => button.children.join('') === '内容を確認して週間計画を使う',\n    );\n    expect(acceptButton).toBeDefined();\n    await act(async () => {\n      acceptButton?.props.onClick();\n      await Promise.resolve();\n    });\n    expect(onAcceptWeeklyPlanningTracePolicy).toHaveBeenCalledTimes(1);\n    expect(required.onSubmitWeeklyPlanningTurn).not.toHaveBeenCalled();\n  });\n\n  it('connects clear conversation and explicit cancellation as separate operations', () => {\n""",
    'assistant consent regression',
)

repository_test = Path('src/features/weeklyPlanning/trace/weeklyPlanningTraceRepository.test.ts')
replace_once(
    repository_test,
    """describe('resolveWeeklyPlanningTraceEnabled', () => {\n  it('enables tracing by default and supports explicit opt-out', () => {\n    expect(resolveWeeklyPlanningTraceEnabled(undefined)).toBe(true);\n    expect(resolveWeeklyPlanningTraceEnabled('')).toBe(true);\n    expect(resolveWeeklyPlanningTraceEnabled('true')).toBe(true);\n    expect(resolveWeeklyPlanningTraceEnabled('false')).toBe(false);\n  });\n});\n""",
    """describe('resolveWeeklyPlanningTraceEnabled', () => {\n  it('defaults to development only and requires explicit production opt-in', () => {\n    expect(resolveWeeklyPlanningTraceEnabled(undefined, true)).toBe(true);\n    expect(resolveWeeklyPlanningTraceEnabled('', true)).toBe(true);\n    expect(resolveWeeklyPlanningTraceEnabled(undefined, false)).toBe(false);\n    expect(resolveWeeklyPlanningTraceEnabled('', false)).toBe(false);\n    expect(resolveWeeklyPlanningTraceEnabled('true', false)).toBe(true);\n    expect(resolveWeeklyPlanningTraceEnabled('false', true)).toBe(false);\n  });\n});\n""",
    'trace flag test',
)

print('weekly planning trace privacy integration applied')
