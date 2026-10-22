import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSync } from 'esbuild';
import { productionDatabaseFromRequestUrl, readProductionServerSnapshot, classifyProductionOrigin, verifyFrontendIdentity, productionSmokeExpectation, persistRedactedSmokeEvidence } from '../tests/e2e/support/d5-production-readonly.mjs';

const database = 'projects/smoke-fixture/databases/(default)';
const prefix = `${database}/documents`;
const uid = 'isolated-fixture-owner';
const document = (name, extra = {}) => ({ name, fields: { userId: { stringValue: uid }, ...extra } });
function server(mode = 'complete') {
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const query = JSON.parse(init.body).structuredQuery;
    const collection = query.from[0].collectionId;
    const parent = String(url).replace('https://firestore.googleapis.com/v1/', '').replace(':runQuery', '');
    requests.push({ parent, collection, method: init.method, query });
    expect(query.where.fieldFilter).toEqual({ field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: uid } });
    if (collection === 'weekly_planning_approval_items') {
      if (!parent.startsWith(`${prefix}/weekly_planning_approval_operations/`)) throw new Error('Root item query is not complete.');
      if (parent.endsWith('/op-b') && mode === 'denied-child') return new Response('', { status: 403 });
      if (parent.endsWith('/op-b') && mode === 'empty-stream') return Response.json([]);
      if (parent.endsWith('/op-b') && mode === 'error-stream') return Response.json([{ error: { code: 7 } }]);
      if (parent.endsWith('/op-b') && mode === 'skipped-stream') return Response.json([{ skippedResults: 1, readTime: '2026-10-21T00:00:00Z' }]);
      const fields = parent.endsWith('/op-b') && mode === 'changed-child' ? { savedPlanId: { stringValue: 'changed' } } : {};
      return Response.json([{ document: document(`${parent}/${collection}/item`, fields) }]);
    }
    expect(parent).toBe(prefix);
    if (collection === 'weekly_planning_approval_operations') return Response.json(['op-a', 'op-b'].map(id => ({ document: document(`${parent}/${collection}/${id}`) })));
    expect(['schedule_events', 'plans', 'month_events']).toContain(collection);
    return Response.json([{ document: document(`${parent}/${collection}/existing`) }]);
  }));
  return requests;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const configFile = new URL('../tests/e2e/playwright.d5-production.config.mjs', import.meta.url);
// Execute the actual config offline; only the runner's defineConfig/devices exports are inert stubs.
const configCode = buildSync({ stdin: {
  contents: readFileSync(configFile, 'utf8').replaceAll('import.meta.url', JSON.stringify(configFile.href)),
  resolveDir: new URL('../tests/e2e/', import.meta.url).pathname, loader: 'js',
}, bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: undefined, external: ['@playwright/test'],
}).outputFiles[0].text;
function loadConfig(base, sha, flags = {}) {
  if (arguments.length === 1) sha = 'a'.repeat(40);
  vi.stubEnv('STUDYPLANNER_LIVE_BASE_URL', base);
  vi.stubEnv('EXPECTED_FRONTEND_SHA', sha);
  vi.stubEnv('D5_PRODUCTION_SMOKE', '1');
  vi.stubEnv('EXPECT_JEV', flags.EXPECT_JEV);
  vi.stubEnv('EXPECT_FALLBACK', flags.EXPECT_FALLBACK);
  const module = { exports: {} };
  const nativeRequire = createRequire(import.meta.url);
  const require = name => name === '@playwright/test'
    ? { defineConfig: config => config, devices: { 'Desktop Chrome': {} } } : nativeRequire(name);
  new Function('require', 'module', 'exports', configCode)(require, module, module.exports);
  return module.exports.default;
}

