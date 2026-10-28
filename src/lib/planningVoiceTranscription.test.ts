import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribePlanningVoice } from './planningVoiceTranscription';

vi.mock('./aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://proxy.example' }));
vi.mock('./firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'test-token' } }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('voice transcription request MIME type', () => {
  it.each([
    ['audio/webm;codecs=opus', 'audio/webm'],
    [' Audio/OGG ; codecs=opus', 'audio/ogg'],
    ['', 'audio/webm'],
    [' ;codecs=opus', 'audio/webm'],
    ['audio/mp4', 'audio/mp4'],
  ])('normalizes %j to %j at the request site', async (type, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { text: ' transcript ' } })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribePlanningVoice(new Blob(['voice'], { type }))).toEqual({ text: 'transcript' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, request] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://proxy.example/planning-transcription');
    expect(request.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(request.body)).toEqual({ mimeType: expected, base64: 'dm9pY2U=' });
  });
});
