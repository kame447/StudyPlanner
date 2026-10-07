import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLatestWeeklyPlanningTurnMeasurement,
  getWeeklyPlanningTurnMeasurements,
} from './application/weeklyPlanningTurnMeasurement';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './application/weeklyPlanningStableV5RuntimeSession';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from './application/weeklyPlanningStableV5SessionCodec';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from './intake/weeklyPlanningQuestionPresentation';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from './testUtils/weeklyPlanningApplicationTestHarness';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedConversation,
  type ScriptedProviderCall,
  type ScriptedProviderReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import type { WeeklyPlanningConversationArchitecture } from './weeklyPlanningConversationArchitecture';
import {
  setWeeklyPlanningArchitecturePreference,
  WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY,
} from './weeklyPlanningConversationArchitecturePreference';

/*
 * Dual-mode A/B tests (Issue #488 comparison switch). The SAME fixture and scripted provider
 * run under `legacy_v5` and `interaction_v1`; the controller, runtime, validators, renderer
 * client and reducer are real in both. The legacy expectations are the pre-#488 behaviour
 * (see weeklyPlanningConversationArchitectureOracle.test.ts for the ee07697e-derived oracle of
 * schema/prompt/binding; here the control flow is exercised end to end).
 */
// Full turns through the real runtime: the first one pays the cold module import, which can exceed
// the 5s default when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

const MODES: readonly WeeklyPlanningConversationArchitecture[] = ['legacy_v5', 'interaction_v1'];
const MATH_SETUP = '来週、数学の問題集を20問進めたい';
const TWO_TASK_SETUP = '来週、英語の長文を10ページと、数学の問題を20問やりたい。数学は1問5分';

type Json = Record<string, unknown>;

function emptyDocument(mode: WeeklyPlanningConversationArchitecture, overrides: Json = {}): Json {
  const document: Json = {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null, tasks: [],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], ...overrides,
  };
  // The legacy provider contract has no conversationActs; a legacy model never emits them.
  if (mode === 'legacy_v5') delete document.conversationActs;
  else document.conversationActs ??= [];
  return document;
}

function workload(localId: string, amount: number, unitCode: string, unitLabel: string, sourceText: string): Json {
  return {
    localId, quantityRole: 'target', amount, unitCode, unitLabel,
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText,
  };
}

function studyTask(params: {
  localId: string; title: string; activityKind: string; workloads: Json[]; effortEstimates?: Json[]; sourceText: string;
}): Json {
  return {
    localId: params.localId, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: params.title,
    study: { purpose: 'self_study', activityKind: params.activityKind, contextLabel: null, components: [] },
    workloads: params.workloads, effortEstimates: params.effortEstimates ?? [], temporalConstraints: [],
    recurrence: [], durableContextSignals: [], sourceText: params.sourceText,
  };
}

function setupDocument(mode: WeeklyPlanningConversationArchitecture, userText: string): Json {
  const window = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
  if (userText === TWO_TASK_SETUP) {
    return emptyDocument(mode, {
      planningIntent: 'create_plan',
      planningWindow: window,
      tasks: [
        studyTask({
          localId: 't-english', title: '英語の長文', activityKind: 'reading',
          workloads: [workload('wl-english', 10, 'page', 'ページ', '英語の長文を10ページ')], sourceText: '英語の長文を10ページ',
        }),
        studyTask({
          localId: 't-math', title: '数学の問題', activityKind: 'problem_solving',
          workloads: [workload('wl-math', 20, 'problem', '問', '数学の問題を20問')],
          effortEstimates: [{
            localId: 'e-math', targetLocalId: 'wl-math', kind: 'duration_per_unit', minutes: 5,
            unitCode: 'problem', precision: 'exact', sourceText: '数学は1問5分',
          }],
          sourceText: '数学の問題を20問',
        }),
      ],
    });
  }
  return emptyDocument(mode, {
    planningIntent: 'create_plan',
    planningWindow: window,
    tasks: [studyTask({
      localId: 't-math', title: '数学の問題集', activityKind: 'problem_solving',
      workloads: [workload('wl-math', 20, 'problem', '問', '数学の問題集を20問')], sourceText: '数学の問題集を20問進めたい',
    })],
  });
}

/** A typed conversation act (interaction_v1): discourse metadata, no quoted evidence. */
function act(kind: string, targetPublicId: string | null = null): Json {
  return { kind, targetPublicId };
}

