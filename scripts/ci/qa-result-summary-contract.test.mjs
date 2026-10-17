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
  let jobs = [];
  const github = { rest: {
    pulls: { list: async () => ({ data: [{ number: 714, head: { repo: { full_name: 'owner/repo' } } }] }) },
    actions: { listJobsForWorkflowRun: async () => ({ data: { jobs } }) },
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
  return { comments, writes, notices, async run(selectedJobs, { name = 'UI Regression Matrix', event = 'workflow_dispatch', conclusion = 'success' } = {}) {
    jobs = selectedJobs;
    await execute({ repo: { owner: 'owner', repo: 'repo' }, payload: { workflow_run: {
      id: writes.length + 100, name, event, status: 'completed', conclusion,
      head_sha: 'verified-head', head_branch: 'review-branch', html_url: 'https://example.test/run',
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
