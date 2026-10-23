import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, 'dist');
const reportDir = path.join(repoRoot, 'artifacts', 'quality-gate');
const reportPath = path.join(reportDir, 'bundle-budget.json');

const budgets = {
  javascript: {
    // Owner decision based on measured main/PR baseline, 2026-10-21 (#305/#826):
    // main 22e42203 plus PR #826's
    // measured +18,556 raw / +6,448 gzip bytes, with no added headroom.
    // Exact written-output baseline c309b457, same dependencies/environment.
    // History, fingerprints and composition: docs/work/tooling-operations-runbook.md
    // (bundle-budget section). Reduction remains tracked in #321.
    // Owner decision based on measured release increment, 2026-10-21 (#305 release)
    // f1f347c5 -> 408b151d: +435/+219 aggregate raw/gzip and +435/+245
    // largest raw/gzip bytes, solely D5 v2 policy data; no added headroom.
    // Owner decision based on measured commit-rejection fallback increment, 2026-10-21 (#305 rejection fallback)
    // Base 8568c8aa -> guarded fallback: +2425/+608 aggregate raw/gzip,
    // +2425/+572 largest raw/gzip, including the audited checkpoint facade; no headroom.
    // Owner decision: measured same-chat ownership fix adds +148 aggregate raw bytes (#305), no headroom.
    totalRaw: 2_617_120,
    totalGzip: 711_893,
    largestRaw: 1_050_074,
    largestGzip: 289_210,
  },
  css: {
    // Same owner decision: PR #826 changes no CSS. Aggregate limits
    // equal measured main exactly; largest-chunk and appearance guards stay put.
    // Owner decision, 2026-10-23 (#841/#842): record-phase scroll inset adds
    // measured +39 raw / +7 gzip aggregate bytes, with no added headroom.
    // Largest-chunk and appearance limits remain unchanged.
    totalRaw: 513_993,
    totalGzip: 89_918,
    largestRaw: 425_000,
    largestGzip: 70_000,
  },
  appearance: { stylesheetRaw: 8_000, fontRaw: 512_000 },
};

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function summarize(files) {
  const entries = files.map((file) => {
    const contents = fs.readFileSync(file);
    return {
      file: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
      raw: contents.byteLength,
      gzip: zlib.gzipSync(contents, { level: 9 }).byteLength,
    };
  });
  return {
    totalRaw: entries.reduce((sum, entry) => sum + entry.raw, 0),
    totalGzip: entries.reduce((sum, entry) => sum + entry.gzip, 0),
    largestRaw: Math.max(0, ...entries.map((entry) => entry.raw)),
    largestGzip: Math.max(0, ...entries.map((entry) => entry.gzip)),
    files: entries.sort((a, b) => b.raw - a.raw),
  };
}

if (!fs.existsSync(distDir)) {
  throw new Error('dist/ does not exist. Run the production build before checking the bundle budget.');
}

const files = walk(distDir);
const appearanceStylesheets = files.filter(file => /^appearance-pixel-.*\.css$/.test(path.basename(file)));
const appearanceFont = path.join(distDir, 'fonts', 'DotGothic16-Regular.woff2');
if (appearanceStylesheets.length !== 1 || !fs.existsSync(appearanceFont)) {
  throw new Error('Expected one optional dot stylesheet and its self-hosted WOFF2 font.');
}
const report = {
  generatedAt: new Date().toISOString(),
  javascript: summarize(files.filter((file) => /\.(?:m?js)$/i.test(file))),
  css: summarize(files.filter((file) => /\.css$/i.test(file))),
  appearance: {
    stylesheetRaw: fs.statSync(appearanceStylesheets[0]).size,
    fontRaw: fs.statSync(appearanceFont).size,
  },
  budgets,
  violations: [],
};

for (const kind of ['javascript', 'css']) {
  for (const metric of ['totalRaw', 'totalGzip', 'largestRaw', 'largestGzip']) {
    const actual = report[kind][metric];
    const limit = budgets[kind][metric];
    if (actual > limit) {
      report.violations.push({ kind, metric, actual, limit });
    }
  }
}

for (const metric of ['stylesheetRaw', 'fontRaw']) {
  const actual = report.appearance[metric], limit = budgets.appearance[metric];
  if (actual > limit) report.violations.push({ kind: 'appearance', metric, actual, limit });
}

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
for (const kind of ['javascript', 'css']) {
  console.log(
    `${kind}: raw ${formatKiB(report[kind].totalRaw)}, gzip ${formatKiB(report[kind].totalGzip)}, ` +
      `largest raw ${formatKiB(report[kind].largestRaw)}, largest gzip ${formatKiB(report[kind].largestGzip)}`,
  );
}

console.log(`optional dot appearance: CSS ${report.appearance.stylesheetRaw} B, WOFF2 ${report.appearance.fontRaw} B`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = ['| Asset | Total raw | Total gzip | Largest raw | Largest gzip |', '| --- | ---: | ---: | ---: | ---: |'];
  for (const kind of ['javascript', 'css']) {
    rows.push(`| ${kind} | ${formatKiB(report[kind].totalRaw)} | ${formatKiB(report[kind].totalGzip)} | ${formatKiB(report[kind].largestRaw)} | ${formatKiB(report[kind].largestGzip)} |`);
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Bundle budget\n\n${rows.join('\n')}\n`);
}

if (report.violations.length > 0) {
  for (const violation of report.violations) {
    console.error(
      `Bundle budget exceeded: ${violation.kind}.${violation.metric} ${formatKiB(violation.actual)} > ${formatKiB(violation.limit)}`,
    );
  }
  process.exitCode = 1;
}