function focusedFallback(): string {
  return JSON.stringify({
    decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null,
  });
}

function userTextOf(call: ScriptedProviderCall): string {
  return String(call.payload?.userText ?? call.payload?.currentUserText ?? '');
}

function summaryOf(call: ScriptedProviderCall): Json {
  const summary = call.payload?.publicStateSummary;
  return typeof summary === 'object' && summary !== null ? summary as Json : {};
}

function taskId(call: ScriptedProviderCall, title: string): string {
  const tasks = summaryOf(call).tasks;
  const task = Array.isArray(tasks) ? tasks.find((entry) => (entry as Json).title === title) as Json | undefined : undefined;
  if (!task || typeof task.publicId !== 'string') throw new Error(`missing task ${title}`);
  return task.publicId;
}

type Script = (call: ScriptedProviderCall) => ScriptedProviderReply | undefined;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let script: Script;
let currentMode: WeeklyPlanningConversationArchitecture = 'interaction_v1';
let storage: ReturnType<typeof createMemoryStorageHarness>;
let restoreStorage: () => void;

function defaultReply(call: ScriptedProviderCall): ScriptedProviderReply {
  if (call.kind === 'renderer') return 'renderer unavailable in fixture';
  if (call.kind === 'semantic_focused_contextual') return focusedFallback();
  if (call.kind === 'semantic_generic') {
    const text = userTextOf(call);
    return JSON.stringify(text === MATH_SETUP || text === TWO_TASK_SETUP
      ? setupDocument(currentMode, text)
      : emptyDocument(currentMode));
  }
  return 'unexpected fixture call';
}

beforeEach(() => {
  resetScriptedConversationRuntime();
  script = () => undefined;
  provider = installScriptedWeeklyPlanningProvider((call) => script(call) ?? defaultReply(call));
  storage = createMemoryStorageHarness();
  restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
});

afterEach(() => {
  provider.restore();
  restoreStorage();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

function conversationIn(
  mode: WeeklyPlanningConversationArchitecture,
  extra: Partial<Parameters<typeof createScriptedConversation>[0]> = {},
): ScriptedConversation {
  currentMode = mode;
  return createScriptedConversation({ provider, architecture: mode, ...extra });
}

function latestAssistant(conversation: ScriptedConversation) {
  const messages = conversation.getState().messages;
  return messages[messages.length - 1]!;
}

function freshness(conversation: ScriptedConversation) {
  const state = conversation.getState();
  return resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: state.intakeState,
    inputStateRevision: state.revision,
    messages: state.messages,
    graphRevision: conversation.graph()?.revision ?? -1,
  });
}

function pendingTarget(conversation: ScriptedConversation) {
  const context = conversation.getState().intakeState?.lastQuestionContext;
  return { targetSlot: context?.targetSlot, topicId: context?.topicId, actionId: context?.actionId };
}

function kinds(calls: ScriptedProviderCall[]): string[] {
  return calls.map((call) => call.kind);
}

/** Sort object keys only; array order, prose, schema and unknown request fields remain significant. */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}

function requestHashes(calls: ScriptedProviderCall[]) {
  return calls.map((call) => {
    const request = {
      ...call.request,
      messages: call.messages.map((message) => {
        // JSON user payloads have the same key-order normalization as the outer body.
        // Free-form system/user text is kept byte-for-byte; nothing is redacted or dropped.
        try {
          const parsed: unknown = JSON.parse(message.content);
          if (parsed !== null && typeof parsed === 'object') {
            return { ...message, content: JSON.stringify(canonicalJson(parsed)) };
          }
        } catch { /* Plain prose is not JSON. */ }
        return message;
      }),
    };
    return {
      kind: call.kind,
      sha256: createHash('sha256').update(JSON.stringify(canonicalJson(request))).digest('hex'),
    };
  });
}

// These full-request fingerprints characterize this scripted fixture on the current branch.
// They complement (never replace or rebaseline) the independently derived ee07697e oracle.
// Review the actual request diff before changing a fingerprint; prose quality is not an oracle.

describe.each(MODES)('provider contract under %s', (mode) => {
  it('sends the schema and prompt of its architecture on the first semantic call', async () => {
    const conversation = conversationIn(mode);
    const turn = await conversation.submit(MATH_SETUP);
    const generic = turn.calls.find((call) => call.kind === 'semantic_generic')!;
    const system = generic.messages.find((message) => message.role === 'system')!.content;
    const hasActs = mode === 'interaction_v1';
    expect(generic.schemaProperties.includes('conversationActs')).toBe(hasActs);
    expect(system.includes('conversationActs')).toBe(hasActs);
    expect(conversation.getState().conversationArchitecture).toBe(mode);
  });
});

