const GENERIC_ACKNOWLEDGEMENT_PREFIX =
  /^(?:(?:了解(?:です|しました)?|承知しました|わかりました|分かりました)(?:[。．.!！、,\s]+|$))+/u;

export function stripGenericAcknowledgementPrefix(text: string): string {
  return text.trim().replace(GENERIC_ACKNOWLEDGEMENT_PREFIX, '').trim();
}

export function normalizeDialogueText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function dialogueTextLines(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => stripGenericAcknowledgementPrefix(line))
    .filter(Boolean);
}

export function composeUniqueDialogueMessage(
  parts: readonly (string | undefined)[],
): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const part of parts) {
    for (const line of dialogueTextLines(part)) {
      const key = normalizeDialogueText(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }

  return lines.join('\n');
}
