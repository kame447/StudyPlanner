import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/deploy-firestore-rules.yml');
const manifest = JSON.parse(read('package.json'));
const toolManifest = JSON.parse(read('tools/firebase-tools/package.json'));
const lockfile = JSON.parse(read('tools/firebase-tools/package-lock.json'));
const ci = read('.github/workflows/ci.yml');
const jobs = new Map([...workflow.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)]
  .filter((match) => workflow.indexOf(match[0]) > workflow.indexOf('\njobs:\n'))
  .map(([, name, body]) => [name, body]));

describe('Firestore Rules deployment trust boundary', () => {
  it('runs the emulator with read-only repository permission and no OIDC token', () => {
    expect(workflow.split('\njobs:\n')[0]).toMatch(/\npermissions: \{\}\n/);
    expect([...jobs.keys()]).toEqual(['test', 'deploy']);
    expect(jobs.get('test').match(/^    permissions:\n((?:      [^\n]*\n)+)/m)?.[1]).toBe('      contents: read\n');
    expect(jobs.get('test')).not.toContain('id-token');
    expect(jobs.get('test')).toContain('run: npm ci');
    expect(jobs.get('test')).toContain('run: npm ci --prefix tools/firebase-tools --ignore-scripts');
    expect(jobs.get('test')).toContain('run: npm run test:firestore-rules');
    expect(jobs.get('test')).toContain("java-version: '21'");
  });

  it('grants OIDC only to the deploy job after the test job succeeds', () => {
    const deploy = jobs.get('deploy');
    expect(deploy).toMatch(/^    needs: test$/m);
    expect(deploy).toMatch(/    permissions:\n      contents: read\n      id-token: write\n/);
    expect(workflow.match(/id-token:/g)).toHaveLength(1);
    expect(deploy).toContain("if: github.repository == 'kame447/StudyPlanner'");
  });

  it('executes only the two dependency-free Node scripts in the privileged job', () => {
    const deploy = jobs.get('deploy');
    expect([...deploy.matchAll(/^        run: (.+)$/gm)].map(([, command]) => command)).toEqual([
      'node scripts/ci/deploy-firestore-rules.mjs',
      'node scripts/ci/verify-deployed-firestore-rules.mjs',
    ]);
    expect(deploy).not.toMatch(/\b(?:npm|npx)\b/);
    expect(deploy).not.toMatch(/^\s+cache:/m);
    expect(deploy).toContain('package-manager-cache: false');
    expect(deploy).toContain('persist-credentials: false');
  });

  it('pins every privileged action to a full commit SHA', () => {
    const actions = [...jobs.get('deploy').matchAll(/(?:- )?uses: ([^\s@]+)@([^\s]+)(.*)/g)];
    expect(actions.map(([, name]) => name)).toEqual([
      'actions/checkout', 'actions/setup-node', 'google-github-actions/auth',
    ]);
    for (const [, , revision, comment] of actions) {
      expect(revision).toMatch(/^[a-f0-9]{40}$/);
      expect(comment).toMatch(/ # v\d/);
    }
  });

  it('keeps deploy and read-back imports restricted to Node built-ins', () => {
    for (const path of ['scripts/ci/deploy-firestore-rules.mjs', 'scripts/ci/verify-deployed-firestore-rules.mjs']) {
      const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const imports = [];
      function inspect(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) {
          imports.push(node.moduleSpecifier);
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
          imports.push(node.arguments[0]);
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
      expect(imports.length).toBeGreaterThan(0);
      for (const specifier of imports) {
        expect(ts.isStringLiteral(specifier), path).toBe(true);
        expect(isBuiltin(specifier.text), `${path}: ${specifier.text}`).toBe(true);
      }
    }
  });

  it('locks the local Firebase CLI and never fetches a latest CLI in npm scripts', () => {
    const version = toolManifest.devDependencies['firebase-tools'];
    expect(toolManifest.private).toBe(true);
    expect(manifest.devDependencies['firebase-tools']).toBeUndefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lockfile.packages[''].devDependencies['firebase-tools']).toBe(version);
    expect(lockfile.packages['node_modules/firebase-tools']).toMatchObject({ version, dev: true });
    expect(lockfile.packages['node_modules/firebase-tools'].integrity).toMatch(/^sha512-/);
    expect(manifest.scripts['test:firestore-rules']).toMatch(/^node scripts\/ci\/firestore-tools\.mjs emulators:exec --only auth,firestore --project demo-studyplanner /);
    expect(manifest.scripts['deploy:firestore-rules']).toBe('node scripts/ci/firestore-tools.mjs deploy --only firestore:rules');
    for (const command of Object.values(manifest.scripts)) {
      expect(command).not.toMatch(/npx\s+--yes\s+firebase-tools\b/);
    }
    expect(ci.indexOf('run: npm ci --prefix tools/firebase-tools --ignore-scripts')).toBeGreaterThan(0);
    expect(ci.indexOf('run: npm ci --prefix tools/firebase-tools --ignore-scripts')).toBeLessThan(ci.indexOf('run: npm run test:firestore-rules'));
    expect(read('.github/dependabot.yml')).toContain('directory: /tools/firebase-tools');
  });
});