describe('A. explanation under a pending effort question', () => {
  async function explain(mode: WeeklyPlanningConversationArchitecture) {
    script = () => undefined;
    const conversation = conversationIn(mode);
    await conversation.submit(MATH_SETUP);
    const graphBefore = structuredClone(conversation.graph());
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument(mode, mode === 'interaction_v1'
          ? { conversationActs: [act('ask_about_pending_question')] }
          : {}));
      }
      if (call.kind === 'renderer') return scriptedRendererReply(call, '時間が分かると配分できます。1問あたり何分くらいかかりますか？');
      return undefined;
    };
    const turn = await conversation.submit('なんで時間が必要？');
    return { conversation, turn, graphBefore };
  }

  it('legacy: no typed outcome, the empty delta triggers the historical completeness retries', async () => {
    const { turn, conversation } = await explain('legacy_v5');
    expect(requestHashes(turn.calls)).toMatchInlineSnapshot(`
      [
        {
          "kind": "semantic_focused_contextual",
          "sha256": "28eb3d29053228bd5593bc067056740ad09ffd26e5665dfe667d96da9e2f9d4d",
        },
        {
          "kind": "semantic_generic",
          "sha256": "88ead82c5610affb0877ccf0ae0d23b3db199337ae972c25423c9240b7f7e63f",
        },
        {
          "kind": "semantic_generic",
          "sha256": "7776baf302f892b418634b06e78ee5492dfe0c0e7965dbcbe3b88803e68e17a0",
        },
        {
          "kind": "semantic_generic",
          "sha256": "e9933bd772179ef312042957634cf3b67c6a2aa9acc4395ea5bb2010fd97505c",
        },
        {
          "kind": "renderer",
          "sha256": "e2b0cdd979ebad96fe2bbfd8597d0f9a74ae51b19d0f784a4e09a8ff3f03802b",
        },
      ]
    `);
    // The historical retry contract, identical to ee07697e on this fixture.
    expect(kinds(turn.calls)).toEqual([
      'semantic_focused_contextual', 'semantic_generic', 'semantic_generic', 'semantic_generic', 'renderer',
    ]);
    expect(turn.result?.interactionOutcome).toBeUndefined();
    const renderer = turn.calls.find((call) => call.kind === 'renderer');
    const decision = renderer?.payload?.applicationDecision as Json;
    expect(decision).not.toHaveProperty('conversationOutcome');
    expect(decision).not.toHaveProperty('communication');
    // The renderer receives the raw message and decides "explain" itself (pre-#488).
    expect(renderer?.payload?.currentUserMessage).toBe('なんで時間が必要？');
    expect(String(renderer?.payload?.request)).toContain('currentUserMessageが直前の質問の意味');
    expect(latestAssistant(conversation).content).toContain('何分くらい');
  });

  it('interaction: typed explanation, one semantic call, no retry, same question re-presented', async () => {
    const { turn, conversation, graphBefore } = await explain('interaction_v1');
    expect(requestHashes(turn.calls)).toMatchInlineSnapshot(`
      [
        {
          "kind": "semantic_focused_contextual",
          "sha256": "f008ff824889824d4538dd538d58ae9af0c775c3d2abb215b9fdc2078aa1fe28",
        },
        {
          "kind": "semantic_generic",
          "sha256": "a397b81bafe9d62bf1f9e4c36a787afcf4cd863748eebd0bb686a36a5ec4da2b",
        },
        {
          "kind": "renderer",
          "sha256": "7190146dedcd473706320bc37347f4279638bd541bc63b021bcda981131c941c",
        },
      ]
    `);
    expect(kinds(turn.calls)).toEqual(['semantic_focused_contextual', 'semantic_generic', 'renderer']);
    expect(turn.result?.interactionOutcome).toMatchObject({ kind: 'explain_pending_question' });
    const renderer = turn.calls.find((call) => call.kind === 'renderer');
    expect(renderer?.payload?.applicationDecision).toMatchObject({
      communication: { goal: 'explain_question', askQuestion: true },
    });
    expect(conversation.graph()!.revision).toBe(graphBefore!.revision);
    expect(freshness(conversation).status).toBe('fresh');
  });

  it('interaction spends strictly fewer provider calls than legacy on the same explanation', async () => {
    const legacy = await explain('legacy_v5');
    resetScriptedConversationRuntime();
    const interaction = await explain('interaction_v1');
    expect(interaction.turn.calls.length).toBeLessThan(legacy.turn.calls.length);
    const legacyHashes = requestHashes(legacy.turn.calls);
    const interactionHashes = requestHashes(interaction.turn.calls);
    // Semantic and renderer contracts are mode-specific. The focused question request differs
    // only by the interaction-only instruction appended to its system prompt (fall back when
    // the message also carries a conversation act); everything else in it is shared.
    for (const kind of ['semantic_focused_contextual', 'semantic_generic', 'renderer']) {
      expect(interactionHashes.find((entry) => entry.kind === kind)?.sha256)
        .not.toBe(legacyHashes.find((entry) => entry.kind === kind)?.sha256);
    }
    const [legacyFocused] = legacy.turn.calls;
    const [interactionFocused] = interaction.turn.calls;
    expect(interactionFocused.messages).toHaveLength(legacyFocused.messages.length);
    const differing = interactionFocused.messages.filter((message, index) => {
      const historical = legacyFocused.messages[index];
      expect(message.role).toBe(historical.role);
      expect(message.content.startsWith(historical.content)).toBe(true);
      return message.content !== historical.content;
    });
    expect(differing.map((message) => message.role)).toEqual(['system']);
    expect({ ...interactionFocused.request, messages: null }).toEqual({ ...legacyFocused.request, messages: null });
  });
});

