import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function getCachedData(key: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("api_cache")
      .select("data, expires_at")
      .eq("key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.error("[api-cache] Error reading cache:", error.message);
      return null;
    }
    
    return data ? data.data : null;
  } catch (err) {
    console.error("[api-cache] Unexpected error reading cache:", err);
    return null;
  }
}

export async function setCachedData(key: string, data: any, ttlMs: number) {
  try {
    // Nunca grava array vazio: evita reincidir no bug dos 5.535 caches com `[]`.
    if (Array.isArray(data) && data.length === 0) {
      return;
    }
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const { error } = await supabaseAdmin
      .from("api_cache")
      .upsert({
        key,
        data,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error("[api-cache] Error writing cache:", error.message);
    }
  } catch (err) {
    console.error("[api-cache] Unexpected error writing cache:", err);
  }
}

/** Cleanup old cache entries (older than 2 days) */
export async function cleanupCache() {
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("api_cache")
      .delete()
      .lt("expires_at", twoDaysAgo);
    
    if (error) {
      console.error("[api-cache] Error cleaning up cache:", error.message);
    }
  } catch (err) {
    console.error("[api-cache] Unexpected error cleaning up cache:", err);
  }
}
