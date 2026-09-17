/**
 * Camada dos 5 Pilares — Score de Confiança (0..100) por mercado.
 *
 * P1 — Média das Equipes .... gols/cantos/cartões pró & contra
 * P2 — Frequência L10 ....... a linha bateu em X dos últimos 10 jogos
 * P3 — Fator Arbitragem ..... tendência de cartões/faltas do juiz
 * P4 — Confronto H2H ........ histórico direto entre as equipes
 * P5 — Poisson/xG ........... matriz de placar (exato e margem)
 *
 * O score alimenta o Filtro de Elite: cada mercado exige um mínimo
 * configurado em `ai_weights` (ex.: Placar Exato Seco 70, Cartões 75)
 * para o palpite ser EMITIDO (apostado). Nenhum mercado é removido —
 * os 11 continuam sendo gerados e exibidos com o seu score no front-end.
 */
import type { TeamPreviewStats } from "./api-football.functions";
import type { OwnPrediction } from "./own-prediction";

/** Dados de arbitragem (P3). Quando indisponíveis, contribuem neutro. */
export interface PillarReferee {
  name: string | null;
  /** cartões médios POR JOGO aplicados pelo árbitro (soma dos dois times) */
  cardsPerGame?: number | null;
  /** faltas médias por jogo (soma dos dois times) */
  foulsPerGame?: number | null;
  /** quantos jogos observados do árbitro */
  n?: number;
}

/** Histórico direto (P4). Quando indisponível, contribui neutro. */
export interface PillarH2H {
  n: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  totalGoals: number;
  bttsGames: number;
}

/** Dados brutos que alimentam a pontuação dos 5 Pilares. */
export interface PillarInput {
  home: TeamPreviewStats;
  away: TeamPreviewStats;
  pred: OwnPrediction;
  referee?: PillarReferee | null;
  h2h?: PillarH2H | null;
  /** médias reais de escanteios/cartões quando conhecidas (senão usa TeamPreviewStats) */
  corners?: { homeAvg: number; awayAvg: number } | null;
  cards?: { homeAvg: number; awayAvg: number } | null;
}

/** Centavos (0..1) de cada pilar para um pick. */
export interface PillarBreakdown {
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
}

export interface PillarScore {
  /** nota final 0..100 */
  score: number;
  /** mínimo de mercado usado no Filtro de Elite */
  min: number;
  /** Filtro de Elite: o palpite deve ser emitido/apostado? */
  elite: boolean;
  breakdown: PillarBreakdown;
  context: PillarContext;
  /** linhas curtas do contexto para exibição (ex.: "Juiz X · L10 O2.5 60%") */
  notes: string[];
}

