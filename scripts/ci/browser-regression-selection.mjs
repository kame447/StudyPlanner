import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runPlaywright, validateShard } from './playwright-shard.mjs';

// Opt in only isolated specs whose imports/runner ownership have been reviewed.
// Unknown specs and every runtime/shared input keep the full regression selection.
export const isolatedSpecs = [
  'tests/e2e/app-settings-page.spec.mjs',
  'tests/e2e/study-session-pomodoro-settings.spec.mjs',
];
const reportPath = 'artifacts/browser-selection.json';
const metadata = new Set([
  'AGENTS.md', 'README.md', 'PROJECT_MAP.md',
  '.github/CODEOWNERS', '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/workflows/qa-result-summary.yml',
  'scripts/ci/qa-result-summary-contract.test.mjs',
  'tests/e2e/UI_REGRESSION.md',
]);
const full = reason => ({ mode: 'full', reason, specs: [] });
const isDocumentation = file => metadata.has(file)
  || /^docs\/.*\.md$/.test(file)
  || /^\.github\/ISSUE_TEMPLATE\/[^/]+\.(md|yml|yaml)$/.test(file);

export function parseNameStatus(output) {
  if (!output.endsWith('\0')) throw new Error('Incomplete changed-file output');
  const fields = output.slice(0, -1).split('\0');
  if (fields.length % 2 !== 0) throw new Error('Invalid changed-file output');
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const [status, file] = fields.slice(index, index + 2);
    if (!/^[AMDT]$/.test(status) || !file || file.startsWith('/') || file.split('/').includes('..')) {
      throw new Error('Unsupported changed-file entry');
    }
    changes.push({ status, file });
  }
  return changes;
}

export function classifyChanges(changes, isIsolated = () => false) {
  if (!changes.length) return full('No changed-file evidence; run the full selection.');
  const specs = [];
  for (const { status, file } of changes) {
    if (isDocumentation(file) && ['A', 'M', 'D'].includes(status)) continue;
    if (status === 'M' && isolatedSpecs.includes(file) && isIsolated(file)) {
      specs.push(file);
    } else {
      return full('Runtime, shared, unknown, or non-isolated input changed.');
    }
  }
  return specs.length
    ? { mode: 'specs', reason: 'Only reviewed isolated browser specs and non-runtime metadata changed.', specs: [...new Set(specs)].sort() }
    : { mode: 'none', reason: 'Only allowlisted non-runtime documentation or repository metadata changed.', specs: [] };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function isIsolatedSpec(root, file) {
  const stat = fs.lstatSync(path.join(root, file));
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  // A later explicit spec consumer invalidates the opt-in. Config testMatch and
  // documentation are ownership declarations, not consumers of the spec module.
  const basename = path.basename(file);
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  return !tracked.some(other => {
    if (other === file || !/\.[cm]?[jt]sx?$/.test(other)
      || /^scripts\/ci\/browser-regression-selection(?:\.test)?\.mjs$/.test(other)) return false;
    if (!fs.lstatSync(path.join(root, other)).isFile()) return true;
    const source = fs.readFileSync(path.join(root, other), 'utf8');
    const runnerConfig = /^tests\/e2e\/playwright[^/]*\.config\.mjs$/.test(other);
    if (runnerConfig && /\b(?:import\s*\(|import\s*\.\s*meta\s*\.\s*glob(?:Eager)?\s*\(|require\s*\()/.test(source)) return true;
    const references = runnerConfig
      ? source.replace(/['"]\*\*\/[a-z0-9-]+\.spec\.mjs['"]/g, '') : source;
    return references.includes(basename);
  });
}

export function selectFromEvent(root, eventName, event) {
  if (!['push', 'pull_request'].includes(eventName)) return full('Manual or unsupported event; run the full selection.');
  const base = eventName === 'push' ? event.before : event.pull_request?.base?.sha;
  const head = eventName === 'push' ? event.after : event.pull_request?.head?.sha;
  if (![base, head].every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha))) {
    return full('Missing or invalid comparison commits; run the full selection.');
  }
  try {
    const checkout = git(root, ['rev-parse', 'HEAD']).trim();
    for (const sha of [base, head]) git(root, ['cat-file', '-e', `${sha}^{commit}`]);
    if (eventName === 'push' && checkout !== head) return full('Checkout does not match push head; run the full selection.');
    if (eventName === 'pull_request') {
      for (const sha of [base, head]) git(root, ['merge-base', '--is-ancestor', sha, checkout]);
    }
    const range = `${base}${eventName === 'pull_request' ? '...' : '..'}${head}`;
    const output = git(root, ['diff', '--name-status', '-z', '--no-renames', range, '--']);
    const changes = output ? parseNameStatus(output) : [];
    return { ...classifyChanges(changes, file => isIsolatedSpec(root, file)), base, head, checkout, range, changes };
  } catch {
    return full('Comparison history or file ownership could not be verified; run the full selection.');
  }
}

export function playwrightArgs(selection, shard) {
  validateShard(shard, 'BROWSER_REGRESSION_SHARD');
  const args = ['test', '--config=tests/e2e/playwright.config.mjs'];
  if (selection.mode !== 'full' || selection.specs.length !== 0) {
    if (selection.mode !== 'specs' || !selection.specs.length
      || selection.specs.some(file => !isolatedSpecs.includes(file))) throw new Error('Invalid browser execution selection');
    // Reuse the manual WebKit exact-file convention: Playwright filters are regexes.
    args.push(...selection.specs.map(file => `(^|/)${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  }
  // A narrowed selection runs in every leg, without sharding: Playwright shards
  // by test group, so even two selected files can leave one shard empty.
  // Duplication is bounded by the isolated-spec allowlist; full always shards.
  if (shard !== undefined && selection.mode === 'full') args.push(`--shard=${shard}`);
  return args;
}

export function main(root, command, env = process.env) {
  if (command === 'select') {
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const selection = { schemaVersion: 1, ...selectFromEvent(root, env.GITHUB_EVENT_NAME, event) };
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, reportPath), `${JSON.stringify(selection, null, 2)}\n`);
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `mode=${selection.mode}\n`);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY,
      `Browser selection: **${selection.mode}**. ${selection.reason}\n\nSelected specs: ${selection.specs.length}. See the browser-selection artifact for comparison evidence. A selected or not-needed result is not a full-browser pass.\n`);
    process.stdout.write(`${JSON.stringify(selection)}\n`);
    return 0;
  }
  if (command === 'run') {
    const selection = JSON.parse(fs.readFileSync(path.join(root, reportPath), 'utf8'));
    const args = playwrightArgs(selection, env.BROWSER_REGRESSION_SHARD);
    const shardArg = args.find(arg => arg.startsWith('--shard='));
    process.stdout.write(`Browser execution: ${selection.mode}, ${shardArg
      ? `sharded ${shardArg.slice('--shard='.length)}`
      : env.BROWSER_REGRESSION_SHARD !== undefined ? 'unsharded-narrow' : 'unsharded'}\n`);
    return runPlaywright(root, args);
  }
  throw new Error('Expected select or run');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.cwd(), process.argv[2]);
}