describe('C. semantic failure under a pending question', () => {
  async function fail(mode: WeeklyPlanningConversationArchitecture) {
    const conversation = conversationIn(mode);
    await conversation.submit(MATH_SETUP);
    const pending = pendingTarget(conversation);
    const graphBefore = structuredClone(conversation.graph());
    script = (call) => (call.kind === 'semantic_generic' ? 'not a semantic document' : undefined);
    const turn = await conversation.submit('ちょっとよく分からない');
    return { conversation, turn, pending, graphBefore };
  }

  it('legacy: fixed terminal wording asking an unrelated generic question; question not re-presented', async () => {
    const { conversation, turn } = await fail('legacy_v5');
    expect(requestHashes(turn.calls)).toMatchInlineSnapshot(`
      [
        {
          "kind": "semantic_focused_contextual",
          "sha256": "0c6a4dc9e611788e1ba76745939e6f6e2a0dc95fe5901f43dda2cf6f5a0f7532",
        },
        {
          "kind": "semantic_generic",
          "sha256": "508457aa845e4ccd7c6985012c6733d38da5b68e17a8b3baf809fffcfdb0b6ec",
        },
        {
          "kind": "semantic_generic",
          "sha256": "532b7f0eba3ef48643c01a80b1a3c6dd53dab2850f030212d4c5ed63fde49a39",
        },
      ]
    `);
    expect(turn.result?.interactionOutcome).toBeUndefined();
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    const message = latestAssistant(conversation).content;
    expect(message).toContain('まず、いつの予定を作るか、または何を進めるかを一つだけ教えてください。');
    expect(message).not.toContain('確認中の質問は変わりません');
    // The failed turn is a later message than the question: it is no longer the latest presentation.
    expect(freshness(conversation).status).not.toBe('fresh');
  });

  it('interaction: same pending question re-presented, question fresh, nothing authoritative changed', async () => {
    const { conversation, turn, pending, graphBefore } = await fail('interaction_v1');
    expect(requestHashes(turn.calls)).toMatchInlineSnapshot(`
      [
        {
          "kind": "semantic_focused_contextual",
          "sha256": "b6104ae675c851319006f6fdf71e9b8efe6f9e6724257bf7b2ac9f53ad9a6a52",
        },
        {
          "kind": "semantic_generic",
          "sha256": "abb0081bbba89cbf4d28f9cc4089ec43ee6790f300c4c16bdc793b277fcfaf24",
        },
        {
          "kind": "semantic_generic",
          "sha256": "853b31a4d8155bc0452312239c7f0aeba815d2e41d6d310d14e9202998df7739",
        },
        {
          "kind": "renderer",
          "sha256": "cab425990bf179a2b8df4d30ad21455365690083f4db057b47a43b45fddae7eb",
        },
      ]
    `);
    expect(turn.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'semantic', representedQuestion: true });
    // The recovery is rendered from the typed outcome like any reply (no fixed paragraph).
    expect(turn.calls.find((call) => call.kind === 'renderer')?.payload?.applicationDecision).toMatchObject({
      communication: { goal: 'clarify_turn', askQuestion: true },
    });
    const message = latestAssistant(conversation).content;
    expect(message).not.toMatch(/予定条件|安全に整理|確認中の質問|反映していません/u);
    expect(message).not.toContain('まず、いつの予定を作るか');
    expect(conversation.graph()).toEqual(graphBefore);
    expect(pendingTarget(conversation)).toEqual(pending);
    expect(freshness(conversation).status).toBe('fresh');
  });
});

