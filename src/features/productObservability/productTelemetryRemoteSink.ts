import { getCloudflareAiProxyUrl } from '../../lib/aiConfig';
import { getFirebaseAuth } from '../../lib/firebaseClient';
import type { ProductObservabilityTelemetryDraft } from '../../../shared/productObservabilityContract';
import type { ProductTelemetrySink } from './productTelemetry';

export function buildProductObservabilityEventsEndpoint(proxyUrl: string): string {
  const baseUrl = proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/planning-attachment$/, '')
    .replace(/\/planning-transcription$/, '');
  return `${baseUrl}/observability/events`;
}

export function createRemoteProductTelemetrySink(options: {
  endpoint: string;
  getIdToken: () => Promise<string>;
  fetcher?: typeof fetch;
}): ProductTelemetrySink {
  const fetcher = options.fetcher ?? fetch;
  return {
    async write(event: ProductObservabilityTelemetryDraft): Promise<void> {
      const idToken = await options.getIdToken();
      const response = await fetcher(options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        throw new Error(`Product telemetry request failed: ${response.status}`);
      }
    },
  };
}

export function createFirebaseProductTelemetrySink(): ProductTelemetrySink | null {
  const proxyUrl = getCloudflareAiProxyUrl();
  const currentUser = getFirebaseAuth()?.currentUser;
  if (!proxyUrl || !currentUser) return null;

  return createRemoteProductTelemetrySink({
    endpoint: buildProductObservabilityEventsEndpoint(proxyUrl),
    getIdToken: () => currentUser.getIdToken(),
  });
}
