import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RULES_API_ORIGIN = 'https://firebaserules.googleapis.com';

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fetchRulesApi(path, accessToken) {
  const response = await fetch(`${RULES_API_ORIGIN}/v1/${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const responseBody = (await response.text()).slice(0, 2000);
    throw new Error(
      `Firebase Rules API request failed (${response.status}): ${responseBody}`,
    );
  }

  return response.json();
}

export async function verifyDeployedFirestoreRules({
  projectId,
  accessToken,
  rulesPath = 'firestore.rules',
}) {
  if (!projectId) {
    throw new Error('GCP_PROJECT_ID is required.');
  }
  if (!accessToken) {
    throw new Error('GOOGLE_OAUTH_ACCESS_TOKEN is required.');
  }

  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const release = await fetchRulesApi(releaseName, accessToken);
  const rulesetName = release.rulesetName;

  if (
    typeof rulesetName !== 'string' ||
    !rulesetName.startsWith(`projects/${projectId}/rulesets/`)
  ) {
    throw new Error(
      'The production Firestore release returned an invalid ruleset name.',
    );
  }

  const ruleset = await fetchRulesApi(rulesetName, accessToken);
  const deployedFile = ruleset.source?.files?.find(
    (file) => file.name === rulesPath || file.name?.endsWith(`/${rulesPath}`),
  );

  if (typeof deployedFile?.content !== 'string') {
    throw new Error(`The deployed ruleset does not contain ${rulesPath}.`);
  }

  const localContent = normalizeLineEndings(await readFile(rulesPath, 'utf8'));
  const deployedContent = normalizeLineEndings(deployedFile.content);
  const localHash = sha256(localContent);
  const deployedHash = sha256(deployedContent);

  if (localHash !== deployedHash) {
    throw new Error(
      `Production Firestore rules do not match ${rulesPath}: local ${localHash}, deployed ${deployedHash}.`,
    );
  }

  return {
    rulesetName,
    createTime: release.createTime ?? ruleset.createTime ?? 'unknown',
    sha256: deployedHash,
  };
}

async function main() {
  const result = await verifyDeployedFirestoreRules({
    projectId: process.env.GCP_PROJECT_ID,
    accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN,
  });

  console.log(
    `Verified production Firestore rules: ${result.rulesetName} ` +
      `(created ${result.createTime}, sha256 ${result.sha256}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
