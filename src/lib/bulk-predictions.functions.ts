import { createServerFn } from "@tanstack/react-start";
import { getMatchPreview, getLiveFixtures } from "./api-football.functions";
import { computeOwnPrediction, OwnPrediction } from "./own-prediction";
import { MarketFilterId } from "./market-filter";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ScanPrediction extends OwnPrediction {
  fixtureId: number;
  bestMarket?: MarketFilterId;
  bestProb?: number;
  topMarkets?: { id: MarketFilterId; prob: number }[];
}

export const getBulkPredictions = createServerFn({ method: "POST" })
  .inputValidator((d: { fixtures: { id: number; homeId: number; awayId: number }[] }) => d)
  .handler(async ({ data }) => {
    const CHUNK_SIZE = 2; // Further reduced to prevent high concurrency API spikes
    // Cada jogo custa ~12 chamadas na API-Football (2 times × últimos 5 jogos + estatísticas).
    // Teto rígido por execução para nunca mais estourar a cota.
    const MAX_FIXTURES = 10;
    const results: ScanPrediction[] = [];
    
    // Buscar jogos que JÁ ESTÃO no banco (previsões persistidas pelo usuário ou sistema)
    const { data: dbPredictions } = await supabaseAdmin
      .from("ai_predictions")
      .select("*")
      .in("fixture_id", data.fixtures.map(f => f.id));

    const dbMap = new Map(dbPredictions?.map(p => [p.fixture_id, p]) || []);

    for (let i = 0; i < data.fixtures.length; i += CHUNK_SIZE) {
      const chunk = data.fixtures.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (f) => {
          try {
            // Se o jogo tem previsão no banco, usamos os dados do banco como verdade absoluta do site
            const dbPred = dbMap.get(f.id);
            
            const preview = await getMatchPreview({ data: { homeId: f.homeId, awayId: f.awayId, last: 5 } });
            if (!preview) return null;
            const pred = computeOwnPrediction(preview.home, preview.away);
            
            // Priorizar valores do banco se existirem
            if (dbPred) {
              // Ajustamos a predição baseada no que o usuário salvou/viu no site
              if (dbPred.market === "u15") pred.pUnder15 = Math.max(pred.pUnder15, dbPred.probability / 100);
              if (dbPred.market === "o15") pred.pOver15 = Math.max(pred.pOver15, dbPred.probability / 100);
            }

            const markets: { id: MarketFilterId; prob: number }[] = [
              { id: "u15" as MarketFilterId, prob: pred.pUnder15 },
              { id: "o15" as MarketFilterId, prob: pred.pOver15 },
              { id: "btts_yes" as MarketFilterId, prob: pred.pBTTS },
              { id: "btts_no" as MarketFilterId, prob: pred.pNoBTTS },
              { id: "corners_o95" as MarketFilterId, prob: pred.pCornersOver95 },
              { id: "corners_u95" as MarketFilterId, prob: 1 - pred.pCornersOver95 },
            ].sort((a, b) => b.prob - a.prob);

            const top3 = markets.slice(0, 3).filter(m => m.prob > 0.45);
            const best = markets[0];

            return { 
              ...pred, 
              fixtureId: f.id, 
              bestMarket: best.id, 
              bestProb: best.prob,
              topMarkets: top3
            };
          } catch (e) {
            console.error(`Error predicting fixture ${f.id}:`, e);
            return null;
          }
        })
      );
      
      for (const r of chunkResults) {
        if (r !== null && r.ready) {
          results.push(r);
        }
      }
    }
    
    return results;
  });
