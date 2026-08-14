import { useState } from 'react';

interface AuthAccessGateFormProps {
  onUnlock: (key: string) => boolean;
}

export function AuthAccessGateForm({ onUnlock }: AuthAccessGateFormProps) {
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);

    if (!onUnlock(accessKey)) {
      setError('閲覧キーが一致しません。');
      return;
    }

    setAccessKey('');
  }

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      <label className="field">
        <span>閲覧キー</span>
        <input
          type="password"
          value={accessKey}
          onChange={(event) => setAccessKey(event.target.value)}
          placeholder="共有されたキーを入力"
        />
      </label>

      {error ? <p className="inline-error">{error}</p> : null}

      <button className="primary-button" type="submit">
        キーを確認して進む
      </button>
    </form>
  );
}
