import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { JEV_CONTEXTUAL_CASES } from './jev-contextual-corpus.mjs';
import type { CensusLabel, CensusRow } from './semantic-dispatch-census-core';

function opaqueId(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function unknownCensusLabel(artifactId: string, source: CensusLabel['source'] = 'synthetic'): CensusLabel {
  return { source, artifactId, independence: 'unknown', use: 'diagnostic', targetCount: null, propositionCount: null, openValueKinds: null,
    candidateCount: null, branchCount: null, depth: null, manifestComplete: null, scopeClosed: null, c5Reference: null, valueTuple: null,
    tupleComplete: null, overnight: null, endAt24: null, exceptions: null, materialAdapter: null, selectedMaterialCount: null, explicitCurrentIntent: null, jointCorrect: null };
}

/** Historical logs describe logical requests. No inference from lunaCalled, success or attemptCount. */
export function legacyArtifactRows(artifact: Record<string, unknown>, options: {
  artifactIdentity: string; domain: 'weekly-planning' | 'user-context'; arm: 'baseline' | 'treatment';
}): CensusRow[] {
  const candidates = artifact.results ?? artifact.cases ?? artifact.records;
  if (!Array.isArray(candidates)) throw new Error('Legacy artifact has no case denominator.');
  const corpusId = opaqueId(options.artifactIdentity);
  return candidates.map((raw, index) => {
    const entry = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const identity = `${options.artifactIdentity}:${index}`;
    const turnId = opaqueId(`${identity}:turn`); const requestId = opaqueId(`${identity}:request`);
    const population = { source: 'synthetic', domain: options.domain, arm: options.arm, corpusId } as const;
    // These artifacts lack full turn joins, request/dispatch IDs and semantic elapsed closure.
    return { turn: { version: 1, population, turnId, pairId: opaqueId(`${identity}:pair`), expectedRequestIds: [requestId], sealed: false, startedAtMs: 0, completedAtMs: null, semanticResolution: 'unknown' },
      requests: [{ version: 1, population, turnId, requestId, stage: 'initial', boundary: 'unobserved_proxy', startedAtMs: 0, mainCompletedAtMs: null, settledAtMs: null, integrity: 'unknown', dispatchIds: null, dispatches: [] }],
      questionCode: typeof entry.questionCode === 'string' && ['quantity_role_unresolved', 'missing_effort_estimate'].includes(entry.questionCode) ? entry.questionCode : null,
      route: 'unknown', baselineModel: 'luna', mode: 'unknown', label: null };
  });
}

export async function repositoryCensusInventory(root: string): Promise<{ rows: CensusRow[]; artifacts: Array<{ path: string; turns: number; kind: string }> }> {
  const corpusPath = 'scripts/jev-contextual-corpus.mjs';
  const corpusId = opaqueId(corpusPath); const artifactId = opaqueId(`${corpusPath}:label`);
  const rows: CensusRow[] = JEV_CONTEXTUAL_CASES.map((entry: { id: string; questionCode: string; labelSource?: string }) => ({
    turn: { version: 1, population: { source: 'synthetic', domain: 'weekly-planning', arm: 'baseline', corpusId }, turnId: opaqueId(`${corpusPath}:${entry.id}`), pairId: opaqueId(`${corpusPath}:${entry.id}:pair`), expectedRequestIds: [opaqueId(`${corpusPath}:${entry.id}:request`)], sealed: false, startedAtMs: 0, completedAtMs: null, semanticResolution: 'unknown' },
    requests: [], questionCode: entry.questionCode, route: 'unknown', baselineModel: 'luna', mode: 'unknown',
    label: unknownCensusLabel(artifactId, entry.labelSource === 'opus-5.5-limited-judge' ? 'opus-5.5-limited-judge' : 'synthetic'),
  }));
  const artifacts = [{ path: corpusPath, turns: rows.length, kind: 'consumed_synthetic_diagnostic_only' }];
  const directory = 'workers/ai-proxy/src/decision/evaluation/evidence';
  for (const name of (await readdir(`${root}/${directory}`)).filter((name) => name.endsWith('.json')).sort()) {
    const artifact = JSON.parse(await readFile(`${root}/${directory}/${name}`, 'utf8')) as Record<string, unknown>;
    if (!Array.isArray(artifact.results ?? artifact.cases ?? artifact.records)) continue;
    const path = `${directory}/${name}`;
    const imported = legacyArtifactRows(artifact, { artifactIdentity: path, domain: name.startsWith('user-context-') ? 'user-context' : 'weekly-planning', arm: name === 'user-context-routing-luna-baseline-20260927.json' ? 'baseline' : 'treatment' });
    rows.push(...imported); artifacts.push({ path, turns: imported.length, kind: 'legacy_logical_requests_actual_dispatch_unknown' });
  }
  return { rows, artifacts };
}
