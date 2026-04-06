export function replaceById<T extends { id: string }>(
  records: T[],
  nextRecord: T,
): T[] {
  return records.some((record) => record.id === nextRecord.id)
    ? records.map((record) => (record.id === nextRecord.id ? nextRecord : record))
    : [...records, nextRecord];
}

export function filterByUserId<T extends { userId: string }>(
  records: T[],
  userId: string,
): T[] {
  return records.filter((record) => record.userId === userId);
}