describe('B. aside followed by a short reply', () => {
  async function aside(mode: WeeklyPlanningConversationArchitecture) {
    const conversation = conversationIn(mode);
    await conversation.submit(TWO_TASK_SETUP);
    const english = pendingTarget(conversation);
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument(mode, mode === 'interaction_v1'
          ? { conversationActs: [act('topic_shift', taskId(call, '数学の問題'))] }
          : {}));
      }
      return undefined;
    };
    const asideTurn = await conversation.submit('ちょっと数学の話をしたい');
    const questionAfterAside = structuredClone(conversation.getState().intakeState?.lastQuestionContext);
    script = () => undefined;
    const shortReply = await conversation.submit('うん');
    return { conversation, english, asideTurn, questionAfterAside, shortReply };
  }

  it('legacy: every committed turn rebinds the pending question, so the aside re-arms it for "うん"', async () => {
    const { english, asideTurn, questionAfterAside, shortReply } = await aside('legacy_v5');
    expect({ aside: requestHashes(asideTurn.calls), shortReply: requestHashes(shortReply.calls) }).toMatchInlineSnapshot(`
      {
        "aside": [
          {
            "kind": "semantic_focused_contextual",
            "sha256": "0876e1a7a280a06b853f97822db4f02f2297acd572670605ff0169f4c192e4bf",
          },
          {
            "kind": "semantic_generic",
            "sha256": "2d8c8aadadf311e813b5b572c950f1801616ee5fccc5156f1cf5cb07b7105d09",
          },
          {
            "kind": "semantic_generic",
            "sha256": "46bef9338f911a43a376ba385f9d86f5b44e5121cbccf2e1b434a7c5c4e81f33",
          },
          {
            "kind": "semantic_generic",
            "sha256": "d0888e9435ec5ed084be9de090468926070b5134dbf8c59f99313095fced7f25",
          },
          {
            "kind": "renderer",
            "sha256": "e9d9b4bf83bfd74057ca98b4ca22fb206caed3ff87a3706f211c3b3cf9a64f91",
          },
        ],
        "shortReply": [
          {
            "kind": "semantic_focused_contextual",
            "sha256": "17e5e08077d7d4a4d2a2b020961f53932b003be5f8b8c4815ccbcdd3abcab809",
          },
          {
            "kind": "semantic_generic",
            "sha256": "6c9f19b2d6472f673cf0695cecfc62fbf920b0d284bc39331445fe46b261ac4e",
          },
          {
            "kind": "semantic_generic",
            "sha256": "cb35f1081a3722b9413700952090001178d95454f7009babb7643ad54faa958e",
          },
          {
            "kind": "semantic_generic",
            "sha256": "af8420d9d8c220f058d700c5be5aa358d9ff9bcc203a259448f1bf40794189c4",
          },
          {
            "kind": "renderer",
            "sha256": "57bed9d45d116f07ba3c79dfcf50b318e9a6bf24da602a60fdb8b974f9d8b943",
          },
        ],
      }
    `);
    expect(asideTurn.result?.interactionOutcome).toBeUndefined();
    expect(questionAfterAside?.targetSlot).toBe(english.targetSlot);
    expect(questionAfterAside).toHaveProperty('presentation');
    // The legacy short reply is routed through the raw-bound pending question (focused contextual route).
    expect(kinds(shortReply.calls)).toContain('semantic_focused_contextual');
    const generic = shortReply.calls.find((call) => call.kind === 'semantic_generic');
    if (generic) expect(summaryOf(generic).pendingQuestion).not.toBeNull();
  });

  it('interaction: the aside does not re-arm the old question; "うん" cannot bind to it', async () => {
    const { asideTurn, questionAfterAside, shortReply } = await aside('interaction_v1');
    expect({ aside: requestHashes(asideTurn.calls), shortReply: requestHashes(shortReply.calls) }).toMatchInlineSnapshot(`
      {
        "aside": [
          {
            "kind": "semantic_focused_contextual",
            "sha256": "3088b47223fc69a6bc7b6103bb9c4b21ecdeef80dd9cc155b9a978654d465d62",
          },
          {
            "kind": "semantic_generic",
            "sha256": "b4a65f7e07d4581217bacca1ee6b42664bfb7c28aae2ec22c7c82641b9cba8a8",
          },
          {
            "kind": "renderer",
            "sha256": "de467e79106f934c1c3d862b28e37c0b7e5443929fd2318d677b528fe9c394eb",
          },
        ],
        "shortReply": [
          {
            "kind": "semantic_generic",
            "sha256": "e19dd4612ea533d9f7cba0dac98122a47790e7f517788dbff5bfccab5f6277c9",
          },
          {
            "kind": "renderer",
            "sha256": "e793fc62733d2deeec6e98d5fa72eea4aae9bda7e9a1b2a8d466b6a7b3c44c01",
          },
        ],
      }
    `);
    expect(asideTurn.result?.interactionOutcome).toMatchObject({ kind: 'aside' });
    expect(questionAfterAside).not.toHaveProperty('presentation');
    expect(kinds(shortReply.calls)).not.toContain('semantic_focused_contextual');
    const generic = shortReply.calls.find((call) => call.kind === 'semantic_generic')!;
    expect(summaryOf(generic).pendingQuestion).toBeNull();
  });
});

