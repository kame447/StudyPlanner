export type AiProvider = 'ollama' | 'openai' | 'rules';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const AI_RUNTIME_STORAGE_KEY = 'studyplanner.ai.runtime.v1';
const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const OLLAMA_DEFAULT_MODEL = 'llama3.2:3b';
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_DEFAULT_MODEL = 'gpt-5.4-mini';
const CLOUDFLARE_PROXY_URL = import.meta.env.VITE_CLOUDFLARE_AI_PROXY_URL?.trim() ?? '';

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

function normalizeOllamaConfig(config: AiConfig): AiConfig {
  if (config.provider !== 'ollama') {
    return config;
  }

  return {
    ...config,
    model: OLLAMA_DEFAULT_MODEL,
    apiKey: config.apiKey.trim() ? config.apiKey : 'ollama',
  };
}

export function getCloudflareAiProxyUrl(): string {
  return CLOUDFLARE_PROXY_URL;
}

export function usesCloudflareOpenAiProxy(
  config: Pick<AiConfig, 'provider'> = { provider: getAiConfig().provider },
): boolean {
  return config.provider === 'openai' && Boolean(getCloudflareAiProxyUrl());
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnvConfig(): AiConfig {
  const envProvider = readString(import.meta.env.VITE_AI_PROVIDER);
  const provider = envProvider && isAiProvider(envProvider) ? envProvider : 'openai';
  const defaults = getProviderDefaults(provider);

  return normalizeOllamaConfig({
    provider,
    baseUrl: readString(import.meta.env.VITE_AI_BASE_URL) ?? defaults.baseUrl,
    model: readString(import.meta.env.VITE_AI_MODEL) ?? defaults.model,
    apiKey: readString(import.meta.env.VITE_AI_API_KEY) ?? defaults.apiKey,
  });
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

  return normalizeOllamaConfig({
    provider,
    baseUrl: candidate?.baseUrl ?? fallback.baseUrl ?? defaults.baseUrl,
    model: candidate?.model ?? fallback.model ?? defaults.model,
    apiKey: candidate?.apiKey ?? fallback.apiKey ?? defaults.apiKey,
  });
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

  return normalizeOllamaConfig({
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
  });
}

export function getOllamaDefaultModel(): string {
  return OLLAMA_DEFAULT_MODEL;
}

export function getAiConfigValidationMessage(
  config: AiConfig,
): string | undefined {
  if (config.provider === 'rules') {
    return undefined;
  }

  if (!usesCloudflareOpenAiProxy(config) && !config.baseUrl.trim()) {
    return 'AI接続先URLを入力してください。';
  }

  if (!config.model.trim()) {
    return '利用するモデル名を入力してください。';
  }

  if (
    config.provider === 'openai' &&
    !usesCloudflareOpenAiProxy(config) &&
    !config.apiKey.trim()
  ) {
    return 'OpenAI APIキーを入力してください。';
  }

  return undefined;
}

export function getAiProviderLabel(config: AiConfig = getAiConfig()): string {
  if (config.provider === 'rules') {
    return 'ルールベース';
  }

  if (config.provider === 'openai') {
    return usesCloudflareOpenAiProxy(config)
      ? `OpenAI (Cloudflare Workers経由 / ${config.model})`
      : `OpenAI互換 (${config.model})`;
  }

  return `Ollama (${OLLAMA_DEFAULT_MODEL})`;
}

export function getAiStorageNote(config: AiConfig = getAiConfig()): string {
  if (config.provider === 'openai') {
    return usesCloudflareOpenAiProxy(config)
      ? 'OpenAIキーは Cloudflare Workers の secret に置き、ブラウザには保存しません。'
      : 'OpenAIキーはこのブラウザタブの sessionStorage にだけ保存します。';
  }

  if (config.provider === 'ollama') {
    return 'Ollama はこのPC上の OpenAI互換エンドポイントを使います。';
  }

  return 'AIを使わず、入力文ベースの補助だけで動かします。';
}
