/**
 * Persistência blindada dos resultados da varredura (selos/probabilidades por jogo).
 * Grava no banco (ai_predictions, market = "scan_snapshot") assim que a varredura roda
 * e relê tudo ao abrir o site — sem gastar nenhuma requisição da API-Football.
 */
import { createServerFn } from "@tanstack/react-start";
import type { AutoPickLite, ScanPrediction } from "./market-filter";

const MARKET_KEY = "scan_snapshot";
const WINDOW_MS = 72 * 60 * 60 * 1000;

/** Reduz os picks persistidos ao que o card exibe: placar exato (ou melhor placar múltiplo) + top 3 demais mercados. */
function toBadgePicks(raw: unknown): AutoPickLite[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const all = (raw as { market?: string; selection?: string; prob?: number; score?: number; elite?: boolean }[])
    .filter((p) => p && typeof p.market === "string" && typeof p.selection === "string" && typeof p.prob === "number")
    .map((p) => ({
      market: p.market!,
      selection: p.selection!,
      prob: p.prob! as number,
      score: typeof p.score === "number" ? p.score : undefined,
      elite: typeof p.elite === "boolean" ? p.elite : undefined,
    }));
  if (!all.length) return undefined;

  let exact = all.find((p) => p.market === "Placar Exato Seco");
  let multi: AutoPickLite | undefined;
  if (!exact) {
    multi = all.find((p) => p.market === "Placar Múltiplo Exato");
    const first = multi?.selection.split(",")[0]?.trim();
    if (multi && first) exact = { market: "Placar Exato Seco", selection: first, prob: multi.prob, score: multi.score, elite: multi.elite };
  }

  const others = all
    .filter((p) => p.market !== "Placar Exato Seco" && (!multi || p.market !== "Placar Múltiplo Exato"))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3);

  const out: AutoPickLite[] = [];
  if (exact) out.push(exact);
  out.push(...others);
  return out.length ? out : undefined;
}

export const saveScanPredictions = createServerFn({ method: "POST" })
  .inputValidator((d: { predictions: ScanPrediction[] }) => d)
  .handler(async ({ data }) => {
    const rows = (data.predictions ?? []).filter((p) => p && Number.isFinite(p.fixtureId));
    if (!rows.length) return { saved: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = rows.map((p) => p.fixtureId);

    // Preserva picks/kickoff já gravados pelo robô — a varredura manual NÃO pode apagá-los.
    const { data: existing } = await supabaseAdmin
      .from("ai_predictions")
      .select("fixture_id, features")
      .eq("market", MARKET_KEY)
      .in("fixture_id", ids);
    const prev = new Map<number, { picks: unknown; kickoff?: string }>();
    for (const r of existing ?? []) {
      const f = r.features as { picks?: unknown; kickoff?: string } | null;
      if (f && Array.isArray(f.picks) && f.picks.length && !prev.has(Number(r.fixture_id))) {
        prev.set(Number(r.fixture_id), { picks: f.picks, kickoff: f.kickoff });
      }
    }

    // Substitui o snapshot anterior de cada jogo (upsert manual — sem chave única na tabela)
    await supabaseAdmin.from("ai_predictions").delete().eq("market", MARKET_KEY).in("fixture_id", ids);

    const { error } = await supabaseAdmin.from("ai_predictions").insert(
      rows.map((p) => ({
        fixture_id: p.fixtureId,
        market: MARKET_KEY,
        probability: Math.round((p.bestProb ?? 0) * 100),
        score: 0,
        features: (prev.has(p.fixtureId) ? { ...p, ...prev.get(p.fixtureId) } : p) as unknown as never,
      })),
    );
    if (error) throw new Error(error.message);
    return { saved: rows.length };
  });

/** Lê os selos já calculados (últimas 48h) direto do banco — leitura instantânea. */
export const loadScanPredictions = createServerFn({ method: "GET" }).handler(async (): Promise<ScanPrediction[]> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("ai_predictions")
    .select("fixture_id, features, created_at")
    .eq("market", MARKET_KEY)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3000);
  if (error) throw new Error(error.message);

  const seen = new Set<number>();
  const out: ScanPrediction[] = [];
  for (const row of data ?? []) {
    const id = Number(row.fixture_id);
    if (seen.has(id)) continue;
    const f = row.features as unknown as ScanPrediction | null;
    if (!f || typeof f !== "object") continue;
    seen.add(id);
    out.push({ ...f, fixtureId: id, picks: toBadgePicks(f.picks) });
  }
  return out;
});
