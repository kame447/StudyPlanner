import { describe, expect, it, vi } from 'vitest';
import {
  createNoopProductTelemetryPort,
  createProductTelemetryPort,
  type ProductTelemetrySink,
} from './productTelemetry';

describe('product telemetry port', () => {
  it('builds a bounded activity event without user identity or free-form metadata', async () => {
    const write = vi.fn(async () => undefined);
    const sink: ProductTelemetrySink = { write };
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

    expect(write).toHaveBeenCalledWith({
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
    expect(JSON.stringify(write.mock.calls[0]?.[0])).not.toContain('userId');
    expect(JSON.stringify(write.mock.calls[0]?.[0])).not.toContain('email');
    expect(JSON.stringify(write.mock.calls[0]?.[0])).not.toContain('metadata');
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
