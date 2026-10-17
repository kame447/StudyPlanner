import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(new URL('../../.github/workflows/qa-result-summary.yml', import.meta.url), 'utf8');
const script = workflow.split('          script: |\n')[1].split('\n').map(line => line.slice(12)).join('\n');
const execute = new (Object.getPrototypeOf(async function () {}).constructor)('context', 'github', 'core', script);
const standardMarker = '<!-- studyplanner-qa-summary:UI Regression Matrix -->';
const targetedMarker = '<!-- studyplanner-qa-summary:UI Regression Matrix:targeted-webkit -->';
const job = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion, html_url: 'https://example.test/job' });

function fixture() {
  const comments = [], writes = [], notices = [];
  const currentPr = { number: 714, state: 'open', head: { sha: 'verified-head', repo: { full_name: 'owner/repo' } } };
  const reads = { listPulls: 0, getPulls: [], jobs: 0 };
  let jobs = [];
  const github = { rest: {
    pulls: {
      list: async () => { reads.listPulls += 1; return { data: [currentPr] }; },
      get: async ({ pull_number }) => { reads.getPulls.push(pull_number); return { data: currentPr }; },
    },
    actions: { listJobsForWorkflowRun: async () => { reads.jobs += 1; return { data: { jobs } }; } },
    issues: {
      listComments: async () => ({ data: comments }),
      createComment: async ({ body }) => {
        const comment = { id: comments.length + 1, user: { type: 'Bot' }, body };
        comments.push(comment); writes.push({ type: 'create', id: comment.id, body });
      },
      updateComment: async ({ comment_id, body }) => {
        comments.find(comment => comment.id === comment_id).body = body;
        writes.push({ type: 'update', id: comment_id, body });
      },
    },
  } };
  return { comments, writes, notices, currentPr, reads, async run(selectedJobs, { name = 'UI Regression Matrix', event = 'workflow_dispatch', conclusion = 'success', headRepository = { full_name: 'owner/repo' }, headSha = 'verified-head' } = {}) {
    jobs = selectedJobs;
    await execute({ repo: { owner: 'owner', repo: 'repo' }, payload: { workflow_run: {
      id: writes.length + 100, name, event, status: 'completed', conclusion,
      head_sha: headSha, head_repository: headRepository, head_branch: 'review-branch', html_url: 'https://example.test/run',
      pull_requests: event === 'pull_request' ? [{ number: 714 }] : [],
    } } }, github, { notice: message => notices.push(message) });
  } };
}

describe('QA summary scope isolation', () => {
  it('retains a cancelled full result when targeted success follows on the same PR branch', async () => {
    const f = fixture();
    await f.run([job('cross-browser-smoke', 'cancelled')], { event: 'pull_request', conclusion: 'cancelled' });
    const original = f.comments[0].body;
    await f.run([job('visual-regression', 'skipped'), job('targeted-webkit (webkit-mobile)'), job('targeted-webkit-summary')]);
    expect(f.comments).toHaveLength(2);
    expect(f.comments.find(comment => comment.body.includes(standardMarker))?.body).toBe(original);
    const targeted = f.comments.find(comment => comment.body.includes(targetedMarker))?.body;
    expect(targeted).toContain('Diagnostic only');
    expect(targeted).toContain('does not replace the full UI Regression Matrix gate');
    expect(targeted).toContain('"scope": "targeted-webkit"');
    expect(targeted).toContain('targeted-webkit-summary');
  });

  it('updates only the targeted comment on subsequent diagnostics, then preserves it on a full result', async () => {
    const f = fixture();
    await f.run([job('targeted-webkit-summary', 'failure')], { conclusion: 'failure' });
    await f.run([job('targeted-webkit-summary')]);
    expect(f.comments).toHaveLength(1);
    expect(f.writes.map(write => write.type)).toEqual(['create', 'update']);
    const targeted = f.comments[0].body;
    await f.run([job('cross-browser-smoke', 'failure')], { event: 'pull_request', conclusion: 'failure' });
    expect(f.comments).toHaveLength(2);
    expect(f.comments[0].body).toBe(targeted);
    expect(f.comments[1].body).toContain(standardMarker);
  });

  it.each([
    ['empty', []],
    ['skipped visual only', [job('visual-regression', 'skipped')]],
    ['cancelled visual only', [job('visual-regression', 'cancelled')]],
    ['unknown', [job('unrecognized-project')]],
    ['mixed', [job('cross-browser-smoke'), job('targeted-webkit-summary')]],
  ])('does not overwrite a full summary with %s Matrix evidence', async (_, jobs) => {
    const f = fixture();
    await f.run([job('cross-browser-smoke', 'failure')], { conclusion: 'failure' });
    const original = f.comments[0].body;
    await f.run(jobs);
    expect(f.writes).toHaveLength(1);
    expect(f.comments[0].body).toBe(original);
    expect(f.notices).toHaveLength(1);
  });

  it.each([
    ['standard project', [job('cross-browser-projects (webkit-mobile)')], standardMarker],
    ['completed visual', [job('visual-regression')], standardMarker],
    ['targeted project', [job('visual-regression', 'skipped'), job('targeted-webkit (webkit-mobile)', 'cancelled')], targetedMarker],
  ])('recognizes %s when the summary job is unavailable', async (_, jobs, marker) => {
    const f = fixture();
    await f.run(jobs);
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0].body).toContain(marker);
  });

  it('retains the existing marker and replacement behavior for other workflows', async () => {
    const f = fixture();
    await f.run([job('chromium')], { name: 'Browser Regression' });
    await f.run([job('chromium', 'failure')], { name: 'Browser Regression', conclusion: 'failure' });
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0].body).toContain('<!-- studyplanner-qa-summary:Browser Regression -->');
    expect(f.comments[0].body).toContain('Run conclusion: `failure`');
    expect(f.comments[0].body).not.toContain('Diagnostic only');
  });
});

