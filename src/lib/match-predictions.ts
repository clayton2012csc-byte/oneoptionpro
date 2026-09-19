import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "./fechamentos";
import { isSupabaseConfigured } from "@/lib/public-config";

export type MatchPrediction = {
  id: string;
  fixture_id: number;
  market: string;
  probability: number;
  score: number;
  features: {
    home?: string;
    away?: string;
    time?: string;
    [key: string]: any;
  };
  created_at: string;
  result?: {
    hit: boolean | null;
    actual: string;
    settled_at: string;
    score?: string;
  } | null;
};

/** Salva uma previsão de mercado para um jogo específico. */
export async function saveMatchPrediction(input: {
  fixtureId: number;
  market: string;
  probability: number;
  score: number;
  features: any;
}) {
  if (!isSupabaseConfigured()) return null;
  const deviceId = getDeviceId();
  const { data: { user } } = await supabase.auth.getUser();

  // Verifica se já existe uma previsão para este jogo e mercado nas últimas 24h
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data: existing } = await supabase
    .from("ai_predictions")
    .select("id")
    .eq("fixture_id", input.fixtureId)
    .eq("market", input.market)
    .gt("created_at", yesterday)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from("ai_predictions")
    .insert({
      fixture_id: input.fixtureId,
      market: input.market,
      // A coluna probability é numeric(6,4) → teto 99.99 (evita erro 22003/100).
      probability: Math.max(0, Math.min(99.99, input.probability)),
      score: input.score,
      features: input.features,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Lista as previsões salvas para auditoria. */
export async function listMatchPredictions() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from("ai_predictions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as MatchPrediction[];
}
