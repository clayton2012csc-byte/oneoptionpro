/**
 * Triagem — persistência e conferência independente (server-only).
 * Cada mercado tem estatística própria; a conferência de um não mexe no outro.
 */
import {
  TRIAGEM_MARKETS,
  gradeTriagem,
  type TriagemCandidate,
  type TriagemMarket,
} from "./triagem-engine";

/** A tabela é nova e ainda não está nos tipos gerados — acesso solto e seguro. */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function table(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return (supabaseAdmin as any).from("triagem_records");
}

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    (error.message ?? "").includes("triagem_records")
  );
}

export interface TriagemRow {
  id: string;
  fixture_id: number;
  match_name: string;
  league: string | null;
  kickoff: string | null;
  market_type: TriagemMarket;
  predicted_value: string;
  score_confidence: number;
  status: "pending" | "green" | "red" | "void";
  result_score: string | null;
  created_at: string;
  graded_at: string | null;
}

/** Grava (ou atualiza) os registros de triagem de um jogo. */
export async function saveTriagem(candidates: TriagemCandidate[]): Promise<number> {
  if (!candidates.length) return 0;
  const t = await table();
  const { error } = await t.upsert(candidates, { onConflict: "fixture_id,market_type" });
  if (error) {
    if (missingTable(error)) {
      console.warn("[triagem] tabela ausente; execute supabase/triagem.sql");
      return 0;
    }
    console.warn("[triagem] falha ao gravar", error.message);
    return 0;
  }
  return candidates.length;
}

/** Confere todos os mercados de um jogo encerrado (independente entre si). */
export async function gradeTriagemFixture(
  fixtureId: number,
  goalsHome: number,
  goalsAway: number,
): Promise<number> {
  const t = await table();
  const { data, error } = await t
    .select("id, market_type, predicted_value")
    .eq("fixture_id", fixtureId)
    .eq("status", "pending");
  if (error || !data?.length) return 0;

  const now = new Date().toISOString();
  const resultScore = `${goalsHome}x${goalsAway}`;
  let done = 0;
  for (const row of data as { id: string; market_type: TriagemMarket; predicted_value: string }[]) {
    const status = gradeTriagem(row.market_type, row.predicted_value, goalsHome, goalsAway);
    const upd = await (await table())
      .update({ status, result_score: resultScore, graded_at: now })
      .eq("id", row.id);
    if (!upd.error) done++;
  }
  return done;
}

export interface TriagemMarketStat {
  market: TriagemMarket;
  greens: number;
  reds: number;
  pending: number;
  accuracy: number; // 0..1
  items: TriagemRow[];
}

/** Painel: estatística exclusiva de cada mercado + jogos triados. */
export async function triagemBoard(): Promise<{ markets: TriagemMarketStat[]; total: number }> {
  const base: TriagemMarketStat[] = TRIAGEM_MARKETS.map((market) => ({
    market,
    greens: 0,
    reds: 0,
    pending: 0,
    accuracy: 0,
    items: [],
  }));
  const byMarket = new Map(base.map((m) => [m.market, m]));

  const t = await table();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await t
    .select(
      "id, fixture_id, match_name, league, kickoff, market_type, predicted_value, score_confidence, status, result_score, created_at, graded_at",
    )
    .gte("created_at", since)
    .order("kickoff", { ascending: true })
    .limit(4000);

  if (error) {
    if (missingTable(error)) {
      console.warn("[triagem] tabela ausente; execute supabase/triagem.sql");
      return { markets: base, total: 0 };
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TriagemRow[];
  for (const row of rows) {
    const m = byMarket.get(row.market_type);
    if (!m) continue;
    if (row.status === "green") m.greens++;
    else if (row.status === "red") m.reds++;
    else if (row.status === "pending") m.pending++;
    if (m.items.length < 60) m.items.push(row);
  }
  for (const m of base) {
    const n = m.greens + m.reds;
    m.accuracy = n ? m.greens / n : 0;
  }
  return { markets: base, total: rows.length };
}
