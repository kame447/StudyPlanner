import { DURABLE_TURN_LIMITS, type DurableTurnRecord, type DurableTurnStorage } from './durableTurnJob';

// Independent bounded fields, not one potentially multi-megabyte snapshot value.
// The manifest, input, each provider response, and result commit in one storage transaction.
const META = 'turn:meta';
const INPUT = 'turn:input';
const OUTPUT = 'turn:output';
const entries = Array.from({ length: DURABLE_TURN_LIMITS.dispatches }, (_, index) => `turn:dispatch:${index}`);
const keys = [META, INPUT, OUTPUT, ...entries];
export const MAX_DURABLE_TURN_VALUE_BYTES = 1800 * 1024; // Below SQLite DO's 2 MB key + value limit.
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

export function encodeDurableTurnRecord(record: DurableTurnRecord): Record<string, string> {
  const { payload, journal, result, ...metadata } = record;
  const values: Record<string, string> = { [META]: JSON.stringify(metadata) };
  if (payload !== undefined) values[INPUT] = payload;
  if (result !== undefined) values[OUTPUT] = result;
  journal?.forEach((entry, index) => {
    if (!entries[index] || !entry) throw new Error('Invalid durable turn journal.');
    values[entries[index]] = JSON.stringify(entry);
  });
  for (const [key, value] of Object.entries(values)) {
    if (bytes(key) + bytes(value) > MAX_DURABLE_TURN_VALUE_BYTES) throw new Error('Durable turn field exceeded storage limit.');
  }
  return values;
}

export function createDurableTurnStorage(storage: DurableObjectStorage): DurableTurnStorage {
  return {
    async read() {
      const values = await storage.get<string>(keys);
      const metadata = values.get(META);
      if (!metadata) return undefined;
      const record = JSON.parse(metadata) as DurableTurnRecord;
      if (values.has(INPUT)) record.payload = values.get(INPUT)!;
      if (values.has(OUTPUT)) record.result = values.get(OUTPUT)!;
      if (record.status === 'queued' || record.status === 'running') {
        record.journal = [];
        for (const key of entries) {
          const value = values.get(key);
          if (value === undefined) break;
          record.journal.push(JSON.parse(value));
        }
      }
      return record;
    },
    async write(record, alarmAt) {
      const values = encodeDurableTurnRecord(record);
      await storage.transaction(async (transaction) => {
        await transaction.delete(keys.filter((key) => !(key in values)));
        await transaction.put(values);
        if (alarmAt !== undefined) await transaction.setAlarm(alarmAt);
      });
    },
    async alarmAt(timestamp) { await storage.setAlarm(timestamp); },
  };
}
