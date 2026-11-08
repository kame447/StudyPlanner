// Diagnosis for a day view that never shows the saved plan (live smoke flow 3, #926). It only describes the failure:
// the caller still throws. Counts and a date only: never a title, a plan's content or an id.

const COUNT_KEYS = ['saved', 'drafts', 'otherSaved', 'visible'];

const describeCounts = counts => COUNT_KEYS.map(key => `${key}=${counts[key]}`).join(' ');

/**
 * `read()` returns { saved, drafts, otherSaved, visible } for the open day view: this run's saved blocks, this run's
 * draft blocks, saved blocks of any other title, and the visible entries with this run's title.
 * `reloadAndOpenDay()` reloads the page once and opens the same day again; the counts are then read a second time.
 * Returns the text to append to the failure message.
 */
export async function describeMissingSavedBlocks({ date, read, reloadAndOpenDay }) {
  const parts = [`day ${date}`];
  try { parts.push(`now: ${describeCounts(await read())}`); } catch { parts.push('now: unreadable'); }
  try {
    await reloadAndOpenDay();
    parts.push(`after one reload: ${describeCounts(await read())}`);
  } catch { parts.push('after one reload: could not be read'); }
  return parts.join('; ');
}