describe('D5 production target and identity guard', () => {
  it.each([
    ['https://laplance.com', 'production'],
    ['https://laplance.com:443/path?ignored=value', 'production'],
    ['https://branch.studyplannner.pages.dev', 'non_production'],
    ['https://studyplannner.pages.dev', 'non_production'],
    ['https://localhost', 'non_production'],
    ['http://localhost:5173', 'non_production'],
    ['http://laplance.com', 'non_production'],
    ['https://laplance.com:8443', 'non_production'],
    ['https://laplance.com.evil.invalid', 'non_production'],
    ['https://user:secret@laplance.com', 'non_production'],
    ['not-a-url', 'non_production'],
  ])('classifies the configured origin without network access (%s)', (url, expected) => {
    expect(classifyProductionOrigin(url)).toBe(expected);
  });
  it('actual config accepts only canonical origin and logs classification without URL/SHA', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const config = loadConfig('https://laplance.com/path?private=value');
    expect(config.use.baseURL).toBe('https://laplance.com');
    expect(config.preserveOutput).toBe('always');
    expect(config.timeout).toBe(420_000);
    expect(config.expect.timeout).toBe(30_000);
    expect(log.mock.calls).toEqual([[JSON.stringify({ productionOrigin: 'production' })]]);
  });
  it.each(['https://branch.studyplannner.pages.dev', 'https://localhost', 'http://laplance.com', 'not-a-url'])('actual config fails non-production before executing or echoing %s', url => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => loadConfig(url)).toThrow('non_production');
    expect(log.mock.calls).toEqual([[JSON.stringify({ productionOrigin: 'non_production' })]]);
  });
  it('requires a full expected frontend SHA even when no in-app build identifier exists', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => loadConfig('https://laplance.com', undefined)).toThrow('EXPECTED_FRONTEND_SHA');
    expect(() => loadConfig('https://laplance.com', 'short-sha')).toThrow('EXPECTED_FRONTEND_SHA');
    expect(verifyFrontendIdentity('a'.repeat(40))).toBe('out_of_band_pages_readback_required');
  });
  it('rejects observed identity mismatch; only an exact served SHA can be reported as match', () => {
    expect(verifyFrontendIdentity('a'.repeat(40), 'a'.repeat(40))).toBe('match');
    expect(() => verifyFrontendIdentity('a'.repeat(40), 'b'.repeat(40))).toThrow('frontend_identity_mismatch');
    expect(() => verifyFrontendIdentity('a'.repeat(40), '')).toThrow('frontend_identity_mismatch');
  });
});

describe('D5 production verification modes', () => {
  it.each([
    [{}, 'EXPECT_JEV'],
    [{ EXPECT_JEV: '1', EXPECT_FALLBACK: '0' }, 'EXPECT_JEV'],
    [{ EXPECT_FALLBACK: '1' }, 'EXPECT_FALLBACK'],
    [{ EXPECT_JEV: '0', EXPECT_FALLBACK: '1' }, 'EXPECT_FALLBACK'],
  ])('selects one verification contract for %j', (flags, expectation) => {
    expect(productionSmokeExpectation(flags)).toBe(expectation);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(loadConfig('https://laplance.com', 'a'.repeat(40), flags).retries).toBe(0);
  });
  it.each([
    { EXPECT_JEV: '1', EXPECT_FALLBACK: '1' },
    { EXPECT_JEV: '0', EXPECT_FALLBACK: '0' },
    { EXPECT_JEV: 'invalid' },
    { EXPECT_FALLBACK: 'invalid' },
  ])('rejects an ambiguous or invalid contract before browser execution: %j', flags => {
    expect(() => productionSmokeExpectation(flags)).toThrow();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => loadConfig('https://laplance.com', 'a'.repeat(40), flags)).toThrow();
  });
});

