import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../../src/App';
import '../../../src/styles.css';
import '../../../src/styles/interaction-continuity.css';
import '../../../src/styles/appSettingsMemory.css';
import { PRESERVE_TIMETABLE_RELOAD, seedTimetableOwnerStorage, TIMETABLE_STORAGE_KEYS } from './timetableOwnerSeed.fixture.mjs';

// Reuse the recovery server's real App, public local repository, and observer.
// No hook state, canonicalization result, or repository write is fabricated.
const preserve = sessionStorage.getItem(PRESERVE_TIMETABLE_RELOAD) === 'true';
sessionStorage.removeItem(PRESERVE_TIMETABLE_RELOAD);
if (!preserve) seedTimetableOwnerStorage(localStorage);
window.__realWeeklyEvents = [];
window.__timetableOwnerStartup = {
  initial: Object.fromEntries(TIMETABLE_STORAGE_KEYS.map(key => [key, localStorage.getItem(key)])),
  writes: [],
};
const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key, value) {
  const result = originalSetItem.call(this, key, value);
  if (this === localStorage && TIMETABLE_STORAGE_KEYS.includes(key)) {
    window.__timetableOwnerStartup.writes.push({ key, value });
  }
  return result;
};
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
