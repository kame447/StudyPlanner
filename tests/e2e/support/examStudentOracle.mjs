import { fixture } from './examStudentScenario.mjs';

// Independent oracle for the exam-student persona. It reads ONLY the user's request (fixture) and
// captured blocks; it never consults the product's scheduler, Fact Graph or preview model.
// Ported from the campaign oracle (exam-student-oracle-20261008.py): interval intersection, exact
// remaining quantities, deadlines, sleep, existing events and buffers, pairwise overlap.
const minute = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const intersect = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
export const STUDY_TASKS = fixture.workloads;
const UNIT_SUFFIX = { problem: '問', word: '個', passage: '本', chapter: '章', essay: '本' };

/** What the user asked for, in the unit the product titles show (minute tasks are compared in minutes). */
export function requestedQuantity(workload) {
  return workload.unitCode === 'hour' ? { quantity: workload.amount * 60, suffix: '分' }
    : { quantity: workload.amount, suffix: UNIT_SUFFIX[workload.unitCode] };
}
export const WEEK = { first: fixture.persona.weekStartDate, last: fixture.persona.weekEndDate };

/** Map a rendered block title to a requested task and its quantity; null if it is not a study block. */
export function classifyTitle(title) {
  const task = [...STUDY_TASKS].sort((a, b) => b.title.length - a.title.length).find(item => title.startsWith(item.title));
  if (!task) return null;
  const [, amount, suffix] = /^\s*(\d+(?:\.\d+)?)(問|個|本|章|題|分)/.exec(title.slice(task.title.length)) ?? [];
  return { taskId: task.id, units: amount === undefined ? NaN : Number(amount), suffix };
}

export const blockedRanges = (date, { extraBlocked = [], includeBuffers = true, noBusy = false } = {}) => noBusy ? [
  ...extraBlocked.filter(window => window.date === date).map(window => ({ ...window, label: `extra ${window.reason ?? 'blocked'}` })),
] : [
  ...fixture.existingEvents.filter(event => event.date === date).map(event => ({ ...event, label: `existing ${event.id}` })),
  ...(includeBuffers ? fixture.lifeBuffers.filter(buffer => buffer.date === date).map(buffer => ({ ...buffer, label: `buffer ${buffer.reason}` })) : []),
  ...extraBlocked.filter(window => window.date === date).map(window => ({ ...window, label: `extra ${window.reason ?? 'blocked'}` })),
];

/**
 * @param blocks [{title,date,startTime,endTime}]
 * @param options.quantities override of requested quantities, taskId -> number (variants)
 * @param options.tasks subset of task ids expected to be present (default all)
 * @param options.deadlines override of deadlines, taskId -> ISO date
 * @param options.extraBlocked extra hard busy windows (variants), [{date,startTime,endTime}]
 * @param options.noBusy true: the persona's events/buffers are not this run's busy time (noBusy / foreign-owner seeds)
 * @param options.window override of allowed dates {first,last}
 * @param options.mustBeOnOrAfter taskId -> ISO date (e.g. English reading moved to the weekend)
 * @returns {{hard: string[], advisory: string[], perTask: object, totals: object}}
 */
export function checkBlocks(blocks, options = {}) {
  const hard = []; const advisory = [];
  const window = options.window ?? WEEK;
  const wanted = options.tasks ?? STUDY_TASKS.map(task => task.id);
  const perTask = Object.fromEntries(wanted.map(id => [id, { quantity: 0, minutes: 0, blocks: 0 }]));
  const dailyMinutes = {};
  blocks.forEach((block, index) => {
    const who = `#${index} ${block.date} ${block.startTime}-${block.endTime} ${block.title}`;
    const klass = classifyTitle(block.title);
    if (!klass) { hard.push(`unknown task: ${who}`); return; }
    const task = STUDY_TASKS.find(item => item.id === klass.taskId);
    const start = minute(block.startTime); const end = minute(block.endTime); const duration = end - start;
    if (!wanted.includes(task.id)) hard.push(`unexpected task ${task.id}: ${who}`);
    if (block.date < window.first || block.date > window.last) hard.push(`outside horizon: ${who}`);
    const deadline = options.deadlines?.[task.id] ?? task.deadline;
    if (block.date > deadline) hard.push(`missed deadline ${deadline}: ${who}`);
    if (options.mustBeOnOrAfter?.[task.id] && block.date < options.mustBeOnOrAfter[task.id]) hard.push(`before required date: ${who}`);
    if (duration <= 0) hard.push(`non-positive duration: ${who}`);
    if (start < minute('06:30') || end > minute('23:30')) hard.push(`sleep boundary 23:30-06:30: ${who}`);
    for (const busy of blockedRanges(block.date, options)) {
      if (intersect(start, end, minute(busy.startTime), minute(busy.endTime))) hard.push(`collides with ${busy.label} ${busy.startTime}-${busy.endTime}: ${who}`);
    }
    for (let k = 0; k < index; k += 1) {
      const other = blocks[k];
      if (other.date === block.date && intersect(start, end, minute(other.startTime), minute(other.endTime))) hard.push(`block collision #${k}/#${index}: ${who}`);
    }
    if (Number.isNaN(klass.units)) hard.push(`quantity unreadable: ${who}`);
    const entry = perTask[task.id] ?? (perTask[task.id] = { quantity: 0, minutes: 0, blocks: 0 });
    entry.quantity += Number.isNaN(klass.units) ? 0 : klass.units; entry.minutes += duration; entry.blocks += 1;
    const perUnit = task.unitCode === 'hour' ? 1 : task.minutesPerUnit;
    if (Number.isFinite(klass.units) && duration + 1e-9 < klass.units * perUnit) hard.push(`under-allocated (${duration} < ${klass.units * perUnit}): ${who}`);
    if (task.splittable && duration > task.preferredSessionCapMinutes) hard.push(`session over ${task.preferredSessionCapMinutes} min for a splittable task: ${who}`);
    dailyMinutes[block.date] = (dailyMinutes[block.date] ?? 0) + duration;
  });
  for (const id of wanted) {
    const task = STUDY_TASKS.find(item => item.id === id);
    const expected = options.quantities?.[id] ?? requestedQuantity(task).quantity;
    if (Math.abs(perTask[id].quantity - expected) > 1e-7) hard.push(`quantity ${id}: placed ${perTask[id].quantity} of requested ${expected}`);
  }
  // Persona guideline (fixture rules.maximumNewStudyMinutesPerDay): informational, the product is not told it.
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  for (const [date, minutes] of Object.entries(dailyMinutes)) {
    const cap = fixture.rules.maximumNewStudyMinutesPerDay[names[new Date(`${date}T00:00:00Z`).getUTCDay()]];
    if (minutes > cap) advisory.push(`daily load ${date}: ${minutes} min above the persona guideline ${cap}`);
  }
  const totals = { blocks: blocks.length, minutes: blocks.reduce((sum, block) => sum + minute(block.endTime) - minute(block.startTime), 0) };
  return { hard, advisory, perTask, totals };
}
