import {
  PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
  type ObservabilityCorrelation,
  type ProductActivityAction,
  type ProductActivityTelemetryDraft,
  type ProductObservabilityTelemetryDraft,
} from '../../../shared/productObservabilityContract';
import { createFirebaseProductTelemetrySink } from './productTelemetryRemoteSink';

export interface ProductTelemetrySink {
  write(event: ProductObservabilityTelemetryDraft): Promise<void>;
}

export interface ProductTelemetryPort {
  recordActivity(input: {
    action: ProductActivityAction;
    correlation?: ObservabilityCorrelation;
    occurredAt?: string;
  }): void;
}

export interface ProductTelemetryPortOptions {
  appVersion: string;
  sink: ProductTelemetrySink;
  createEventId?: () => string;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

function defaultEventId(): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  return `activity-${value}`;
}

function runtimeAppVersion(): string {
  const configured = import.meta.env.VITE_APP_VERSION;
  return typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : 'unknown';
}

export function createProductTelemetryPort(
  options: ProductTelemetryPortOptions,
): ProductTelemetryPort {
  const createEventId = options.createEventId ?? defaultEventId;
  const now = options.now ?? (() => new Date());
  const onError = options.onError ?? (() => undefined);

  return {
    recordActivity(input) {
      const event: ProductActivityTelemetryDraft = {
        schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
        eventId: createEventId(),
        eventType: 'product_activity',
        occurredAt: input.occurredAt ?? now().toISOString(),
        appVersion: options.appVersion,
        source: 'web_app',
        ...(input.correlation ? { correlation: input.correlation } : {}),
        payload: {
          action: input.action,
        },
      };

      void options.sink.write(event).catch(onError);
    },
  };
}

export function createNoopProductTelemetryPort(): ProductTelemetryPort {
  return {
    recordActivity() {},
  };
}

export function createFirebaseProductTelemetryPort(): ProductTelemetryPort {
  const sink = createFirebaseProductTelemetrySink();
  if (!sink) return createNoopProductTelemetryPort();
  return createProductTelemetryPort({
    appVersion: runtimeAppVersion(),
    sink,
  });
}
