// The options of defineVNextProductionFlows. Anything else throws: a future flag must not be able to silently disable an
// assertion (an optional `seedEarlierRun` once did). Behaviour that depends on the environment is derived from it instead,
// e.g. the scripted emulator stack is the one that supplies `beforeTurn`.
export const FLOW_OPTION_KEYS = ['test', 'signIn', 'tag', 'beforeTurn', 'exerciseWeekSwitch'];

export function assertKnownFlowOptions(options) {
  if (!options || typeof options !== 'object') throw new TypeError('defineVNextProductionFlows needs an options object.');
  const unknown = Object.keys(options).filter(key => !FLOW_OPTION_KEYS.includes(key));
  if (unknown.length) throw new TypeError(`Unknown defineVNextProductionFlows option(s): ${unknown.join(', ')}.`);
  return options;
}
