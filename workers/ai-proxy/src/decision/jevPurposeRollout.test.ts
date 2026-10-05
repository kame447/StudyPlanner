import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decisionMode, canarySelected } from './decisionPolicy';
import { contextualDecisionMode, contextualCanarySelected } from './contextualDecisionPolicy';
import { temporalScopeRepairDecisionMode, temporalScopeRepairCanarySelected } from './temporalScopeRepairDecisionPolicy';
import { userContextRoutingDecisionMode, userContextRoutingCanarySelected } from './userContextRoutingPolicy';
import {
  resolveJevPurposeRollout, jevPurposeCanarySample, jevPurposeCanarySelected,
  type JevRolloutEnv, type JevRolloutPurpose,
} from './jevPurposeRollout';

const routes = [
  { purpose: 'focused_authorization', prefix: 'FOCUSED_AUTHORIZATION', mode: decisionMode, selected: canarySelected },
  { purpose: 'focused_contextual_answer', prefix: 'FOCUSED_CONTEXTUAL_ANSWER', mode: contextualDecisionMode, selected: contextualCanarySelected },
  { purpose: 'temporal_scope_repair', prefix: 'TEMPORAL_SCOPE_REPAIR', mode: temporalScopeRepairDecisionMode, selected: temporalScopeRepairCanarySelected },
  { purpose: 'user_context_routing', prefix: 'USER_CONTEXT_ROUTING', mode: userContextRoutingDecisionMode, selected: userContextRoutingCanarySelected },
  { purpose: 'candidate_choice', prefix: 'CANDIDATE_CHOICE',
    mode: (env: JevRolloutEnv) => resolveJevPurposeRollout(env, 'candidate_choice').mode,
    selected: (env: JevRolloutEnv, sample?: number) => jevPurposeCanarySelected(env, 'candidate_choice', sample) },
] as const;
const modes = ['off', 'shadow', 'canary'] as const;
function settings(prefix: string, mode: string, percent = '100'): JevRolloutEnv {
  return { [`JEV_${prefix}_MODE`]: mode, [`JEV_${prefix}_CANARY_PERCENT`]: percent };
}

