import { pathToFileURL } from 'node:url';

// https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
// Only reviewed, supported release lines are accepted; a future major needs review.
export const patchedNodeMinimums = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };

export function isPatchedNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  const minimum = patchedNodeMinimums[major];
  return Boolean(minimum && (minor > minimum[0] || minor === minimum[0] && patch >= minimum[1]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!isPatchedNodeVersion(process.versions.node)) {
    console.error(`Unsupported or unpatched Node.js ${process.version}. Upgrade to the .node-version release (22.23.4), or patched 24.22.1 / 26.12.1 or later within the same major, before installing dependencies or running tooling.`);
    process.exitCode = 1;
  } else {
    console.log(`Node.js ${process.version}: October 2026 security minimum satisfied.`);
  }
}
