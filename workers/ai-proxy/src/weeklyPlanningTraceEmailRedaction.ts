/** Preserve email masking without retrying every suffix of a failed local-part run. */
export function redactWeeklyPlanningTraceEmails(value: string): string {
  if (!value.includes('@')) return value;
  const localParts = /[A-Z0-9._%+-]+/gi;
  const emailAtCandidate = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iy;
  const output: string[] = [];
  let copiedThrough = 0;
  let localPart: RegExpExecArray | null;
  while ((localPart = localParts.exec(value)) !== null) {
    if (value[localParts.lastIndex] !== '@') continue;
    emailAtCandidate.lastIndex = localPart.index;
    const email = emailAtCandidate.exec(value);
    if (!email) continue;
    output.push(value.slice(copiedThrough, email.index), '[EMAIL]');
    copiedThrough = emailAtCandidate.lastIndex;
    // Resume exactly where the old global match ended, including adjacent addresses.
    localParts.lastIndex = copiedThrough;
  }
  output.push(value.slice(copiedThrough));
  return output.join('');
}
