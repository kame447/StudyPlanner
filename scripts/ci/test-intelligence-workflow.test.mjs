import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);
const fullSuiteCommand = /^        run: npm run (?:test:run|verify)(?: --(?: --[\w.-]+(?:=\S+)?)*)?$/m;

function jobs(source) {
  const section = source.split('\njobs:\n')[1] ?? '';
  return [...section.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)]
    .map(([, name, body]) => ({ name, body }));
}

function checkoutFor(job) {
  const checkout = job.body.match(/^      - uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=^      - |$(?![\s\S]))/m)?.[1];
  if (!checkout) throw new Error(`Checkout is missing for ${job.name}`);
  return checkout;
}

const fullSuiteJobs = fs.readdirSync(workflowDirectory).filter(name => /\.ya?ml$/.test(name))
  .flatMap(file => jobs(fs.readFileSync(new URL(file, workflowDirectory), 'utf8'))
    .filter(job => fullSuiteCommand.test(job.body))
    .map(job => ({ ...job, file })));

describe('Test Intelligence historical Worker compatibility precondition', () => {
  it('discovers full-suite jobs including coverage without treating focused tests as full runs', () => {
    expect(fullSuiteJobs.map(({ file, name }) => `${file}:${name}`)).toContain('test-intelligence.yml:coverage');
    expect(fullSuiteCommand.test('        run: npm run test -- --run focused.test.ts')).toBe(false);
    expect(fullSuiteCommand.test('        run: npm run test:run -- focused.test.ts')).toBe(false);
    expect(fullSuiteCommand.test('        run: npm run verify')).toBe(true);
  });

  it.each(fullSuiteJobs)('$file:$name fetches full history before archiving the immutable old Worker', job => {
    expect(checkoutFor(job)).toMatch(/^          fetch-depth: 0$/m);
    expect(checkoutFor(job)).toMatch(/^          persist-credentials: false$/m);
  });

  it.each(['          fetch-depth: 1\n', ''])('detects shallow/default history even when another job has full history (%j)', depth => {
    const fixture = `name: Fixture\njobs:\n  coverage:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n${depth}          persist-credentials: false\n      - name: Run tests\n        run: npm run test:run -- --coverage\n  unrelated:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n`;
    const [job] = jobs(fixture).filter(candidate => fullSuiteCommand.test(candidate.body));
    expect(job.name).toBe('coverage');
    expect(checkoutFor(job)).not.toMatch(/^          fetch-depth: 0$/m);
  });
});