describe('conversation pinning and persistence', () => {
  function snapshotOf(conversation: ScriptedConversation) {
    const preparation = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: conversation.ownerId,
      weekStartDate: conversation.weekStartDate,
      conversationId: conversation.conversationId,
      graph: conversation.graph()!,
      planningState: conversation.getState(),
    });
    if (preparation.status !== 'ready') throw new Error('checkpoint not ready');
    return preparation.planningState;
  }

  function parse(conversation: ScriptedConversation, planningState: unknown) {
    return parseWeeklyPlanningStableV5PersistedSession({
      raw: JSON.stringify({
        version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
        ownerId: conversation.ownerId,
        weekStartDate: conversation.weekStartDate,
        conversationId: conversation.conversationId,
        graph: conversation.graph(),
        planningState,
        savedAt: '2026-10-07T09:30:00.000Z',
      }),
      ownerId: conversation.ownerId,
      weekStartDate: conversation.weekStartDate,
    });
  }

  it.each(MODES)('a %s conversation keeps its mode across reload and runs the next turn under it', async (mode) => {
    const conversation = conversationIn(mode, { conversationId: `switch-reload-${mode}` });
    await conversation.submit(MATH_SETUP);
    const restored = parse(conversation, snapshotOf(conversation));
    expect(restored?.planningState.conversationArchitecture).toBe(mode);

    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: conversation.ownerId,
      weekStartDate: conversation.weekStartDate,
      conversationId: conversation.conversationId,
      graph: restored!.graph,
    });
    const reloaded = createScriptedConversation({
      provider,
      ownerId: conversation.ownerId,
      conversationId: conversation.conversationId,
      initialState: restored!.planningState,
    });
    const turn = await reloaded.submit('1問3分くらい');
    expect(reloaded.getState().conversationArchitecture).toBe(mode);
    expect(getLatestWeeklyPlanningTurnMeasurement()?.architecture).toBe(mode);
    const generic = turn.calls.find((call) => call.kind === 'semantic_generic');
    if (generic) expect(generic.schemaProperties.includes('conversationActs')).toBe(mode === 'interaction_v1');
  });

  it('keeps each chat\'s mode across A -> B -> A even when the new-conversation default differs', async () => {
    vi.stubEnv('VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED', '1');
    const chatA = conversationIn('legacy_v5', { conversationId: 'switch-chat-a' });
    await chatA.submit(MATH_SETUP);
    const snapshotA = parse(chatA, snapshotOf(chatA))!;

    const chatB = conversationIn('interaction_v1', { conversationId: 'switch-chat-b' });
    await chatB.submit(MATH_SETUP);
    expect(chatB.getState().conversationArchitecture).toBe('interaction_v1');

    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: chatA.ownerId,
      weekStartDate: chatA.weekStartDate,
      conversationId: chatA.conversationId,
      graph: snapshotA.graph,
    });
    const backInA = createScriptedConversation({
      provider, ownerId: chatA.ownerId, conversationId: chatA.conversationId, initialState: snapshotA.planningState,
    });
    expect(backInA.getState().conversationArchitecture).toBe('legacy_v5');
    expect(chatB.getState().conversationArchitecture).toBe('interaction_v1');
    vi.unstubAllEnvs();
  });

  it('hydrates a checkpoint written before the field existed as legacy_v5, never as interaction', async () => {
    const conversation = conversationIn('interaction_v1', { conversationId: 'switch-old-checkpoint' });
    await conversation.submit(MATH_SETUP);
    const withoutField = { ...snapshotOf(conversation) } as Record<string, unknown>;
    delete withoutField.conversationArchitecture;
    const restored = parse(conversation, withoutField);
    expect(restored?.planningState.conversationArchitecture).toBe('legacy_v5');

    // An old EMPTY checkpoint carries no conversation: it stays unpinned and captures the default later.
    const empty = parse(conversation, {
      weekStartDate: conversation.weekStartDate, revision: 0, conversationRequestSequence: 0, mode: 'idle',
      draftBlocks: [], previewCandidates: [], messages: [], updatedAt: '2026-10-07T09:00:00.000Z',
    });
    expect(empty?.planningState).not.toHaveProperty('conversationArchitecture');
  });

  it('load -> serialize is the identity for a pinned and for a pre-field state with an admitted turn', async () => {
    const conversation = conversationIn('interaction_v1', { conversationId: 'switch-roundtrip' });
    await conversation.submit(MATH_SETUP);
    const pinned = snapshotOf(conversation);
    const preField = { ...pinned } as Record<string, unknown>;
    delete preField.conversationArchitecture;
    for (const stored of [pinned, preField]) {
      const loaded = parse(conversation, stored)!.planningState;
      const reserialized = prepareWeeklyPlanningStableV5Checkpoint({
        ownerId: conversation.ownerId,
        weekStartDate: conversation.weekStartDate,
        conversationId: conversation.conversationId,
        graph: conversation.graph()!,
        planningState: loaded,
      });
      expect(reserialized.status).toBe('ready');
      if (reserialized.status === 'ready') expect(reserialized.planningState).toEqual(loaded);
    }
    expect(parse(conversation, preField)!.planningState.conversationArchitecture).toBe('legacy_v5');
  });

  it('rejects a malformed architecture value in a checkpoint (strict codec)', async () => {
    const conversation = conversationIn('interaction_v1', { conversationId: 'switch-strict-codec' });
    await conversation.submit(MATH_SETUP);
    const tampered = { ...snapshotOf(conversation), conversationArchitecture: 'both' };
    expect(parse(conversation, tampered)).toBeNull();
    const withFreeText = { ...snapshotOf(conversation), conversationArchitecture: 'legacy_v5', architectureNote: 'x' };
    expect(parse(conversation, withFreeText)).toBeNull();
  });
});