describe('strict independent purpose configuration', () => {
  it.each(['off', 'shadow', 'canary'])('covers all 3^5 mode combinations under global %s', (master) => {
    for (let combination = 0; combination < 3 ** routes.length; combination += 1) {
      let remainder = combination;
      const selections = routes.map(() => { const mode = modes[remainder % 3]; remainder = Math.floor(remainder / 3); return mode; });
      const env: JevRolloutEnv = { JEV_MODE: master, JEV_CANARY_PERCENT: '100' };
      routes.forEach((route, index) => Object.assign(env, settings(route.prefix, selections[index])));
      routes.forEach((route, index) => {
        const expected = master === 'off' || selections[index] === 'off' ? 'off'
          : master === 'shadow' ? 'shadow' : selections[index];
        expect(route.mode(env), `${combination}/${route.purpose}`).toBe(expected);
        expect(route.selected(env, 0), `${combination}/${route.purpose}`).toBe(expected === 'canary');
      });
    }
  });

  it.each(routes)('has no mode or percentage inheritance for $purpose', (route) => {
    const master: JevRolloutEnv = { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' };
    expect(route.mode(master)).toBe('off');
    expect(route.mode({ ...master, [`JEV_${route.prefix}_MODE`]: 'canary' })).toBe('off');
    expect(route.mode({ ...master, [`JEV_${route.prefix}_CANARY_PERCENT`]: '100' })).toBe('off');
    expect(route.selected(master, 0)).toBe(false);
  });

  it.each(routes)('fails closed on missing/malformed bindings for $purpose', (route) => {
    const enabled = { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', ...settings(route.prefix, 'canary') };
    for (const bad of [undefined, '', 'invalid', 'CANARY', ' canary', 'canary ', 'on', 100]) {
      const env = { ...enabled, [`JEV_${route.prefix}_MODE`]: bad } as JevRolloutEnv;
      expect(route.mode(env)).toBe('off'); expect(route.selected(env, 0)).toBe(false);
    }
    for (const bad of [undefined, '', ' 5', '5 ', '05', '5.0', '5e0', '+5', 'NaN', 'Infinity', '-1', '1', '50', '101', 100]) {
      for (const mode of ['shadow', 'canary']) {
        const env = { ...enabled, [`JEV_${route.prefix}_MODE`]: mode, [`JEV_${route.prefix}_CANARY_PERCENT`]: bad } as JevRolloutEnv;
        expect(route.mode(env)).toBe('off'); expect(route.selected(env, 0)).toBe(false);
      }
    }
    for (const bad of [undefined, '', 'off', 'invalid', 'CANARY', ' canary']) {
      expect(route.mode({ ...enabled, JEV_MODE: bad })).toBe('off');
      expect(route.selected({ ...enabled, JEV_MODE: bad }, 0)).toBe(false);
    }
    for (const bad of [undefined, '', '0', ' 5', '5.0', '5e0', '50', 'malformed', 100]) {
      for (const mode of ['shadow', 'canary']) {
        expect(route.mode({ ...enabled, JEV_CANARY_PERCENT: bad, ...settings(route.prefix, mode) } as JevRolloutEnv)).toBe('off');
      }
    }
    expect(route.mode({ ...enabled, ...settings(route.prefix, 'canary', '0') })).toBe('off');
  });

  it('never enables unknown/research/prototype purposes, even with matching-looking flags', () => {
    const env = Object.assign({ JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' }, ...routes.map(r => settings(r.prefix, 'canary')));
    for (const purpose of ['new_research', 'd5_prime', 'temporal_side_contribution', '', '__proto__', 'constructor', 'toString']) {
      expect(resolveJevPurposeRollout({ ...env, JEV_NEW_RESEARCH_MODE: 'canary', JEV_NEW_RESEARCH_CANARY_PERCENT: '100' } as JevRolloutEnv, purpose).mode).toBe('off');
      expect(jevPurposeCanarySelected(env, purpose, 0)).toBe(false);
      expect(jevPurposeCanarySample(purpose, 'cohort-owner')).toBeNaN();
    }
  });

  it('source-controlled production defaults leave every purpose off', () => {
    const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
    expect(config.vars.JEV_MODE).toBe('off'); expect(config.vars.JEV_CANARY_PERCENT).toBe('0');
    for (const route of routes) {
      expect(config.vars[`JEV_${route.prefix}_MODE`]).toBe('off');
      expect(config.vars[`JEV_${route.prefix}_CANARY_PERCENT`]).toBe('0');
      expect(route.mode(config.vars)).toBe('off'); expect(route.selected(config.vars, 0)).toBe(false);
      expect(route.mode({ ...config.vars, JEV_MODE: 'canary' })).toBe('off');
    }
  });
});

describe('deterministic purpose canaries', () => {
  it.each(routes)('selects exact nested 5/25/100 boundaries for $purpose', (route) => {
    for (const percent of [5, 25, 100]) {
      const env = { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', ...settings(route.prefix, 'canary', String(percent)) };
      for (const sample of [0, 0.0499, 0.05, 0.2499, 0.25, 0.9999]) {
        expect(route.selected(env, sample)).toBe(sample < percent / 100);
      }
      for (const sample of [undefined, NaN, Infinity, -Infinity, -0.01, 1, 1.01]) expect(route.selected(env, sample)).toBe(false);
    }
  });

  it.each(routes)('global percentage caps every purpose percentage for $purpose', (route) => {
    for (const master of [0, 5, 25, 100]) {
      for (const purpose of [0, 5, 25, 100]) {
        const env = { JEV_MODE: 'canary', JEV_CANARY_PERCENT: String(master), ...settings(route.prefix, 'canary', String(purpose)) };
        for (const sample of [0, 0.0499, 0.05, 0.2499, 0.25, 0.9999]) {
          expect(route.selected(env, sample)).toBe(sample < Math.min(master, purpose) / 100);
        }
      }
    }
    const shadow = { JEV_MODE: 'shadow', JEV_CANARY_PERCENT: '0', ...settings(route.prefix, 'canary') };
    expect(route.mode(shadow)).toBe('shadow');
    expect(route.selected(shadow, 0)).toBe(false);
  });

  it('freezes hash vectors and preserves retry identity without reading text or random state', () => {
    const vectors: Record<JevRolloutPurpose, number> = {
      focused_authorization: 0.4271, focused_contextual_answer: 0.459,
      temporal_scope_repair: 0.6067, user_context_routing: 0.9606, candidate_choice: 0.8403,
    };
    for (const route of routes) {
      expect(jevPurposeCanarySample(route.purpose, 'cohort-owner')).toBe(vectors[route.purpose]);
      expect(jevPurposeCanarySample(route.purpose, '')).toBeNaN();
      for (let user = 0; user < 200; user += 1) {
        const uid = `fixture-owner-${user}`;
        const sample = jevPurposeCanarySample(route.purpose, uid);
        expect(jevPurposeCanarySample(route.purpose, uid)).toBe(sample);
        let previouslySelected = false;
        for (const percent of ['5', '25', '100']) {
          const env = { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', ...settings(route.prefix, 'canary', percent) };
          const selected = route.selected(env, sample);
          if (previouslySelected) expect(selected).toBe(true);
          for (const other of routes.filter(r => r.purpose !== route.purpose)) {
            expect(route.selected({ ...env, ...settings(other.prefix, 'canary', '100') }, sample)).toBe(selected);
          }
          previouslySelected = selected;
        }
      }
    }
    expect(new Set(Object.values(vectors)).size).toBe(5);
  });
});
