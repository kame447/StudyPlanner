# Preparation only. No server/browser/API/dependency installation is started here.
from pathlib import Path
import argparse, hashlib, json
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--output',required=True);p.add_argument('--playwright',required=True);p.add_argument('--artifact',required=True);p.add_argument('--expected-spec-sha',required=True)
a=p.parse_args();root=Path(a.root).resolve();out=Path(a.output).resolve();pw=Path(a.playwright).resolve();out.mkdir(parents=True,exist_ok=True)
shared=Path(__file__).parent
spec=(root/'tests/e2e/weekly-correction-integrity.real-api.mjs').read_text()
assert len(a.expected_spec_sha)==64 and hashlib.sha256(spec.encode()).hexdigest()==a.expected_spec_sha, 'Unexpected reviewed live spec bytes'
prefix=spec.split("test('two bounded real-model conversations through the production App'",1)[0]
assert len(prefix)<len(spec)
# Reuse unchanged fixed-clock/startup helpers with only absolute import plumbing for the shared-only replay.
startup=(root/'tests/e2e/support/startup-ready.mjs').read_text().replace("'@playwright/test'",json.dumps((pw/'@playwright/test/index.mjs').as_uri()))
(out/'startup-ready.mjs').write_text(startup)
(out/'fixed-clock.mjs').write_bytes((root/'tests/e2e/support/fixed-clock.mjs').read_bytes())
prefix=prefix.replace("import { request } from '@playwright/test';", "import { readFileSync } from 'node:fs';")
prefix=prefix.replace("'./support/fixed-clock.mjs'", "'./fixed-clock.mjs'")
artifact=Path(a.artifact).resolve()
assert hashlib.sha256(artifact.read_bytes()).hexdigest()=='34876646a37f92e17ad62a47ba722cc59737b03d99f8445baa00e9590156157d', 'Recorded artifact digest mismatch'
constants=f'const REPLAY_ARTIFACT = {json.dumps(str(artifact))};\nconst REPLAY_OUTPUT = {json.dumps(str(out/"evidence"))};\n'
(out/'offline-replay.spec.mjs').write_text(prefix+'\n'+constants+(shared/'weekly-correction-offline-replay.fixture.mjs').read_text())
(out/'offline-vite.config.mjs').write_text(f'import original from {json.dumps((root/"tests/e2e/harness/vite.config.mjs").as_uri())};\nexport default {{ ...original, cacheDir: {json.dumps(str(out/"vite-cache"))} }};\n')
config=f'''import {{ defineConfig }} from {json.dumps((pw/'@playwright/test/index.mjs').as_uri())};
if (process.env.OPENAI_API_KEY || process.env.VITE_AI_API_KEY) throw new Error('Offline replay requires a credential-free process.');
export default defineConfig({{
  testDir: {json.dumps(str(out))}, testMatch: 'offline-replay.spec.mjs', workers: 1, retries: 0, repeatEach: 1, maxFailures: 1,
  timeout: 310_000, globalTimeout: 360_000, reporter: [['list'], ['json', {{ outputFile: {json.dumps(str(out/'evidence/playwright-report.json'))} }}]], outputDir: {json.dumps(str(out/'results'))},
  use: {{ trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block', launchOptions: {{ env: {{ ...process.env, OPENAI_API_KEY: '', VITE_AI_API_KEY: '' }} }} }},
  projects: [{{ name: 'chromium', use: {{ browserName: 'chromium' }} }}],
  webServer: [{{ command: {json.dumps('node ./node_modules/vite/bin/vite.js --config '+str(out/'offline-vite.config.mjs'))},
    cwd: {json.dumps(str(root))}, url: 'http://127.0.0.1:4174/full-planner-recovery.html', reuseExistingServer: false, timeout: 30_000,
    env: {{ STUDYPLANNER_CORRECTION_REAL_API: '1', OPENAI_API_KEY: '', VITE_AI_API_KEY: '' }} }}],
}});
'''
(out/'offline-replay.config.mjs').write_text(config)
manifest={'candidateSpecSha256':hashlib.sha256(spec.encode()).hexdigest(),'root':str(root),'playwright':str(pw),'browserSelection':'Playwright default headless-shell, no channel/executablePath','artifactSha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'generatedFiles':{str(f.relative_to(out)):hashlib.sha256(f.read_bytes()).hexdigest() for f in out.iterdir() if f.is_file()},'execution':'not run'}
(out/'preparation-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
