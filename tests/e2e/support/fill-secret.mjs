// Playwright puts the filled value in its action log, so a failed fill would
// print the credential. Replace the error with a fixed message.
export async function fillSecret(locator, value, label) {
  try {
    await locator.fill(value);
  } catch {
    throw new Error(`Could not enter the ${label}.`);
  }
}
