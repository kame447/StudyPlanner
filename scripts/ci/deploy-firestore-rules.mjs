import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RULES_API_ORIGIN = 'https://firebaserules.googleapis.com';

async function rulesApiRequest(path, accessToken, options = {}) {
  const response = await fetch(`${RULES_API_ORIGIN}/v1/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
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

export async function deployFirestoreRules({
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

  const content = await readFile(rulesPath, 'utf8');
  const ruleset = await rulesApiRequest(
    `projects/${projectId}/rulesets`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        source: {
          files: [{ name: rulesPath, content }],
        },
      }),
    },
  );
  const rulesetName = ruleset.name;

  if (
    typeof rulesetName !== 'string' ||
    !rulesetName.startsWith(`projects/${projectId}/rulesets/`)
  ) {
    throw new Error('The Firebase Rules API returned an invalid ruleset name.');
  }

  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const release = await rulesApiRequest(releaseName, accessToken, {
    method: 'PATCH',
    body: JSON.stringify({
      release: {
        name: releaseName,
        rulesetName,
      },
      updateMask: 'rulesetName',
    }),
  });

  if (release.rulesetName !== rulesetName) {
    throw new Error('The Firestore release did not select the new ruleset.');
  }

  return {
    releaseName,
    rulesetName,
    updateTime: release.updateTime ?? 'unknown',
  };
}

async function main() {
  const result = await deployFirestoreRules({
    projectId: process.env.GCP_PROJECT_ID,
    accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN,
  });

  console.log(
    `Deployed production Firestore rules: ${result.rulesetName} ` +
      `(release ${result.releaseName}, updated ${result.updateTime}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
