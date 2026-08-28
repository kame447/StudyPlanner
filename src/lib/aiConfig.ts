export type AiProvider = 'openai' | 'rules';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const AI_RUNTIME_STORAGE_KEY = 'studyplanner.ai.runtime.v1';
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna';
const CLOUDFLARE_PROXY_URL = import.meta.env.VITE_CLOUDFLARE_AI_PROXY_URL?.trim() ?? '';

function isAiProvider(value: string): value is AiProvider {
  return value === 'openai' || value === 'rules';
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
      baseUrl: '',
      model: '',
      apiKey: '',
    };
  }

  return {
    baseUrl: OPENAI_DEFAULT_BASE_URL,
    model: OPENAI_DEFAULT_MODEL,
    apiKey: '',
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

export function allowsDirectOpenAiTransport(): boolean {
  return !import.meta.env.PROD;
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

export function getAiConfigValidationMessage(
  config: AiConfig,
): string | undefined {
  if (config.provider === 'rules') {
    return undefined;
  }

  if (!usesCloudflareOpenAiProxy(config) && !allowsDirectOpenAiTransport()) {
    return '本番環境のAI通信にはCloudflare AI proxyの設定が必要です。';
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
    if (usesCloudflareOpenAiProxy(config)) return 'AI assist (Cloudflare Workers経由)';
    return allowsDirectOpenAiTransport() ? 'AI assist (開発・評価用direct)' : 'AI assist (proxy未設定)';
  }

  return 'current pipeline only';
}

export function getAiStorageNote(config: AiConfig = getAiConfig()): string {
  if (config.provider === 'openai') {
    if (usesCloudflareOpenAiProxy(config)) {
      return 'OpenAIキーは Cloudflare Workers の secret に置き、ブラウザには保存しません。';
    }
    if (!allowsDirectOpenAiTransport()) {
      return '本番環境ではブラウザからOpenAIへ直接接続しません。Cloudflare AI proxyを設定してください。';
    }
    return 'direct接続は開発・評価専用です。APIキーはこのブラウザタブの sessionStorage にだけ保存します。';
  }

  return 'AI assist を使わず、current pipeline だけで動かします。';
}
