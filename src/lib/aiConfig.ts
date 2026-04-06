export type AiProvider = 'ollama' | 'openai' | 'rules';
export type OllamaProfileId = 'speed' | 'balanced' | 'accuracy' | 'custom';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface OllamaProfile {
  id: Exclude<OllamaProfileId, 'custom'>;
  label: string;
  model: string;
  summary: string;
  pullCommand: string;
}

const AI_RUNTIME_STORAGE_KEY = 'studyplanner.ai.runtime.v1';
const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const OLLAMA_DEFAULT_MODEL = 'llama3.2:3b';
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_DEFAULT_MODEL = 'gpt-5.4-mini';
const OLLAMA_PROFILES: readonly OllamaProfile[] = [
  {
    id: 'speed',
    label: '速度重視',
    model: 'gemma4:e2b',
    summary: '軽めで速く試したいとき向けです。精度より応答速度を優先します。',
    pullCommand: 'ollama pull gemma4:e2b',
  },
  {
    id: 'balanced',
    label: '両立',
    model: 'gemma4:e4b',
    summary: '速度と精度のバランスを狙う標準プリセットです。',
    pullCommand: 'ollama pull gemma4:e4b',
  },
  {
    id: 'accuracy',
    label: '精度重視',
    model: 'gemma4:31b',
    summary: 'かなり重いですが、ローカル精度を優先するときの候補です。',
    pullCommand: 'ollama pull gemma4:31b',
  },
];

function isAiProvider(value: string): value is AiProvider {
  return value === 'ollama' || value === 'openai' || value === 'rules';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getProviderDefaults(provider: AiProvider): Omit<AiConfig, 'provider'> {
  if (provider === 'openai') {
    return {
      baseUrl: OPENAI_DEFAULT_BASE_URL,
      model: OPENAI_DEFAULT_MODEL,
      apiKey: '',
    };
  }

  if (provider === 'rules') {
    return {
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      model: OLLAMA_DEFAULT_MODEL,
      apiKey: '',
    };
  }

  return {
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    model: OLLAMA_DEFAULT_MODEL,
    apiKey: 'ollama',
  };
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function findOllamaProfileByModel(model: string): OllamaProfile | undefined {
  const normalizedModel = model.trim();
  return OLLAMA_PROFILES.find((profile) => profile.model === normalizedModel);
}

function getEnvConfig(): AiConfig {
  const envProvider = readString(import.meta.env.VITE_AI_PROVIDER);
  const provider = envProvider && isAiProvider(envProvider) ? envProvider : 'ollama';
  const defaults = getProviderDefaults(provider);

  return {
    provider,
    baseUrl: readString(import.meta.env.VITE_AI_BASE_URL) ?? defaults.baseUrl,
    model: readString(import.meta.env.VITE_AI_MODEL) ?? defaults.model,
    apiKey: readString(import.meta.env.VITE_AI_API_KEY) ?? defaults.apiKey,
  };
}

function readStoredAiConfig(): Partial<AiConfig> | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const raw = window.sessionStorage.getItem(AI_RUNTIME_STORAGE_KEY);

  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed)) {
      return undefined;
    }

    const providerValue = readString(parsed.provider);

    return {
      provider:
        providerValue && isAiProvider(providerValue) ? providerValue : undefined,
      baseUrl: readString(parsed.baseUrl),
      model: readString(parsed.model),
      apiKey: readString(parsed.apiKey) ?? '',
    };
  } catch {
    return undefined;
  }
}

function normalizeAiConfig(
  candidate: Partial<AiConfig> | undefined,
  fallback: AiConfig,
): AiConfig {
  const provider =
    candidate?.provider && isAiProvider(candidate.provider)
      ? candidate.provider
      : fallback.provider;
  const defaults = getProviderDefaults(provider);

  return {
    provider,
    baseUrl: candidate?.baseUrl ?? fallback.baseUrl ?? defaults.baseUrl,
    model: candidate?.model ?? fallback.model ?? defaults.model,
    apiKey: candidate?.apiKey ?? fallback.apiKey ?? defaults.apiKey,
  };
}

function writeStoredAiConfig(config: AiConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(AI_RUNTIME_STORAGE_KEY, JSON.stringify(config));
}

export function getAiConfig(): AiConfig {
  return normalizeAiConfig(readStoredAiConfig(), getEnvConfig());
}

export function saveAiConfig(config: AiConfig): AiConfig {
  const normalized = normalizeAiConfig(config, getEnvConfig());
  writeStoredAiConfig(normalized);
  return normalized;
}

export function resetAiConfig(): AiConfig {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(AI_RUNTIME_STORAGE_KEY);
  }

  return getEnvConfig();
}

export function withAiProvider(
  currentConfig: AiConfig,
  provider: AiProvider,
): AiConfig {
  const nextDefaults = getProviderDefaults(provider);

  return {
    provider,
    baseUrl: nextDefaults.baseUrl,
    model: nextDefaults.model,
    apiKey:
      provider === 'openai'
        ? currentConfig.provider === 'openai'
          ? currentConfig.apiKey
          : nextDefaults.apiKey
        : provider === 'ollama'
          ? currentConfig.provider === 'ollama'
            ? currentConfig.apiKey
            : nextDefaults.apiKey
          : '',
  };
}

export function getOllamaProfiles(): readonly OllamaProfile[] {
  return OLLAMA_PROFILES;
}

export function getOllamaProfileId(
  config: Pick<AiConfig, 'provider' | 'model'>,
): OllamaProfileId {
  if (config.provider !== 'ollama') {
    return 'custom';
  }

  return findOllamaProfileByModel(config.model)?.id ?? 'custom';
}

export function applyOllamaProfile(
  currentConfig: AiConfig,
  profileId: Exclude<OllamaProfileId, 'custom'>,
): AiConfig {
  const profile = OLLAMA_PROFILES.find((item) => item.id === profileId);

  if (!profile) {
    return currentConfig;
  }

  return {
    provider: 'ollama',
    baseUrl:
      currentConfig.provider === 'ollama'
        ? currentConfig.baseUrl
        : OLLAMA_DEFAULT_BASE_URL,
    model: profile.model,
    apiKey:
      currentConfig.provider === 'ollama' && currentConfig.apiKey.trim()
        ? currentConfig.apiKey
        : 'ollama',
  };
}

export function getAiConfigValidationMessage(
  config: AiConfig,
): string | undefined {
  if (config.provider === 'rules') {
    return undefined;
  }

  if (!config.baseUrl.trim()) {
    return 'AI接続先URLを入力してください。';
  }

  if (!config.model.trim()) {
    return '利用するモデル名を入力してください。';
  }

  if (config.provider === 'openai' && !config.apiKey.trim()) {
    return 'OpenAI APIキーを入力してください。';
  }

  return undefined;
}

export function getAiProviderLabel(config: AiConfig = getAiConfig()): string {
  if (config.provider === 'rules') {
    return 'ルールベース';
  }

  if (config.provider === 'openai') {
    return `OpenAI互換 (${config.model})`;
  }

  const profile = findOllamaProfileByModel(config.model);

  if (profile) {
    return `Ollama / ${profile.label} (${config.model})`;
  }

  return `Ollama / カスタム (${config.model})`;
}

export function getAiStorageNote(config: AiConfig = getAiConfig()): string {
  if (config.provider === 'openai') {
    return 'OpenAIキーはこのブラウザタブの sessionStorage にだけ保存します。';
  }

  if (config.provider === 'ollama') {
    return 'Ollama はこのPC上の OpenAI互換エンドポイントを使います。';
  }

  return 'AIを使わず、入力文ベースの補助だけで動かします。';
}
