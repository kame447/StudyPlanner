import {
  clearStoredNaturalLanguageCurrentPipelineOnly,
  isNaturalLanguageCurrentPipelineOnlyDebugEnabled,
  setStoredNaturalLanguageCurrentPipelineOnly,
} from '../services/natural-language/adapter';

export function NaturalLanguageRulesModeControl() {
  const enabled = isNaturalLanguageCurrentPipelineOnlyDebugEnabled();

  return (
    <section className="assistant-settings-card nl-rules-mode-card">
      <div className="label-row">
        <div>
          <strong>Current pipeline debug</strong>
          <p className="detail-note">
            AI assist を止め、current pipeline だけで解析する開発用切替です。
          </p>
        </div>
        <span className="confidence-badge">
          {enabled ? 'current pipeline only' : 'current pipeline + AI assist'}
        </span>
      </div>

      <div className="row-actions">
        <button
          className="ghost-button"
          onClick={() => setStoredNaturalLanguageCurrentPipelineOnly(!enabled)}
          type="button"
        >
          {enabled ? 'AI assist を許可' : 'current pipeline only にする'}
        </button>
        <button
          className="ghost-button"
          onClick={clearStoredNaturalLanguageCurrentPipelineOnly}
          type="button"
        >
          localStorage を初期化
        </button>
      </div>
    </section>
  );
}
