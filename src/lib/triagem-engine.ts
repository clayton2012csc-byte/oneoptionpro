/**
 * Motor de Triagem — filtro de elite funilizado (9 mercados isolados).
 *
 * Regra geral: um jogo só entra em um mercado quando passa no crivo específico
 * daquele mercado E o Score de Confiança é >= 75 (0..100).
 * Cada mercado tem conferência própria, então a calibração de um não afeta o outro.
 */
import type { OwnPrediction } from "./own-prediction";

export const TRIAGEM_MARKETS = [
  "under_1_5",
  "over_1_5",
  "ambas_sim",
  "ambas_nao",
  "placar_exato",
  "casa_vence",
  "empate_com_gol",
  "empate_sem_gols",
  "visitante_ganha",
] as const;

export type TriagemMarket = (typeof TRIAGEM_MARKETS)[number];

export const TRIAGEM_LABEL: Record<TriagemMarket, string> = {
  under_1_5: "Menos de 1.5 gols",
  over_1_5: "Mais de 1.5 gols",
  ambas_sim: "Ambas marcam: SIM",
  ambas_nao: "Ambas marcam: NÃO",
  placar_exato: "Placar exato",
  casa_vence: "Casa vence",
  empate_com_gol: "Empate com gol",
  empate_sem_gols: "Empate sem gols (0x0)",
  visitante_ganha: "Visitante vence",
};

/** Nota mínima (0..100) para um jogo ser publicado em um mercado da Triagem. */
export const MIN_SCORE = 75;

/**
 * Teto realista de probabilidade por mercado — a nota é a probabilidade
 * do modelo medida contra o melhor que aquele mercado costuma entregar.
 */
const CEILING: Record<TriagemMarket, number> = {
  under_1_5: 1,
  over_1_5: 1,
  ambas_sim: 1,
  ambas_nao: 1,
  placar_exato: 0.25,
  casa_vence: 1,
  empate_com_gol: 0.36,
  empate_sem_gols: 0.12,
  visitante_ganha: 1,
};

function score(market: TriagemMarket, p: number): number {
  const ceiling = CEILING[market] || 1;
  return Math.max(0, Math.min(100, Math.round((p / ceiling) * 100)));
}

export interface TriagemMatchData {
  fixtureId: number;
  matchName: string;
  league?: string | null;
  kickoff?: string | null;
  /** Média de gols marcados nos últimos 10 jogos. */
  homeGoalsForAvgL10: number;
  awayGoalsForAvgL10: number;
  /** Percentual de jogos sem sofrer gols (0..1). */
  homeCleanSheetPct: number;
  awayCleanSheetPct: number;
}

export interface TriagemCandidate {
  fixture_id: number;
  match_name: string;
  league: string | null;
  kickoff: string | null;
  market_type: TriagemMarket;
  predicted_value: string;
  score_confidence: number;
}

/** Placar mais provável da distribuição de Poisson ajustada (Dixon-Coles). */
function topScore(pred: OwnPrediction): { h: number; a: number; p: number } | null {
  const top = pred.topScores?.[0];
  if (!top) return null;
  const [h, a] = top.label.split("-").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return { h, a, p: top.p };
}

/**
 * Distribui um jogo analisado nos mercados da Triagem.
 * Um mesmo jogo pode entrar em vários mercados (cada um com nota própria).
 */
export function routeToTriagem(pred: OwnPrediction, match: TriagemMatchData): TriagemCandidate[] {
  if (!pred.ready) return [];
  const top = topScore(pred);
  if (!top) return [];

  const sum = top.h + top.a;
  const xg = pred.expectedGoals;
  const out: TriagemCandidate[] = [];

  const push = (market: TriagemMarket, predicted: string, p: number, pass: boolean) => {
    if (!pass) return;
    const s = score(market, p);
    if (s < MIN_SCORE) return;
    out.push({
      fixture_id: match.fixtureId,
      match_name: match.matchName,
      league: match.league ?? null,
      kickoff: match.kickoff ?? null,
      market_type: market,
      predicted_value: predicted,
      score_confidence: s,
    });
  };

  // UNDER 1.5 — placar previsto soma <= 1 e xG combinado < 1.8
  push("under_1_5", "Menos de 1.5", pred.pUnder15, sum <= 1 && xg < 1.8);

  // OVER 1.5 — placar previsto soma >= 2 e xG combinado > 2.2
  push("over_1_5", "Mais de 1.5", pred.pOver15, sum >= 2 && xg > 2.2);

  // AMBAS SIM — os dois times marcam > 1.2 gols/jogo no L10 e placar previsto com gols dos dois lados
  push(
    "ambas_sim",
    "Sim",
    pred.pBTTS,
    match.homeGoalsForAvgL10 > 1.2 && match.awayGoalsForAvgL10 > 1.2 && top.h > 0 && top.a > 0,
  );

  // AMBAS NÃO — algum time com clean sheet > 40% ou placar previsto zerado de um lado
  push(
    "ambas_nao",
    "Não",
    pred.pNoBTTS,
    match.homeCleanSheetPct > 0.4 || match.awayCleanSheetPct > 0.4 || top.h === 0 || top.a === 0,
  );

  // PLACAR EXATO — placar de maior probabilidade
  push("placar_exato", `${top.h}x${top.a}`, top.p, true);

  // CASA VENCE — vitória do mandante > 55% e xG mandante > visitante + 0.5
  push(
    "casa_vence",
    "Casa vence",
    pred.pHome,
    pred.pHome > 0.55 && pred.lambdaHome > pred.lambdaAway + 0.5,
  );

  // EMPATE COM GOL — previsão de empate com placar diferente de 0x0
  push("empate_com_gol", `${top.h}x${top.a}`, pred.pDraw, top.h === top.a && top.h > 0);

  // EMPATE SEM GOLS — previsão de empate exatamente 0x0
  push("empate_sem_gols", "0x0", pred.matrix?.[0]?.[0] ?? 0, top.h === 0 && top.a === 0);

  // VISITANTE GANHA — vitória do visitante > 55% e xG visitante > mandante + 0.5
  push(
    "visitante_ganha",
    "Visitante vence",
    pred.pAway,
    pred.pAway > 0.55 && pred.lambdaAway > pred.lambdaHome + 0.5,
  );

  return out;
}

/** Conferência independente de um registro da Triagem contra o placar final. */
export function gradeTriagem(
  market: TriagemMarket,
  predictedValue: string,
  goalsHome: number,
  goalsAway: number,
): "green" | "red" {
  const total = goalsHome + goalsAway;
  const ok = (() => {
    switch (market) {
      case "under_1_5":
        return total <= 1;
      case "over_1_5":
        return total >= 2;
      case "ambas_sim":
        return goalsHome > 0 && goalsAway > 0;
      case "ambas_nao":
        return goalsHome === 0 || goalsAway === 0;
      case "placar_exato":
      case "empate_com_gol": {
        const [h, a] = predictedValue.toLowerCase().split("x").map((n) => Number(n.trim()));
        return goalsHome === h && goalsAway === a;
      }
      case "casa_vence":
        return goalsHome > goalsAway;
      case "empate_sem_gols":
        return goalsHome === 0 && goalsAway === 0;
      case "visitante_ganha":
        return goalsAway > goalsHome;
      default:
        return false;
    }
  })();
  return ok ? "green" : "red";
}
