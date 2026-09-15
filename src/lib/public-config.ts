export type PublicConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

declare global {
  interface Window {
    __APP_CONFIG__?: PublicConfig;
  }
}

let cached: PublicConfig | null = null;

function fromEnv(): PublicConfig | null {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const proc =
    typeof process !== "undefined"
      ? ((process.env ?? {}) as Record<string, string | undefined>)
      : {};

  const url =
    env["VITE_SUPABASE_URL"] || proc["APP_SUPABASE_URL"] || proc["SUPABASE_URL"] || undefined;
  const anon =
    env["VITE_SUPABASE_ANON_KEY"] ||
    proc["APP_SUPABASE_ANON_KEY"] ||
    proc["SUPABASE_ANON_KEY"] ||
    undefined;

  if (!url || !anon) return null;
  return { supabaseUrl: url, supabaseAnonKey: anon };
}

export function setPublicConfig(config: PublicConfig | null | undefined) {
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) return;
  cached = config;
  if (typeof window !== "undefined") window.__APP_CONFIG__ = config;
}

export function getPublicConfig(): PublicConfig {
  if (cached) return cached;
  if (typeof window !== "undefined" && window.__APP_CONFIG__) {
    cached = window.__APP_CONFIG__;
    return cached;
  }
  const env = fromEnv();
  if (env) {
    cached = env;
    return cached;
  }
  throw new Error(
    "Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (ou APP_SUPABASE_URL / APP_SUPABASE_ANON_KEY no servidor).",
  );
}

/** Verdadeiro quando há URL e chave anônima disponíveis no navegador. */
export function isSupabaseConfigured(): boolean {
  try {
    const cfg = getPublicConfig();
    return Boolean(cfg && cfg.supabaseUrl && cfg.supabaseAnonKey);
  } catch {
    return false;
  }
}