describe('QA summary source association', () => {
  it.each(['workflow_dispatch', 'pull_request'])('rejects a fork run before looking up or writing PR summaries via %s', async event => {
    const f = fixture();
    await f.run([job('cross-browser-smoke')], { event, headRepository: { full_name: 'contributor/fork' } });
    expect(f.writes).toEqual([]);
    expect(f.reads).toEqual({ listPulls: 0, getPulls: [], jobs: 0 });
    expect(f.notices).toHaveLength(1);
  });

  it.each(['workflow_dispatch', 'pull_request'])('rejects a newer PR head instead of attaching stale results via %s', async event => {
    const f = fixture();
    f.currentPr.head.sha = 'newer-pr-head';
    await f.run([job('cross-browser-smoke')], { event });
    expect(f.reads.getPulls).toEqual([714]);
    expect(f.reads.jobs).toBe(0);
    expect(f.writes).toEqual([]);
  });

  it('preserves an existing current-head summary when an older run finishes later', async () => {
    const f = fixture();
    f.currentPr.head.sha = 'newer-pr-head';
    await f.run([job('cross-browser-smoke', 'failure')], { headSha: 'newer-pr-head', conclusion: 'failure' });
    const current = f.comments[0].body;
    await f.run([job('cross-browser-smoke')]);
    expect(f.writes).toHaveLength(1);
    expect(f.comments[0].body).toBe(current);
  });

  it.each([
    ['foreign repository', pr => { pr.head.repo.full_name = 'contributor/fork'; }],
    ['deleted head repository', pr => { pr.head.repo = null; }],
    ['missing head SHA', pr => { delete pr.head.sha; }],
    ['closed PR', pr => { pr.state = 'closed'; }],
  ])('rejects a directly associated PR with %s after fetching its current identity', async (_, mutate) => {
    const f = fixture();
    mutate(f.currentPr);
    await f.run([job('cross-browser-smoke')], { event: 'pull_request' });
    expect(f.reads.getPulls).toEqual([714]);
    expect(f.reads.jobs).toBe(0);
    expect(f.writes).toEqual([]);
  });

  it.each([
    ['missing repository', { headRepository: null }],
    ['missing SHA', { headSha: null }],
    ['empty SHA', { headSha: '' }],
  ])('does not publish when the run has %s', async (_, options) => {
    const f = fixture();
    await f.run([job('cross-browser-smoke')], options);
    expect(f.reads).toEqual({ listPulls: 0, getPulls: [], jobs: 0 });
    expect(f.writes).toEqual([]);
  });

  it.each(['workflow_dispatch', 'pull_request'])('preserves standard and targeted updates for verified same-repository/SHA runs via %s', async event => {
    const f = fixture();
    await f.run([job('cross-browser-smoke')], { event });
    await f.run([job('cross-browser-smoke', 'failure')], { event, conclusion: 'failure' });
    await f.run([job('targeted-webkit-summary')], { event });
    expect(f.reads.getPulls).toEqual([714, 714, 714]);
    expect(f.writes.map(write => write.type)).toEqual(['create', 'update', 'create']);
    expect(f.comments[0].body).toContain(standardMarker);
    expect(f.comments[1].body).toContain(targetedMarker);
  });
});

describe('QA summary metadata rendering', () => {
  it('keeps job links and HTML as literal display text while preserving raw machine-readable evidence', async () => {
    const f = fixture();
    const name = '[Review](https://example.test/) </code><b>claimed success</b>';
    await f.run([job('cross-browser-smoke'), job(name)]);
    const body = f.comments[0].body;
    const renderedTable = body.split('<details>')[0];
    expect(renderedTable).toContain('<code>&#91;Review&#93;&#40;https&#58;&#47;&#47;example&#46;test&#47;&#41; &#60;&#47;code&#62;&#60;b&#62;claimed success&#60;&#47;b&#62;</code>');
    expect(renderedTable).not.toContain(name);
    const payload = JSON.parse(body.split('```json\n')[1].split('\n```')[0]);
    expect(payload.jobs[1].name).toBe(name);
  });

  it.each([
    ['pipe and backslash', 'one \\| two', 'one &#92;&#124; two'],
    ['backticks and newlines', 'one `code`\r\n# extra row', 'one &#96;code&#96; &#35; extra row'],
    ['existing entities', '&lt;b&gt;', '&#38;lt&#59;b&#38;gt&#59;'],
    ['plain URL and mention', 'https://example.test @name', 'https&#58;&#47;&#47;example&#46;test &#64;name'],
  ])('renders %s without introducing Markdown structure', async (_, name, expected) => {
    const f = fixture();
    await f.run([job(name)], { name: 'Browser Regression' });
    const table = f.comments[0].body.split('<details>')[0];
    expect(table).toContain(`| <code>${expected}</code> | completed | success |`);
    expect(table.split('\n').filter(line => line.startsWith('| '))).toHaveLength(3);
  });

  it('does not treat a marker inside job metadata as another workflow summary identity', async () => {
    const f = fixture();
    const foreignMarker = '<!-- studyplanner-qa-summary:Browser Regression -->';
    await f.run([job('cross-browser-smoke'), job(foreignMarker)]);
    const original = f.comments[0].body;
    // The raw marker deliberately remains in the JSON evidence.
    expect(original).toContain(foreignMarker);
    await f.run([job('chromium')], { name: 'Browser Regression' });
    expect(f.writes.map(write => write.type)).toEqual(['create', 'create']);
    expect(f.comments[0].body).toBe(original);
    expect(f.comments[1].body.startsWith(`${foreignMarker}\n`)).toBe(true);
  });
});