describe('D5 redacted evidence persistence', () => {
  it.each(['pass', 'fail'])('writes an uploadable, redacted JSON file from the %s finally path', async outcome => {
    const directory = await mkdtemp(join(tmpdir(), 'd5-smoke-evidence-'));
    const output = join(directory, 'test-output', 'redacted-d5-production-evidence.json');
    const attach = vi.fn();
    const evidence = { productionOrigin: 'production', frontendIdentity: 'out_of_band_pages_readback_required',
      outcome: outcome === 'pass' ? 'd5_positive_readonly_smoke' : 'fallback_no_d5_positive_claim',
      candidateChoice: [{ route: 'candidate_choice', provider: 'openrouter', status: 'evaluated', selection: 'leaf',
        selected15: true, v2: true, question: 'missing_effort_estimate', optionCount: 2,
        uid: 'PRIVATE_UID_SENTINEL', url: 'https://PRIVATE_URL_SENTINEL.invalid', token: 'PRIVATE_SECRET_SENTINEL' }],
      uid: 'PRIVATE_UID_SENTINEL', url: 'https://PRIVATE_URL_SENTINEL.invalid', secret: 'PRIVATE_SECRET_SENTINEL',
      reflectedEstimate: { minutes: 15, measurement: 'duration_per_unit', unit: 'problem', precision: 'exact', raw: 'PRIVATE_SECRET_SENTINEL' },
      scheduleReadbackIdentical: outcome === 'pass', approvalExecutions: 0, scheduleWrites: 0 };
    try {
      try {
        if (outcome === 'fail') throw new Error('fixture assertion failure');
      } finally {
        await persistRedactedSmokeEvidence({ outputPath: name => { expect(name).toBe('redacted-d5-production-evidence.json'); return output; }, attach }, evidence);
      }
    } catch (error) { expect(error.message).toBe('fixture assertion failure'); }
    try {
      const bytes = await readFile(output, 'utf8');
      expect(JSON.parse(bytes).outcome).toBe(evidence.outcome);
      expect(bytes).not.toMatch(/https?:|PRIVATE_UID_SENTINEL|PRIVATE_URL_SENTINEL|PRIVATE_SECRET_SENTINEL/u);
      expect(attach).toHaveBeenCalledWith('redacted-d5-production-evidence', { path: output, contentType: 'application/json' });
      const workflow = readFileSync(new URL('../.github/workflows/d5-production-readonly-smoke.yml', import.meta.url), 'utf8');
      expect(workflow).toContain('artifacts/d5-production-smoke/**/redacted-d5-production-evidence*.json');
      expect(workflow).toContain('if-no-files-found: error');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('retains the JSON even if reporter attachment fails, and rejects arbitrary strings in known fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd5-smoke-evidence-'));
    const output = join(directory, 'redacted-d5-production-evidence.json');
    try {
      await expect(persistRedactedSmokeEvidence({ outputPath: () => output, attach: async () => { throw new Error('reporter failed'); } }, {
        productionOrigin: 'https://PRIVATE_URL_SENTINEL.invalid', frontendIdentity: 'PRIVATE_SECRET_SENTINEL', outcome: 'PRIVATE_UID_SENTINEL',
        candidateChoice: [{ provider: 'PRIVATE_UID_SENTINEL', status: 'PRIVATE_SECRET_SENTINEL', question: 'https://PRIVATE_URL_SENTINEL.invalid' }],
      })).rejects.toThrow('reporter failed');
      expect(await readFile(output, 'utf8')).not.toMatch(/https?:|PRIVATE_UID_SENTINEL|PRIVATE_URL_SENTINEL|PRIVATE_SECRET_SENTINEL/u);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('D5 production smoke offline preflight', () => {
  it('derives the exact database from real SDK Listen/Write query shapes and REST paths', () => {
    const query = new URLSearchParams({ database, VER: '8', RID: 'rpc', SID: 'fixture' });
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?${query}`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel?${query}`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/v1/${prefix}:runQuery`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://firestore.googleapis.com/v1/${prefix}/schedule_events/existing`)).toBe(database);
    expect(productionDatabaseFromRequestUrl(`https://other.invalid/?${query}`)).toBeNull();
    expect(productionDatabaseFromRequestUrl('https://firestore.googleapis.com/?database=projects/wrong')).toBeNull();
  });
  it('reads canonical/legacy schedules and every actual operation item subcollection with no writes', async () => {
    const requests = server();
    const result = await readProductionServerSnapshot({ uid, database, idToken: 'isolated-fixture-token' });
    expect(requests).toHaveLength(6);
    expect(requests.map(r => [r.parent, r.collection])).toEqual([
      [prefix, 'schedule_events'], [prefix, 'plans'], [prefix, 'month_events'], [prefix, 'weekly_planning_approval_operations'],
      [`${prefix}/weekly_planning_approval_operations/op-a`, 'weekly_planning_approval_items'],
      [`${prefix}/weekly_planning_approval_operations/op-b`, 'weekly_planning_approval_items'],
    ]);
    expect(result.weekly_planning_approval_items).toHaveLength(2);
    expect(requests.every(r => r.method === 'POST')).toBe(true); // every endpoint above is :runQuery only
    const repository = readFileSync(new URL('../src/features/weeklyPlanning/application/weeklyPlanningApprovalFirestoreRepository.ts', import.meta.url), 'utf8');
    expect(repository).toContain("const OPERATION_COLLECTION = 'weekly_planning_approval_operations'");
    expect(repository).toContain('doc(operationRef, ITEM_COLLECTION, identity.itemDocumentId)');
    expect(repository).toContain("const SCHEDULE_EVENT_COLLECTION = 'schedule_events'");
    const planner = readFileSync(new URL('../src/repositories/firebasePlannerRepository.ts', import.meta.url), 'utf8');
    expect(planner).toContain("listByUserId<Plan>(firestoreDb, 'plans', userId)");
    expect(planner).toContain("listByUserId<MonthEvent>(firestoreDb, 'month_events', userId)");
  });
  it('detects a change confined to the second operation child (root query would miss it)', async () => {
    server(); const before = await readProductionServerSnapshot({ uid, database, idToken: 'fixture' });
    server('changed-child'); const after = await readProductionServerSnapshot({ uid, database, idToken: 'fixture' });
    expect(before.weekly_planning_approval_operations).toEqual(after.weekly_planning_approval_operations);
    expect(JSON.stringify(before) === JSON.stringify(after)).toBe(false);
  });
  it.each(['denied-child', 'empty-stream', 'error-stream', 'skipped-stream'])('fails closed on %s rather than reporting unchanged', async mode => {
    server(mode);
    await expect(readProductionServerSnapshot({ uid, database, idToken: 'fixture' })).rejects.toThrow(/unavailable|Incomplete/u);
  });
  it('rejects a foreign-owner item even when its path is under an owned operation', async () => {
    server(); const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (url, init) => {
      const response = await original(url, init);
      const rows = await response.json();
      if (String(url).includes('/op-b:runQuery')) rows[0].document.fields.userId.stringValue = 'foreign-owner';
      return Response.json(rows);
    });
    await expect(readProductionServerSnapshot({ uid, database, idToken: 'fixture' })).rejects.toThrow('Unexpected server document scope');
  });
});
