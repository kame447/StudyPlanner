/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_PROVIDER?: 'openai' | 'rules';
  readonly VITE_AI_BASE_URL?: string;
  readonly VITE_AI_MODEL?: string;
  readonly VITE_AI_API_KEY?: string;
  readonly VITE_NL_CURRENT_PIPELINE_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