export interface PillarContext {
  refereeName: string | null;
  h2hGames: number;
  homeL10: string;
  awayL10: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clamp100 = (x: number) => Math.round(Math.max(0, Math.min(100, x)));

/** Teto realista (probabilidade máxima típica) por mercado — denominador da força do P5. */
export const PILLAR_CEILING: Record<string, number> = {
  "Resultado 1X2": 0.62,
  "Gols Dinâmico": 0.72,
  "Ambas Marcam": 0.7,
  "Escanteios": 0.62,
  "Intervalo / Final": 0.46,
  "Cartões": 0.6,
  "Evolução do Jogo": 0.5,
  "Margem de Vitória": 0.58,
  "Placar Múltiplo Exato": 0.62,
  "Placar Exato Seco": 0.26,
  "Aposta Montada": 0.5,
};

/** Pesos-padrão dos pilares no cálculo do score (soma 100). */
export const PILLAR_WEIGHTS: PillarBreakdown = { p1: 0.2, p2: 0.2, p3: 0.15, p4: 0.1, p5: 0.45 };

/** Mínimos padrão do Filtro de Elite por mercado (sobrescritos por ai_weights). */
export const DEFAULT_ELITE_MIN: Record<string, number> = {
  "Resultado 1X2": 60,
  "Gols Dinâmico": 60,
  "Ambas Marcam": 60,
  "Escanteios": 60,
  "Intervalo / Final": 65,
  "Cartões": 75,
  "Evolução do Jogo": 65,
  "Margem de Vitória": 65,
  "Placar Múltiplo Exato": 65,
  "Placar Exato Seco": 70,
  "Aposta Montada": 65,
};

/** Mescla os mínimos do banco (ai_weights.weights.minimum_scores) com os padrões. */
export function mergeEliteMin(db?: Record<string, number> | null): Record<string, number> {
  return { ...DEFAULT_ELITE_MIN, ...(db ?? {}) };
}

/** Frequência L10 de que uma linha de GOLS bateu (por time). */
export function l10GoalsFreq(t: TeamPreviewStats, line: number, over: boolean): number {
  const n = t.lastResults?.length ?? 0;
  if (!n) return 0.5;
  let hit = 0;
  for (const r of t.lastResults) {
    const total = (r.gf ?? 0) + (r.ga ?? 0);
    if (over ? total > line : total < line) hit++;
  }
  return hit / n;
}

/** Resumo textual do L10 de um time (para o front-end). */
export function l10Summary(t: TeamPreviewStats): string {
  const n = t.lastResults?.length ?? 0;
  if (!n) return "L10 sem dados";
  const over25 = l10GoalsFreq(t, 2.5, true);
  const btts = n ? t.lastResults.filter((r) => (r.gf ?? 0) > 0 && (r.ga ?? 0) > 0).length / n : 0;
  return `L10 n=${n} · O2.5 ${(over25 * 100) | 0}% · BTTS ${(btts * 100) | 0}%`;
}

export function buildContext(inp: PillarInput): PillarContext {
  return {
    refereeName: inp.referee?.name ?? null,
    h2hGames: inp.h2h?.n ?? 0,
    homeL10: l10Summary(inp.home),
    awayL10: l10Summary(inp.away),
  };
}

function finalize(breakdown: PillarBreakdown, min: number, inp: PillarInput, notes: string[]): PillarScore {
  const raw = breakdown.p1 * PILLAR_WEIGHTS.p1 + breakdown.p2 * PILLAR_WEIGHTS.p2 + breakdown.p3 * PILLAR_WEIGHTS.p3 + breakdown.p4 * PILLAR_WEIGHTS.p4 + breakdown.p5 * PILLAR_WEIGHTS.p5;
  const scoreRaw = raw * 100;
  return {
    score: clamp100(scoreRaw),
    min,
    elite: scoreRaw >= min,
    breakdown,
    context: buildContext(inp),
    notes,
  };
}

/** Que tipo de linha o mercado usa (para P1/P2 usarem a métrica certa). */
export type PillarKind = "goals" | "corners" | "cards";

export function kindOf(market: string): PillarKind {
  if (market === "Escanteios") return "corners";
  if (market === "Cartões") return "cards";
  return "goals";
}

/** Média esperada de gols/cantos/cartões do confronto (P1). */
function expectedRate(kind: PillarKind, inp: PillarInput): { total: number; sample: string } {
  if (kind === "cards") {
    const home = inp.cards?.homeAvg ?? inp.home.cardsAvg ?? 2;
    const away = inp.cards?.awayAvg ?? inp.away.cardsAvg ?? 2;
    return { total: home + away, sample: "cartões" };
  }
  if (kind === "corners") {
    const home = inp.corners?.homeAvg ?? inp.home.cornersTotalAvg;
    const away = inp.corners?.awayAvg ?? inp.away.cornersTotalAvg;
    return { total: (home + away) / 2, sample: "cantos" };
  }
  // gols: usa o xG do próprio modelo Poisson (coerente com o P5)
  return { total: inp.pred.lambdaHome + inp.pred.lambdaAway, sample: "gols" };
}

/** Especificação de uma escolha (traduzida do PickRule pelo buildAutoPicks). */
export interface PickSelector {
  /** linha (over/under) de gols/cantos/cartões */
  line: number | null;
  over?: boolean | null;
  /** Ambas Marcam */
  bttsYes?: boolean | null;
  /** 1X2 / margem / evolução (lado do resultado) */
  side?: "H" | "D" | "A" | null;
  /** placar exato (gols casa, gols fora) */
  exact?: [number, number] | null;
}

/**
 * Score 0..100 de um pick nos 5 Pilares.
 * `prob` = probabilidade Poisson do palpite (P5).
 */
export function scorePick(
  market: string,
  prob: number,
  sel: PickSelector,
  inp: PillarInput,
  min: number,
): PillarScore {
  const kind = kindOf(market);
  const ceiling = PILLAR_CEILING[market] ?? 0.6;
  const p5 = clamp01(prob / ceiling);
  const notes: string[] = [];

  // ---- P1: médias das equipes ----
  let p1 = 0.5;
  if (kind === "goals" && sel.line != null) {
    const avg = inp.pred.lambdaHome + inp.pred.lambdaAway;
    p1 = clamp01(sel.over ? 0.5 + (avg - sel.line) * 0.7 : 0.5 + (sel.line - avg) * 0.7);
  } else if (kind === "goals" && sel.bttsYes != null) {
    const gfAvg = (inp.home.goalsForAvg + inp.away.goalsForAvg) / 2;
    p1 = clamp01(sel.bttsYes ? gfAvg / 2 : 1 - gfAvg / 2);
  } else if (kind === "goals" && sel.side) {
    const diff = (inp.home.goalsForAvg - inp.home.goalsAgainstAvg) - (inp.away.goalsForAvg - inp.away.goalsAgainstAvg);
    if (sel.side === "H") p1 = clamp01(0.5 + diff * 0.6);
    else if (sel.side === "A") p1 = clamp01(0.5 - diff * 0.6);
    else p1 = clamp01(0.6 - Math.abs(diff) * 0.4);
  } else if (kind === "goals" && sel.exact) {
    const [i, j] = sel.exact;
    p1 = clamp01(1 - (Math.abs(inp.home.goalsForAvg - i) + Math.abs(inp.away.goalsForAvg - j)) / 6);
  } else {
    // linhas de gols sem lado definido (+ mercados de placa) usam a média esperada
    const exp = expectedRate(kind, inp);
    if (sel.line != null) p1 = clamp01(sel.over ? 0.5 + (exp.total - sel.line) * 0.3 : 0.5 + (sel.line - exp.total) * 0.3);
  }

  // ---- P2: frequência L10 ----
  let p2 = 0.5;
  if (kind === "goals" && sel.line != null) {
    const over = sel.over ?? true;
    p2 = (l10GoalsFreq(inp.home, sel.line, over) + l10GoalsFreq(inp.away, sel.line, over)) / 2;
    notes.push(`L10 linha ${over ? "> " : "< "}${sel.line} ${(p2 * 100) | 0}%`);
  } else if (kind === "goals" && sel.bttsYes != null) {
    const rate = (inp.home.bttsPct / 100 + inp.away.bttsPct / 100) / 2;
    p2 = clamp01(sel.bttsYes ? rate : 1 - rate);
  } else if (kind === "goals" && sel.side) {
    const wins = (t: TeamPreviewStats) =>
      t.lastResults?.length ? t.lastResults.filter((r) => r.result === "V").length / t.lastResults.length : 0;
    const draws = (t: TeamPreviewStats) =>
      t.lastResults?.length ? t.lastResults.filter((r) => r.result === "E").length / t.lastResults.length : 0;
    if (sel.side === "H") p2 = clamp01(wins(inp.home));
    else if (sel.side === "A") p2 = clamp01(wins(inp.away));
    else p2 = clamp01((draws(inp.home) + draws(inp.away)) / 2);
  } else if (kind === "goals" && sel.exact) {
    // P2: frequência com que o VOLUME de gols bate no L10 (total == i+j  → peso 1;
    // total a ±1 → peso 0.4). Mais estável que exigir o placar exato literal.
    const hit = (t: TeamPreviewStats, total: number) => {
      if (!t.lastResults?.length) return 0.5;
      let acc = 0;
      for (const r of t.lastResults) {
        const t0 = (r.gf ?? 0) + (r.ga ?? 0);
        if (t0 === total) acc += 1;
        else if (Math.abs(t0 - total) <= 1) acc += 0.4;
      }
      return clamp01(acc / t.lastResults.length);
    };
    p2 = clamp01((hit(inp.home, sel.exact[0] + sel.exact[1]) + hit(inp.away, sel.exact[0] + sel.exact[1])) / 2);
  } else {
    // cantos/cartões: sem histórico por jogo no snapshot → neutro
    notes.push(kind === "cards" ? "cartões sem L10 (estimar)" : "cantos sem L10 (estimar)");
  }

  // ---- P3: arbitragem (relevante para cartões) ----
  let p3 = 0.5;
  const refN = inp.referee?.n ?? 0;
  if (kind === "cards" && refN > 0 && inp.referee?.cardsPerGame != null) {
    p3 = clamp01(0.5 + (inp.referee.cardsPerGame - 4.5) * 0.35);
    notes.push(`Juiz ${inp.referee.name ?? "?"} ${inp.referee.cardsPerGame.toFixed(1)} cartões/jogo`);
  } else {
    notes.push(inp.referee?.name ? `Juiz ${inp.referee.name} (sem histórico)` : "sem arbitragem disponível");
  }

  // ---- P4: H2H ----
  let p4 = 0.5;
  const h2h = inp.h2h;
  if (h2h && h2h.n >= 2) {
    if (kind === "goals" && sel.line != null) {
      const avg = h2h.totalGoals / h2h.n;
      p4 = clamp01(sel.over ? 0.5 + (avg - sel.line) * 0.6 : 0.5 + (sel.line - avg) * 0.6);
      notes.push(`H2H n=${h2h.n} média ${avg.toFixed(1)} gols`);
    } else if (kind === "goals" && sel.bttsYes != null) {
      const rate = h2h.bttsGames / h2h.n;
      p4 = clamp01(sel.bttsYes ? rate : 1 - rate);
    } else if (kind === "goals" && sel.side) {
      p4 = clamp01(sel.side === "H" ? h2h.homeWins / h2h.n : sel.side === "A" ? h2h.awayWins / h2h.n : h2h.draws / h2h.n);
    } else if (kind === "goals" && sel.exact) {
      const [i, j] = sel.exact;
      const avg = h2h.totalGoals / h2h.n;
      p4 = clamp01(1 - Math.abs(avg - (i + j)) / 4);
    }
    notes.push(`H2H n=${h2h.n}`);
  }

  const breakdown: PillarBreakdown = { p1, p2, p3, p4, p5 };
  return finalize(breakdown, min, inp, notes);
}

/** Score agregado (ex.: Aposta Montada) = média dos scores das pernas. */
export function combinePillarScores(scores: PillarScore[]): PillarScore | null {
  if (!scores.length) return null;
  const h = scores[0];
  const breakdown = {
    p1: scores.reduce((a, s) => a + s.breakdown.p1, 0) / scores.length,
    p2: scores.reduce((a, s) => a + s.breakdown.p2, 0) / scores.length,
    p3: scores.reduce((a, s) => a + s.breakdown.p3, 0) / scores.length,
    p4: scores.reduce((a, s) => a + s.breakdown.p4, 0) / scores.length,
    p5: scores.reduce((a, s) => a + s.breakdown.p5, 0) / scores.length,
  };
  const raw = breakdown.p1 * PILLAR_WEIGHTS.p1 + breakdown.p2 * PILLAR_WEIGHTS.p2 + breakdown.p3 * PILLAR_WEIGHTS.p3 + breakdown.p4 * PILLAR_WEIGHTS.p4 + breakdown.p5 * PILLAR_WEIGHTS.p5;
  const min = Math.max(...scores.map((s) => s.min));
  return {
    score: clamp100(raw * 100),
    min,
    // combo só é emitido se TODAS as pernas forem Elite
    elite: scores.length > 0 && scores.every((s) => s.elite),
    breakdown,
    context: h.context,
    notes: [...new Set(scores.flatMap((s) => s.notes))].slice(0, 4),
  };
}