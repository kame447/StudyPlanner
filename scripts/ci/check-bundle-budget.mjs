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
    // Eight-UI-feature integration candidate a6f25ab3: 2,255,608 raw / 606,339 gzip.
    // Versus the 2,235,709 / 601,042 baseline: +19,899 raw (0.890%) / +5,297 gzip (0.881%).
    // Independent audit: 28 chunks, four vendor SHA values and package/lock/Vite unchanged;
    // no test-only imports. Growth matches the added runtime behavior, not dependencies.
    // Calibrate only aggregate JS totals; preserve both per-chunk and all four CSS guards.
    totalRaw: 2_260_000,
    totalGzip: 608_000,
    largestRaw: 950_000,
    largestGzip: 260_000,
  },
  css: {
    // Standalone settings and Home scenes: measured raw total ~480.2 KB after dead-CSS cleanup.
    // Calibrate only the three exceeded raw guards; retain every gzip guard.
    totalRaw: 485_000,
    totalGzip: 85_000,
    largestRaw: 425_000,
    largestGzip: 70_000,
  },
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
const report = {
  generatedAt: new Date().toISOString(),
  javascript: summarize(files.filter((file) => /\.(?:m?js)$/i.test(file))),
  css: summarize(files.filter((file) => /\.css$/i.test(file))),
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

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
for (const kind of ['javascript', 'css']) {
  console.log(
    `${kind}: raw ${formatKiB(report[kind].totalRaw)}, gzip ${formatKiB(report[kind].totalGzip)}, ` +
      `largest raw ${formatKiB(report[kind].largestRaw)}, largest gzip ${formatKiB(report[kind].largestGzip)}`,
  );
}

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
