import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationArchitecturePolicy,
  hydratedConversationArchitecture,
  resolveConversationArchitectureForTurn,
  WEEKLY_PLANNING_CONVERSATION_ARCHITECTURES,
} from './weeklyPlanningConversationArchitecture';
import {
  isWeeklyPlanningArchitectureSwitchEnabled,
  resolveNewConversationArchitecture,
  setWeeklyPlanningArchitecturePreference,
  WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY,
} from './weeklyPlanningConversationArchitecturePreference';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import type { PlanningState, WeeklyPlanningPendingTurn } from './types';

const EMPTY = createInitialPlanningState('2026-10-05');
const WITH_CONTENT: PlanningState = {
  ...EMPTY,
  conversationRequestSequence: 2,
  messages: [{ id: 'm1', role: 'user', content: 'x', createdAt: '2026-10-07T00:00:00.000Z' }],
};

function pending(state: PlanningState): WeeklyPlanningPendingTurn {
  return {
    conversationId: 'c', turnId: 'c:turn:1', requestId: 'r', weekStartDate: state.weekStartDate,
    baseRevision: state.revision, startedAt: '2026-10-07T00:00:00.000Z',
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('architecture policy', () => {
  it('maps each architecture to one coherent set of capabilities (no per-feature mixtures)', () => {
    const legacy = conversationArchitecturePolicy('legacy_v5');
    const interaction = conversationArchitecturePolicy('interaction_v1');
    const bits = (policy: typeof legacy) => Object.entries(policy)
      .filter(([key]) => key !== 'architecture')
      .map(([, value]) => value);
    expect(bits(legacy).every((value) => value === false)).toBe(true);
    expect(bits(interaction).every((value) => value === true)).toBe(true);
    expect(WEEKLY_PLANNING_CONVERSATION_ARCHITECTURES).toEqual(['legacy_v5', 'interaction_v1']);
  });

  it('treats an unspecified architecture as the current default (interaction_v1) for pure callers only', () => {
    expect(conversationArchitecturePolicy(undefined).architecture).toBe('interaction_v1');
  });
});

describe('turn architecture resolution', () => {
  it('keeps the pinned mode, whatever the new-conversation default is', () => {
    expect(resolveConversationArchitectureForTurn({ ...WITH_CONTENT, conversationArchitecture: 'legacy_v5' }, 'interaction_v1'))
      .toBe('legacy_v5');
    expect(resolveConversationArchitectureForTurn({ ...EMPTY, conversationArchitecture: 'interaction_v1' }, 'legacy_v5'))
      .toBe('interaction_v1');
  });

  it('runs a conversation with content but no pin (pre-field) as legacy, and captures the default for an empty one', () => {
    expect(resolveConversationArchitectureForTurn(WITH_CONTENT, 'interaction_v1')).toBe('legacy_v5');
    expect(resolveConversationArchitectureForTurn(EMPTY, 'interaction_v1')).toBe('interaction_v1');
    expect(resolveConversationArchitectureForTurn(EMPTY, 'legacy_v5')).toBe('legacy_v5');
  });

  it('hydrates old content as legacy and leaves an empty conversation unpinned (no key)', () => {
    expect(hydratedConversationArchitecture(WITH_CONTENT)).toEqual({ conversationArchitecture: 'legacy_v5' });
    expect(hydratedConversationArchitecture(EMPTY)).toEqual({});
    expect(hydratedConversationArchitecture({ ...WITH_CONTENT, conversationArchitecture: 'interaction_v1' }))
      .toEqual({ conversationArchitecture: 'interaction_v1' });
  });
});

describe('reducer pinning', () => {
  it('pins at the first admitted turn exactly once and never rewrites the pin', () => {
    const first = weeklyPlanningReducer(EMPTY, {
      type: 'begin_turn',
      pending: pending(EMPTY),
      userMessage: { id: 'u1', role: 'user', content: 'a', createdAt: '2026-10-07T00:00:00.000Z' },
      conversationArchitecture: 'legacy_v5',
    });
    expect(first.conversationArchitecture).toBe('legacy_v5');
    const afterTurn = weeklyPlanningReducer(first, {
      type: 'fail_turn',
      pending: pending(EMPTY),
      assistantMessage: { id: 'a1', role: 'assistant', content: 'b', createdAt: '2026-10-07T00:00:01.000Z' },
    });
    const second = weeklyPlanningReducer(afterTurn, {
      type: 'begin_turn',
      pending: { ...pending(afterTurn), turnId: 'c:turn:2', requestId: 'r2' },
      userMessage: { id: 'u2', role: 'user', content: 'c', createdAt: '2026-10-07T00:00:02.000Z' },
      conversationArchitecture: 'interaction_v1',
    });
    expect(second.conversationArchitecture).toBe('legacy_v5');
  });

  it('a session reset starts a new conversation that is unpinned again', () => {
    const pinned = { ...WITH_CONTENT, conversationArchitecture: 'legacy_v5' as const };
    const reset = weeklyPlanningReducer(pinned, { type: 'reset_session' });
    expect(reset.conversationArchitecture).toBeUndefined();
    expect(reset.messages).toEqual([]);
  });

  it('clearing the visible chat does not change the architecture of the running conversation', () => {
    const pinned = { ...WITH_CONTENT, conversationArchitecture: 'legacy_v5' as const };
    expect(weeklyPlanningReducer(pinned, { type: 'clear_conversation' }).conversationArchitecture).toBe('legacy_v5');
  });
});

describe('new-conversation preference resolver (the only env/storage reader)', () => {
  it('defaults to interaction_v1; honours a valid build default; ignores garbage', () => {
    expect(resolveNewConversationArchitecture()).toBe('interaction_v1');
    vi.stubEnv('VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT', 'legacy_v5');
    expect(resolveNewConversationArchitecture()).toBe('legacy_v5');
    vi.stubEnv('VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT', 'whatever');
    expect(resolveNewConversationArchitecture()).toBe('interaction_v1');
  });

  it('uses the browser preference only while the gate is on, and validates it strictly', () => {
    const storage = createMemoryStorageHarness();
    const restore = installWeeklyPlanningTestStorage(storage.storage);
    try {
      storage.storage.setItem(
        WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY,
        JSON.stringify({ version: 1, architecture: 'legacy_v5' }),
      );
      expect(isWeeklyPlanningArchitectureSwitchEnabled()).toBe(false);
      expect(resolveNewConversationArchitecture()).toBe('interaction_v1');

      vi.stubEnv('VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED', '1');
      expect(isWeeklyPlanningArchitectureSwitchEnabled()).toBe(true);
      expect(resolveNewConversationArchitecture()).toBe('legacy_v5');

      for (const bad of [
        '{', '[]', JSON.stringify({ version: 2, architecture: 'legacy_v5' }),
        JSON.stringify({ version: 1, architecture: 'both' }),
        JSON.stringify({ version: 1, architecture: 'legacy_v5', note: 'free text' }),
      ]) {
        storage.storage.setItem(WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY, bad);
        expect(resolveNewConversationArchitecture()).toBe('interaction_v1');
      }

      expect(setWeeklyPlanningArchitecturePreference('legacy_v5')).toBe(true);
      expect(resolveNewConversationArchitecture()).toBe('legacy_v5');
      expect(setWeeklyPlanningArchitecturePreference(null)).toBe(true);
      expect(resolveNewConversationArchitecture()).toBe('interaction_v1');
    } finally {
      restore();
    }
  });
});

describe('one resolver owner', () => {
  const root = join(process.cwd(), 'src');
  const OWNER = 'features/weeklyPlanning/weeklyPlanningConversationArchitecturePreference.ts';
  const NAMES = [
    'VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED',
    'VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT',
    'conversationArchitecturePreference',
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [path] : [];
    });
  }

  it('no other production module reads the architecture env flags or the preference storage key', () => {
    const offenders = sourceFiles(root)
      .filter((path) => relative(root, path) !== OWNER)
      .filter((path) => {
        // Comments may name the gate; only code may not read it.
        const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        return NAMES.some((name) => code.includes(name));
      })
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
