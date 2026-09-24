// O banco agora é o Lovable Cloud: a conexão já vem pronta no cliente gerado.
export type PublicConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function setPublicConfig(_config: PublicConfig | null | undefined) {
  // Mantido por compatibilidade; a conexão é configurada automaticamente.
}

export function getPublicConfig(): PublicConfig {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return {
    supabaseUrl: env["VITE_SUPABASE_URL"] ?? "",
    supabaseAnonKey: env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
  };
}

export function isSupabaseConfigured(): boolean {
  return true;
}
