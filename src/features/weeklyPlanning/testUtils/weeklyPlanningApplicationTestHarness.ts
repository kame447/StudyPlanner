import type { PlanDraft } from '../../../types/domain';
import type { WeeklyPreviewMetadata } from '../planning/weeklyPlanningApprovalTypes';
import type { WeeklyPlanDraftBlock } from '../types';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

export interface MemoryStorageHarness {
  storage: Storage;
  values: Map<string, string>;
}

export function createMemoryStorageHarness(): MemoryStorageHarness {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  } as Storage;
  return { storage, values };
}

export function installWeeklyPlanningTestStorage(storage: Storage): () => void {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      sessionStorage: storage,
    },
  });

  return () => {
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, 'window');
  };
}

export interface DeferredPlanDraftSaveCall {
  draft: PlanDraft;
  targetPlanId?: string;
  deferred: Deferred<void>;
}

export interface DeferredPlanDraftSaver {
  calls: DeferredPlanDraftSaveCall[];
  savePlanDraft(draft: PlanDraft, targetPlanId?: string): Promise<void>;
}

export function createDeferredPlanDraftSaver(): DeferredPlanDraftSaver {
  const calls: DeferredPlanDraftSaveCall[] = [];
  return {
    calls,
    savePlanDraft(draft, targetPlanId) {
      const deferred = createDeferred<void>();
      calls.push({ draft, targetPlanId, deferred });
      return deferred.promise;
    },
  };
}

export function createWeeklyPlanningTestDraftBlock(params: {
  id: string;
  userId?: string;
  previewMetadata?: WeeklyPreviewMetadata;
  overrides?: Partial<WeeklyPlanDraftBlock>;
}): WeeklyPlanDraftBlock {
  const userId = params.userId ?? 'user-1';
  const previewMetadata = params.previewMetadata;
  const behaviorMetadata = previewMetadata
    ? {
        stateRevision: previewMetadata.stateRevision,
        sourceFactRefs: [`task:${params.id}`],
        usedAssumptionProposalRefs: [],
        taskRef: `task:${params.id}`,
        opportunityTags: [],
        reasoningKey: 'explicit-duration' as const,
        compatibility: {
          workItemSemantic: 'behavior_aware_task' as const,
          schedulerInputSource: 'exam_prep_request' as const,
          candidateSource: 'weekly_exam_prep' as const,
        },
        previewMetadata,
      }
    : undefined;

  return {
    id: params.id,
    userId,
    date: '2026-07-14',
    startTime: '18:00',
    endTime: '19:00',
    title: params.id,
    subject: '情報学',
    type: 'study',
    label: params.id,
    source: 'ai',
    status: 'draft',
    userEdited: false,
    ...(behaviorMetadata ? { behaviorMetadata } : {}),
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...params.overrides,
  };
}
