import { useEffect, useState, type ChangeEvent } from 'react';
import { SEMANTIC_MEMORY_MODEL_WEIGHT_BYTES } from './runtime/model';
import {
  clearSemanticMemoryOptIn,
  readSemanticMemoryOptIn,
  setSemanticMemoryOptIn,
} from './semanticMemoryOptIn';

interface SemanticMemoryOptInToggleProps {
  ownerId: string;
}

const modelSizeMegabytes = Math.round(SEMANTIC_MEMORY_MODEL_WEIGHT_BYTES / 1_000_000);

export function SemanticMemoryOptInToggle({ ownerId }: SemanticMemoryOptInToggleProps) {
  const [optedIn, setOptedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void readSemanticMemoryOptIn(ownerId).then((enabled) => {
      if (current) setOptedIn(enabled);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [ownerId]);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextEnabled = event.currentTarget.checked;
    setSaving(true);
    setError(null);
    if (!nextEnabled) setOptedIn(false);
    try {
      const saved = nextEnabled
        ? await setSemanticMemoryOptIn(ownerId, true)
        : await clearSemanticMemoryOptIn(ownerId);
      if (saved) {
        setOptedIn(nextEnabled);
      } else {
        setOptedIn(await readSemanticMemoryOptIn(ownerId));
        setError(nextEnabled
          ? '設定を保存できませんでした。もう一度お試しください。'
          : '無効化を完了できませんでした。設定と端末内データを確認してください。');
      }
    } catch {
      setOptedIn(await readSemanticMemoryOptIn(ownerId));
      setError(nextEnabled
        ? '設定を保存できませんでした。もう一度お試しください。'
        : '無効化を完了できませんでした。設定と端末内データを確認してください。');
    } finally {
      setSaving(false);
    }
  }

  return <section className="settings-group-card semantic-memory-opt-in-card">
    <label className="settings-row settings-motion-row">
      <span className="settings-row-copy">
        <strong>端末内で記憶を検索</strong>
        <small>
          有効にすると、公開モデル（約{modelSizeMegabytes} MB）を端末へダウンロードします。
          この検索のために記憶や埋め込みを外部へ送信しません。
          会話AIへ送る記憶の選び方が変わることがあります。サインアウトすると同意はリセットされます。
        </small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label="端末内の意味検索を有効にする"
        checked={optedIn}
        disabled={loading || saving}
        onChange={handleChange}
      />
    </label>
    {error ? <p className="settings-inline-error" role="alert">{error}</p> : null}
  </section>;
}
