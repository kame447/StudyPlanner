import { describe, expect, it, vi } from 'vitest';
import type { ProductActivityTelemetryDraft } from '../../../shared/productObservabilityContract';
import {
  createNoopProductTelemetryPort,
  createProductTelemetryPort,
  type ProductTelemetrySink,
} from './productTelemetry';

describe('product telemetry port', () => {
  it('builds a bounded activity event without user identity or free-form metadata', async () => {
    let writtenEvent: ProductActivityTelemetryDraft | null = null;
    const sink: ProductTelemetrySink = {
      async write(event) {
        writtenEvent = event;
      },
    };
    const port = createProductTelemetryPort({
      appVersion: '1.2.3',
      sink,
      createEventId: () => 'activity-12345678',
      now: () => new Date('2026-08-28T00:00:00.000Z'),
    });

    port.recordActivity({
      action: 'plan_created',
      correlation: {
        appSessionId: 'app-session-1',
      },
    });
    await Promise.resolve();

    expect(writtenEvent).toEqual({
      schemaVersion: 1,
      eventId: 'activity-12345678',
      eventType: 'product_activity',
      occurredAt: '2026-08-28T00:00:00.000Z',
      appVersion: '1.2.3',
      source: 'web_app',
      correlation: {
        appSessionId: 'app-session-1',
      },
      payload: {
        action: 'plan_created',
      },
    });
    const serialized = JSON.stringify(writtenEvent);
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('metadata');
  });

  it('does not throw into product behavior when the telemetry sink fails', async () => {
    const onError = vi.fn();
    const port = createProductTelemetryPort({
      appVersion: '1.2.3',
      sink: {
        async write() {
          throw new Error('telemetry unavailable');
        },
      },
      createEventId: () => 'activity-12345678',
      onError,
    });

    expect(() => port.recordActivity({ action: 'actual_recorded' })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('provides a no-op port for unavailable or disabled telemetry', () => {
    const port = createNoopProductTelemetryPort();
    expect(() => port.recordActivity({ action: 'app_active' })).not.toThrow();
  });
});
