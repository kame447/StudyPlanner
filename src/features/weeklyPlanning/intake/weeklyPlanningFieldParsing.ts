export function resolveFieldName(rawField: string | undefined, fields: string[]): string | undefined {
  if (!rawField) {
    return undefined;
  }

  const normalizedField = rawField.trim();
  return fields.find((field) => field.includes(normalizedField)) ?? normalizedField;
}

export function resolveFieldByKeyword(keyword: string, fields: string[]): string | undefined {
  return fields.find((field) => field.includes(keyword));
}