describe('new-conversation preference', () => {
  it('captures the default exactly once at the first turn; changing it never flips an existing conversation', async () => {
    vi.stubEnv('VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED', '1');
    expect(setWeeklyPlanningArchitecturePreference('legacy_v5')).toBe(true);
    currentMode = 'legacy_v5';
    const first = createScriptedConversation({ provider, conversationId: 'switch-pref-first' });
    expect(first.getState().conversationArchitecture).toBeUndefined();
    await first.submit(MATH_SETUP);
    expect(first.getState().conversationArchitecture).toBe('legacy_v5');

    expect(setWeeklyPlanningArchitecturePreference('interaction_v1')).toBe(true);
    currentMode = 'legacy_v5'; // the first conversation's fixture replies keep the legacy contract
    await first.submit('1問3分くらい');
    expect(first.getState().conversationArchitecture).toBe('legacy_v5');
    expect(getLatestWeeklyPlanningTurnMeasurement()?.architecture).toBe('legacy_v5');

    currentMode = 'interaction_v1';
    const second = createScriptedConversation({ provider, conversationId: 'switch-pref-second' });
    await second.submit(MATH_SETUP);
    expect(second.getState().conversationArchitecture).toBe('interaction_v1');
    vi.unstubAllEnvs();
  });

  it('ignores the stored preference while the evaluation gate is off (production stays simple)', async () => {
    storage.storage.setItem(
      WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, architecture: 'legacy_v5' }),
    );
    expect(setWeeklyPlanningArchitecturePreference('legacy_v5')).toBe(false);
    currentMode = 'interaction_v1';
    const conversation = createScriptedConversation({ provider, conversationId: 'switch-gate-off' });
    await conversation.submit(MATH_SETUP);
    expect(conversation.getState().conversationArchitecture).toBe('interaction_v1');
  });

  it('honours the optional build default and ignores unknown values', async () => {
    vi.stubEnv('VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT', 'legacy_v5');
    currentMode = 'legacy_v5';
    const legacyDefault = createScriptedConversation({ provider, conversationId: 'switch-build-default' });
    await legacyDefault.submit(MATH_SETUP);
    expect(legacyDefault.getState().conversationArchitecture).toBe('legacy_v5');

    vi.stubEnv('VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT', 'nonsense');
    currentMode = 'interaction_v1';
    const fallback = createScriptedConversation({ provider, conversationId: 'switch-build-default-bad' });
    await fallback.submit(MATH_SETUP);
    expect(fallback.getState().conversationArchitecture).toBe('interaction_v1');
    vi.unstubAllEnvs();
  });
});

