/**
 * Unificação dos palpites: quando o usuário abre um jogo, a página calcula a
 * previsão com os ÚLTIMOS 5 JOGOS REAIS de cada time (getMatchPreview).
 * Esses números são melhores do que os do robô (que usa só o índice recente das
 * ligas configuradas). Este módulo regrava o snapshot dos selos com essa mesma
 * previsão — sem gastar nenhuma chamada extra da API-Football — para que selo,
 * resumo e previsão IA mostrem exatamente os mesmos valores.
 */
import { createServerFn } from "@tanstack/react-start";
import type { TeamPreviewStats } from "./api-football.functions";
import type { AutoPickLite } from "./market-filter";

const MARKET_KEY = "scan_snapshot";

export interface ScanSyncInput {
  fixtureId: number;
  homeName: string;
  awayName: string;
  home: TeamPreviewStats;
  away: TeamPreviewStats;
}

export const syncScanSnapshot = createServerFn({ method: "POST" })
  .inputValidator((d: ScanSyncInput) => d)
  .handler(async ({ data }): Promise<{ picks: AutoPickLite[] } | null> => {
    if (!Number.isFinite(data?.fixtureId) || !data.home?.played || !data.away?.played) return null;

    const { computeOwnPrediction } = await import("./own-prediction");
    const { buildAutoPicks, topExactScores } = await import("./auto-ticket");
    const { loadEliteMin } = await import("./auto-tickets.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pred = computeOwnPrediction(data.home, data.away);
    if (!pred.ready) return null;

    const elites = await loadEliteMin();
    const ctx = {
      homeName: data.homeName,
      awayName: data.awayName,
      cornersOver95: pred.pCornersOver95,
      cardsOver45: Math.min(0.95, Math.max(0.05, (data.home.cardsAvg + data.away.cardsAvg) / 9)),
      pillars: {
        home: data.home,
        away: data.away,
        pred,
        referee: { name: null, cardsPerGame: null, foulsPerGame: null, n: 0 },
        h2h: null,
      },
      eliteMin: elites,
    };

    const picks = buildAutoPicks(pred, ctx as never);
    if (!picks.length) return null;

    const lite = picks.map((p) => ({
      market: p.market,
      selection: p.selection,
      prob: p.prob,
      score: p.score ?? null,
      elite: p.elite ?? null,
    }));
    // Placar exato: usa o MESMO placar sugerido pela página (motor mestre, já
    // coerente com a tendência), e não o placar bruto da matriz.
    const { buildMasterPrediction } = await import("./master-engine");
    const master = buildMasterPrediction(pred);
    const raw = topExactScores(pred.matrix)[0];
    const top = master.exactScore?.p
      ? { i: master.exactScore.h, j: master.exactScore.a, p: master.exactScore.p }
      : raw;
    if (top) {
      const entry = {
        market: "Placar Exato Seco",
        selection: `${top.i} - ${top.j}`,
        prob: top.p,
        score: null,
        elite: null,
      };
      const i = lite.findIndex((p) => p.market === "Placar Exato Seco");
      if (i >= 0) lite[i] = entry;
      else lite.push(entry);
    }

    // Lê o snapshot atual para preservar kickoff / nomes / contexto dos pilares.
    const { data: rows } = await supabaseAdmin
      .from("ai_predictions")
      .select("features")
      .eq("market", MARKET_KEY)
      .eq("fixture_id", data.fixtureId)
      .limit(1);
    const prev = (rows?.[0]?.features ?? {}) as Record<string, unknown>;

    const features = {
      ...prev,
      fixtureId: data.fixtureId,
      home: data.homeName,
      away: data.awayName,
      pUnder15: pred.pUnder15,
      pOver15: pred.pOver15,
      pUnder25: pred.pUnder25,
      pOver25: pred.pOver25,
      pBTTS: pred.pBTTS,
      pNoBTTS: pred.pNoBTTS,
      pCornersOver95: pred.pCornersOver95,
      bestProb: Math.max(pred.pUnder15, pred.pOver25, pred.pBTTS, pred.pCornersOver95),
      picks: lite,
      syncedFromPreview: true,
    };

    await supabaseAdmin.from("ai_predictions").delete().eq("market", MARKET_KEY).eq("fixture_id", data.fixtureId);
    await supabaseAdmin.from("ai_predictions").insert({
      fixture_id: data.fixtureId,
      market: MARKET_KEY,
      probability: Math.max(0, Math.min(99.99, Math.round((features.bestProb ?? 0) * 100))),
      score: 0,
      features: features as unknown as never,
    });

    // Mantém o bilhete automático coerente com o que a página mostra.
    const bet = picks.filter((p) => p.elite !== false);
    await supabaseAdmin
      .from("auto_tickets")
      .update({ picks: (bet as unknown) as never, status: bet.length ? "pending" : "skipped" })
      .eq("fixture_id", data.fixtureId)
      .eq("status", "pending");

    return {
      picks: lite.map((p) => ({
        market: p.market,
        selection: p.selection,
        prob: p.prob,
        score: p.score ?? undefined,
        elite: p.elite ?? undefined,
      })),
    };
  });
