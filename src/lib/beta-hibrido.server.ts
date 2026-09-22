/**
 * Beta — leitura da base da Triagem (server-only).
 * Só consulta triagem_records: nenhuma chamada à API-Football.
 */
import {
  BETA_MARKETS,
  BETA_MIN_SCORE,
  BETA_STAKE,
  buildBetaHibrido,
  type BetaCandidate,
  type BetaSnapshot,
} from "./beta-hibrido";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function table(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return (supabaseAdmin as any).from("triagem_records");
}

function spDay(iso: string | number | Date): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function splitName(matchName: string): { home: string; away: string } {
  const parts = String(matchName ?? "").split(/\s+[x×]\s+/i);
  return { home: parts[0]?.trim() || "Mandante", away: parts[1]?.trim() || "Visitante" };
}

/** Varredura instantânea: jogos de hoje com perfil defensivo de alta confiança. */
export async function betaHibridoSnapshot(): Promise<BetaSnapshot> {
  const now = Date.now();
  const day = spDay(now);
  const empty: BetaSnapshot = { day, builtAt: new Date(now).toISOString(), stake: BETA_STAKE, games: [], scanned: 0 };

  const from = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 30 * 60 * 60 * 1000).toISOString();

  const t = await table();
  const { data, error } = await t
    .select("fixture_id, match_name, league, kickoff, market_type, predicted_value, score_confidence, probability, status")
    .in("market_type", BETA_MARKETS as unknown as string[])
    .eq("passed", true)
    .eq("status", "pending")
    .gte("kickoff", from)
    .lte("kickoff", to)
    .gte("score_confidence", BETA_MIN_SCORE)
    .order("kickoff", { ascending: true })
    .limit(1000);

  if (error || !data?.length) return empty;

  const byFixture = new Map<number, BetaCandidate>();
  for (const row of data as any[]) {
    const id = Number(row.fixture_id);
    if (!Number.isFinite(id)) continue;
    const names = splitName(row.match_name);
    let c = byFixture.get(id);
    if (!c) {
      c = {
        fixtureId: id,
        matchName: row.match_name ?? `${names.home} x ${names.away}`,
        home: names.home,
        away: names.away,
        league: row.league ?? null,
        kickoff: row.kickoff ?? null,
        score: 0,
        markets: [],
      };
      byFixture.set(id, c);
    }
    c.markets.push({
      market_type: row.market_type,
      predicted_value: row.predicted_value ?? "",
      score_confidence: Number(row.score_confidence ?? 0),
      probability: Number(row.probability ?? 0),
    });
    c.score = Math.max(c.score, Number(row.score_confidence ?? 0));
  }

  const candidates = Array.from(byFixture.values());
  return { ...empty, games: buildBetaHibrido(candidates), scanned: candidates.length };
}
