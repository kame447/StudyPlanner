export function upsertByKey<T>(
  items: T[],
  nextItem: T,
  getKey: (item: T) => string,
): T[] {
  const nextKey = getKey(nextItem);

  return items.filter((item) => getKey(item) !== nextKey).concat(nextItem);
}

export function removeByKey<T>(
  items: T[],
  key: string,
  getKey: (item: T) => string,
): T[] {
  return items.filter((item) => getKey(item) !== key);
}