describe.each(MODES)('measurement under %s', (mode) => {
  it('counts exactly the provider calls of every turn kind and times it with the injected clock', async () => {
    let tick = 1_000;
    const conversation = conversationIn(mode, {
      measurementClock: () => {
        tick += 125;
        return tick;
      },
    });
    const kindsOfTurn: Array<Awaited<ReturnType<ScriptedConversation['submit']>>> = [];

    kindsOfTurn.push(await conversation.submit(MATH_SETUP));
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument(mode, mode === 'interaction_v1'
          ? { conversationActs: [act('ask_about_pending_question')] }
          : {}));
      }
      return undefined;
    };
    kindsOfTurn.push(await conversation.submit('なんで時間が必要？'));
    script = (call) => (call.kind === 'semantic_generic' ? 'not a semantic document' : undefined);
    kindsOfTurn.push(await conversation.submit('ちょっとよく分からない'));

    const measurements = getWeeklyPlanningTurnMeasurements();
    expect(measurements).toHaveLength(3);
    measurements.forEach((measurement, index) => {
      const turn = kindsOfTurn[index]!;
      expect(measurement.architecture).toBe(mode);
      expect(measurement.requestId).toBe(turn.requestId);
      expect(measurement.aiDispatches.total).toBe(turn.calls.length);
      expect(measurement.aiDispatches.semantic + measurement.aiDispatches.renderer).toBe(turn.calls.length);
      expect(measurement.aiDispatches.renderer).toBe(turn.calls.filter((call) => call.kind === 'renderer').length);
      expect(measurement.aiDispatches.enforced).toBe(mode === 'interaction_v1');
      // start + end clock reads = one 125 ms step per read pair.
      expect(measurement.elapsedMs).toBe(125);
      expect(measurement.status).toBe(index === 2 ? 'failed' : 'committed');
    });
    expect(measurements[2]!.failureCode).toBe('stable_v5_normalization_rejected');
    expect(measurements[2]!.resultKind).toBe('failure');
    expect(measurements[2]!.pendingQuestion).toBe(mode === 'interaction_v1' ? 're_presented' : 'none');
    expect(measurements.map((measurement) => measurement.resultKind)).toEqual(['question', 'question', 'failure']);
    expect(measurements.map((measurement) => measurement.pendingQuestion).slice(0, 2)).toEqual(['presented', 're_presented']);
    expect(measurements[0]!.interactionOutcome).toBe(mode === 'interaction_v1' ? 'apply' : null);
    expect(measurements[1]!.interactionOutcome).toBe(mode === 'interaction_v1' ? 'explain_pending_question' : null);
  });

  it('records the architecture and actual dispatch usage in the local debug trace', async () => {
    const conversation = conversationIn(mode);
    const turn = await conversation.submit(MATH_SETUP);
    const projected = turn.debugTrace.find((event) => event.stage === 'turn_executor_result_projected');
    const data = projected?.data as Json;
    expect(data.conversationArchitecture).toBe(mode);
    expect(data.aiDispatchUsage).toMatchObject({ total: turn.calls.length, enforced: mode === 'interaction_v1' });
    const prepared = turn.debugTrace.find((event) => event.stage === 'runtime_session_context_prepared');
    expect((prepared?.data as Json).conversationArchitecture).toBe(mode);
  });
});
