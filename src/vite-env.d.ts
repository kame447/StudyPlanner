/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_PROVIDER?: 'ollama' | 'rules';
  readonly VITE_AI_BASE_URL?: string;
  readonly VITE_AI_MODEL?: string;
  readonly VITE_AI_API_KEY?: string;
  readonly VITE_NL_RULES_PIPELINE_MODE?: 'legacy' | 'pipeline' | 'hybrid';
  readonly VITE_NL_LEGACY_PARSER_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
