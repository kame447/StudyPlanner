import { useEffect, useState } from 'react';
import type { AiProvider } from '../lib/aiConfig';
import {
  clearStoredNaturalLanguageRulesPipelineMode,
  getNaturalLanguageRulesPipelineMode,
  getNaturalLanguageRulesPipelineModeSource,
  NATURAL_LANGUAGE_RULES_PIPELINE_MODE_VALUES,
  setStoredNaturalLanguageRulesPipelineMode,
  type NaturalLanguageRulesPipelineMode,
  type NaturalLanguageRulesPipelineModeSource,
} from '../services/natural-language/adapter';

interface NaturalLanguageRulesModeControlProps {
  currentProvider: AiProvider;
}

const MODE_LABELS: Record<NaturalLanguageRulesPipelineMode, string> = {
  legacy: 'legacy',
  pipeline: 'pipeline',
  hybrid: 'hybrid',
};

const SOURCE_LABELS: Record<NaturalLanguageRulesPipelineModeSource, string> = {
  global: 'global override',
  env: 'env override',
  localStorage: 'localStorage',
  default: 'default',
};

export function NaturalLanguageRulesModeControl({
  currentProvider,
}: NaturalLanguageRulesModeControlProps) {
  const [mode, setMode] = useState<NaturalLanguageRulesPipelineMode>(() =>
    getNaturalLanguageRulesPipelineMode(),
  );
  const [source, setSource] = useState<NaturalLanguageRulesPipelineModeSource>(() =>
    getNaturalLanguageRulesPipelineModeSource(),
  );

  useEffect(() => {
    setMode(getNaturalLanguageRulesPipelineMode());
    setSource(getNaturalLanguageRulesPipelineModeSource());
  }, [currentProvider]);

  if (currentProvider !== 'rules') {
    return null;
  }

  const isForced = source === 'global' || source === 'env';

  function refreshModeState() {
    setMode(getNaturalLanguageRulesPipelineMode());
    setSource(getNaturalLanguageRulesPipelineModeSource());
  }

  function handleModeChange(nextMode: NaturalLanguageRulesPipelineMode) {
    setStoredNaturalLanguageRulesPipelineMode(nextMode);
    refreshModeState();
  }

  function handleReset() {
    clearStoredNaturalLanguageRulesPipelineMode();
    refreshModeState();
  }

  return (
    <section className="assistant-settings-card nl-rules-mode-card">
      <div className="label-row">
        <div>
          <strong>Rules pipeline mode</strong>
          <p className="detail-note">
            rules provider の add / edit の両方で共通に使う開発用切替です。
          </p>
        </div>
        <span className="confidence-badge">
          {MODE_LABELS[mode]} / {SOURCE_LABELS[source]}
        </span>
      </div>

      <label className="field field-full">
        <span>実行モード</span>
        <select
          value={mode}
          onChange={(event) =>
            handleModeChange(
              event.target.value as NaturalLanguageRulesPipelineMode,
            )
          }
          disabled={isForced}
        >
          {NATURAL_LANGUAGE_RULES_PIPELINE_MODE_VALUES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {MODE_LABELS[candidate]}
            </option>
          ))}
        </select>
      </label>

      <div className="row-actions">
        <button
          className="ghost-button"
          onClick={handleReset}
          type="button"
          disabled={isForced}
        >
          localStorage を初期化
        </button>
        <span className="detail-note">
          {isForced
            ? 'global または env の override があるため、この画面の変更は有効になりません。'
            : 'localStorage["studyplanner.nl.rules.pipeline.mode"] に保存します。'}
        </span>
      </div>
    </section>
  );
}
