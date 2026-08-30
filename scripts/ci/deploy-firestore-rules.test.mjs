import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployFirestoreRules } from './deploy-firestore-rules.mjs';

const PROJECT_ID = 'test-project';
const RULESET_NAME = `projects/${PROJECT_ID}/rulesets/ruleset-1`;
const RELEASE_NAME = `projects/${PROJECT_ID}/releases/cloud.firestore`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('deployFirestoreRules', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an immutable ruleset and selects it for Firestore', async () => {
    const localRules = await readFile('firestore.rules', 'utf8');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ name: RULESET_NAME, createTime: '2026-08-28T12:00:00Z' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          name: RELEASE_NAME,
          rulesetName: RULESET_NAME,
          updateTime: '2026-08-28T12:00:01Z',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await deployFirestoreRules({
      projectId: PROJECT_ID,
      accessToken: 'short-lived-token',
    });

    expect(result).toEqual({
      releaseName: RELEASE_NAME,
      rulesetName: RULESET_NAME,
      updateTime: '2026-08-28T12:00:01Z',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [rulesetUrl, rulesetRequest] = fetchMock.mock.calls[0];
    expect(rulesetUrl).toBe(
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`,
    );
    expect(rulesetRequest).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer short-lived-token',
        'content-type': 'application/json',
      },
    });
    expect(JSON.parse(rulesetRequest.body)).toEqual({
      source: {
        files: [{ name: 'firestore.rules', content: localRules }],
      },
    });

    const [releaseUrl, releaseRequest] = fetchMock.mock.calls[1];
    expect(releaseUrl).toBe(
      `https://firebaserules.googleapis.com/v1/${RELEASE_NAME}`,
    );
    expect(releaseRequest.method).toBe('PATCH');
    expect(JSON.parse(releaseRequest.body)).toEqual({
      release: {
        name: RELEASE_NAME,
        rulesetName: RULESET_NAME,
      },
      updateMask: 'rulesetName',
    });
  });

  it('does not update the production release when ruleset creation fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ error: { message: 'invalid rules' } }, 400),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deployFirestoreRules({
        projectId: PROJECT_ID,
        accessToken: 'short-lived-token',
      }),
    ).rejects.toThrow('Firebase Rules API request failed (400)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
