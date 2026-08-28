import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyDeployedFirestoreRules } from './verify-deployed-firestore-rules.mjs';

const PROJECT_ID = 'test-project';
const RULESET_NAME = `projects/${PROJECT_ID}/rulesets/ruleset-1`;

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('verifyDeployedFirestoreRules', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('confirms that the production release contains the local rules', async () => {
    const localRules = await readFile('firestore.rules', 'utf8');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          name: `projects/${PROJECT_ID}/releases/cloud.firestore`,
          rulesetName: RULESET_NAME,
          createTime: '2026-08-28T12:00:00Z',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          name: RULESET_NAME,
          source: {
            files: [{ name: 'firestore.rules', content: localRules }],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await verifyDeployedFirestoreRules({
      projectId: PROJECT_ID,
      accessToken: 'test-access-token',
    });

    expect(result).toMatchObject({
      rulesetName: RULESET_NAME,
      createTime: '2026-08-28T12:00:00Z',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      'Bearer test-access-token',
    );
  });

  it('fails when the production release differs from the local rules', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          rulesetName: RULESET_NAME,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          source: {
            files: [{ name: 'firestore.rules', content: 'rules_version = \'1\';' }],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      verifyDeployedFirestoreRules({
        projectId: PROJECT_ID,
        accessToken: 'test-access-token',
      }),
    ).rejects.toThrow('Production Firestore rules do not match');
  });
});
