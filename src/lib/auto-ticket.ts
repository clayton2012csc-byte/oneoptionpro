/**
 * Motor de Bilhete Automático (Aposta Criada) — puro / client-safe.
 * Seleciona 1 melhor opção em cada um dos 11 mercados a partir da previsão da IA
 * e sabe conferir cada pick contra o resultado real (Green / Red).
 */
import type { OwnPrediction } from "./own-prediction";
import { requiredConfidence } from "./ticket-rules";

export type PickRule =
  | { t: "1x2"; pick: "H" | "D" | "A" }
  | { t: "totals"; line: number; side: "over" | "under" }
  | { t: "ht_totals"; line: number; side: "over" | "under" }
  | { t: "btts"; yes: boolean }
  | { t: "corners"; line: number; side: "over" | "under" }
  | { t: "cards"; line: number; side: "over" | "under" }
  | { t: "htft"; ht: "1" | "X" | "2"; ft: "1" | "X" | "2" }
  | { t: "scores"; list: [number, number][] }
  | { t: "margin"; side: "H" | "D" | "A"; by: number }
  | { t: "margin_or_draw"; side: "H" | "A" }
  | { t: "evolution"; first: "H" | "A" | "none"; res: "H" | "D" | "A" }
  | { t: "combo"; legs: PickRule[] };


export interface AutoPick {
  market: string;
  selection: string;
  prob: number;
  odd: number;
  rule: PickRule;
  /** linha dinâmica escolhida (apenas "Gols Dinâmico"): Over 2.5, Over 1.5, Over 0.5 HT, Under 3.5 */
  subType?: string;
  /** preenchido na conferência pós-jogo */
  status?: "green" | "red" | "void";
  /** justificativa textual do resultado real (auditoria) */
  evidence?: string;
}

export interface AutoTicketContext {
  homeName: string;
  awayName: string;
  /** prob. de Mais de 9.5 escanteios */
  cornersOver95?: number;
  /** prob. de Mais de 4.5 cartões */
  cardsOver45?: number;
}

export interface MatchResult {
  goalsH: number;
  goalsA: number;
  htH?: number | null;
  htA?: number | null;
  corners?: number | null;
  cards?: number | null;
  /** lado que marcou o primeiro gol (quando a API fornece eventos) */
  firstGoal?: "H" | "A" | "none" | null;
  /** minuto do primeiro gol */
  firstGoalMinute?: number | null;
  homeName?: string;
  awayName?: string;
}

export const AUTO_MARKETS = [
  "Resultado 1X2",
  "Gols Dinâmico",
  "Ambas Marcam",
  "Escanteios",
  "Intervalo / Final",
  "Cartões",
  "Evolução do Jogo",
  "Margem de Vitória",
  "Placar Múltiplo Exato",
  "Placar Exato Seco",
  "Aposta Montada",
] as const;

/** Probabilidade mínima (Poisson) para emitir Placar Exato Seco. */
export const MIN_EXACT_PROB = 0.16;

/**
 * Teto realista de cada mercado crítico: a maior probabilidade que ele
 * costuma alcançar. A confiança do modelo é `prob / teto` e precisa
 * superar o piso (65% nos mercados sãos; 80% nos de baixa taxa histórica —
 * ver `ticket-rules.ts`) para o palpite ser publicado.
 */
export const CRITICAL_CEILING: Record<string, number> = {
  "Margem de Vitória": 0.58,
  "Intervalo / Final": 0.46,
  "Placar Múltiplo Exato": 0.62,
  "Placar Exato Seco": 0.26,
};
/** Odd mínima recomendada para compensar a taxa histórica de acerto do Seco. */
export const MIN_EXACT_ODD = 6.0;

/** Placar(es) exato(s) mais provável(is) da matriz de Poisson (maior probabilidade primeiro). */
export function topExactScores(m: number[][] | undefined): { i: number; j: number; p: number }[] {
  if (!m || !m.length) return [];
  const out: { i: number; j: number; p: number }[] = [];
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j] || 0;
      if (p > 0) out.push({ i, j, p });
    }
  }
  return out.sort((a, b) => b.p - a.p);
}

const odd = (p: number) => (p > 0.001 ? Math.round((1 / p) * 100) / 100 : 0);
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

/* ============================================================
 * LEITURA MACRO DA PARTIDA (uma única linha de raciocínio)
 * Todos os 11 mercados são desdobrados a partir deste cenário,
 * de modo que nenhum palpite contradiga o outro.
 * ========================================================== */
export type GameFlow = "travado" | "equilibrado" | "franco";
export type GameSide = "H" | "A" | "none";

export interface MatchNarrative {
  flow: GameFlow;
  dominant: GameSide;
  /** lado de gols coerente com o cenário */
  goalsSide: "over" | "under";
  /** ambas marcam coerente com o cenário */
  btts: boolean;
  /** escanteios coerentes com o cenário */
  cornersSide: "over" | "under";
  /** cartões coerentes com o cenário */
  cardsSide: "over" | "under";
  /** resultado 1X2 coerente com o cenário */
  result: "H" | "D" | "A";
  expectedGoals: number;
  headline: string;
}

export function readMatchNarrative(pred: OwnPrediction, ctx: AutoTicketContext): MatchNarrative {
  const lh = pred.lambdaHome;
  const la = pred.lambdaAway;
  const eg = lh + la;
  const diff = lh - la;

  const flow: GameFlow = eg < 2.35 ? "travado" : eg > 3.0 ? "franco" : "equilibrado";

  let dominant: GameSide = "none";
  if (pred.pHome >= pred.pAway && pred.pHome >= 0.45 && diff >= 0.45) dominant = "H";
  else if (pred.pAway > pred.pHome && pred.pAway >= 0.45 && -diff >= 0.45) dominant = "A";

  // Resultado segue a dominância; sem dominância clara, o mais provável entre 1/X/2
  let result: "H" | "D" | "A";
  if (dominant === "H") result = "H";
  else if (dominant === "A") result = "A";
  else {
    const opts = [
      { k: "H" as const, p: pred.pHome },
      { k: "D" as const, p: pred.pDraw },
      { k: "A" as const, p: pred.pAway },
    ].sort((a, b) => b.p - a.p);
    result = opts[0].k;
  }

  // Gols: cenário manda; no equilíbrio, a probabilidade decide
  const goalsSide: "over" | "under" =
    flow === "travado" ? "under" : flow === "franco" ? "over" : pred.pOver15 >= 0.5 ? "over" : "under";

  // Ambas marcam nunca pode contradizer o volume de gols nem um domínio forte
  let btts: boolean;
  if (goalsSide === "under") btts = false;
  else if (flow === "franco" && Math.abs(diff) < 1.1) btts = true;
  else btts = pred.pBTTS >= 0.5 && Math.min(lh, la) >= 0.85;

  // Escanteios acompanham a intensidade / pressão do favorito
  const pCorners = ctx.cornersOver95 ?? 0.5;
  const cornersSide: "over" | "under" =
    flow === "franco" || (dominant !== "none" && flow !== "travado")
      ? "over"
      : flow === "travado"
        ? "under"
        : pCorners >= 0.5
          ? "over"
          : "under";

  // Cartões: jogo franco/equilibrado tende a mais faltas; jogo travado com favorito claro, menos
  const pCards = ctx.cardsOver45 ?? 0.5;
  const cardsSide: "over" | "under" =
    flow === "travado" && dominant !== "none" ? "under" : flow === "franco" ? "over" : pCards >= 0.5 ? "over" : "under";

  const who = dominant === "H" ? ctx.homeName : dominant === "A" ? ctx.awayName : null;
  const headline =
    flow === "travado"
      ? who
        ? `Jogo travado com controle do ${who} — poucos gols`
        : "Jogo travado e equilibrado — poucos gols"
      : flow === "franco"
        ? who
          ? `Jogo franco com pressão do ${who} — tendência de gols`
          : "Jogo franco e aberto — tendência de gols"
        : who
          ? `Jogo morno com leve favoritismo do ${who}`
          : "Jogo equilibrado, sem favorito definido";

  return { flow, dominant, goalsSide, btts, cornersSide, cardsSide, result, expectedGoals: eg, headline };
}

/* ============================================================
 * MERCADO "GOLS DINÂMICO" — linha adaptativa documentada
 *
 * Critérios de decisão (nesta ordem de precedência):
 *   1. xG total > 2.8            -> "Over 2.5"     (Mais de 2.5 gols)
 *   2. xG total entre 1.8 e 2.7  -> "Over 1.5"     (Mais de 1.5 gols)
 *   3. xG do 1º tempo > 1.2      -> "Over 0.5 HT"  (Mais de 0.5 gol no 1º tempo)
 *   4. xG total < 1.7            -> "Under 3.5"    (Menos de 3.5 gols)
 *   5. fora das faixas acima     -> "Over 1.5"     (linha neutra de segurança)
 *
 * xG total = lambdaHome + lambdaAway (Poisson/Dixon-Coles).
 * xG do 1º tempo = xG total * HT_SHARE (45% dos gols).
 * O rótulo escolhido é gravado como `market_sub_type` em `ai_predictions`
 * e em `auto_tickets.meta.goalsSubType`.
 * ========================================================== */
export type GoalsSubType = "Over 2.5" | "Over 1.5" | "Over 0.5 HT" | "Under 3.5";

export interface DynamicGoalsChoice {
  subType: GoalsSubType;
  label: string;
  prob: number;
  rule: PickRule;
}

/** Fatia dos gols atribuída ao 1º tempo (mesma constante do motor Poisson). */
export const HT_GOALS_SHARE = 0.45;

export function pickDynamicGoals(pred: OwnPrediction): DynamicGoalsChoice {
  const xg = pred.lambdaHome + pred.lambdaAway;
  const xgHt = xg * HT_GOALS_SHARE;

  const over15: DynamicGoalsChoice = {
    subType: "Over 1.5",
    label: "Mais de 1.5 gols",
    prob: pred.pOver15,
    rule: { t: "totals", line: 1.5, side: "over" },
  };

  if (xg > 2.8) {
    return {
      subType: "Over 2.5",
      label: "Mais de 2.5 gols",
      prob: pred.pOver25,
      rule: { t: "totals", line: 2.5, side: "over" },
    };
  }
  if (xg >= 1.8 && xg <= 2.7) return over15;
  if (xgHt > 1.2) {
    return {
      subType: "Over 0.5 HT",
      label: "Mais de 0.5 gol no 1º tempo",
      prob: 1 - Math.exp(-xgHt),
      rule: { t: "ht_totals", line: 0.5, side: "over" },
    };
  }
  if (xg < 1.7) {
    return {
      subType: "Under 3.5",
      label: "Menos de 3.5 gols",
      prob: 1 - pred.pOver35,
      rule: { t: "totals", line: 3.5, side: "under" },
    };
  }
  return over15;
}

/** aplica o lado escolhido pelo cenário, devolvendo a prob real daquele lado */
function sided(pOver: number, side: "over" | "under", overLabel: string, underLabel: string) {
  return side === "over" ? { p: pOver, label: overLabel } : { p: 1 - pOver, label: underLabel };
}


export function buildAutoPicks(pred: OwnPrediction, ctx: AutoTicketContext): AutoPick[] {
  const m = pred.matrix;
  if (!pred.ready || !m?.length) return [];
  const { homeName, awayName } = ctx;
  const nar = readMatchNarrative(pred, ctx);
  const picks: AutoPick[] = [];
  const push = (market: string, selection: string, p: number, rule: PickRule) =>
    picks.push({ market, selection, prob: p, odd: odd(p), rule });

  // 1) Resultado 1X2 — definido pela leitura macro
  {
    const p = nar.result === "H" ? pred.pHome : nar.result === "D" ? pred.pDraw : pred.pAway;
    const label = nar.result === "H" ? homeName : nar.result === "D" ? "Empate" : awayName;
    push("Resultado 1X2", label, p, { t: "1x2", pick: nar.result });
  }

  // 2) Gols dinâmico — linha adaptativa (ver bloco de documentação acima)
  {
    let choice = pickDynamicGoals(pred);
    // coerência com o cenário: jogo travado não publica linha de Over alta
    if (nar.goalsSide === "under" && choice.subType !== "Under 3.5") {
      choice = {
        subType: "Under 3.5",
        label: "Menos de 3.5 gols",
        prob: 1 - pred.pOver35,
        rule: { t: "totals", line: 3.5, side: "under" },
      };
    }
    picks.push({
      market: "Gols Dinâmico",
      selection: choice.label,
      prob: choice.prob,
      odd: odd(choice.prob),
      rule: choice.rule,
      subType: choice.subType,
    });
  }

  // 3) Ambas marcam — coerente com gols e domínio
  {
    const p = nar.btts ? pred.pBTTS : 1 - pred.pBTTS;
    push("Ambas Marcam", nar.btts ? "Ambas marcam · Sim" : "Ambas marcam · Não", p, { t: "btts", yes: nar.btts });
  }

  // 4) Escanteios — coerente com intensidade/pressão
  if (ctx.cornersOver95 != null) {
    const b = sided(ctx.cornersOver95, nar.cornersSide, "Mais de 9.5 escanteios", "Menos de 9.5 escanteios");
    push("Escanteios", b.label, b.p, { t: "corners", line: 9.5, side: nar.cornersSide });
  }

  // 5) Intervalo / Final — o final tem de bater com o 1X2 do cenário
  {
    const wantFt = nar.result === "H" ? "1" : nar.result === "D" ? "X" : "2";
    const pool = pred.htFt.filter((h) => h.label.split("/")[1] === wantFt);
    const best = pred.htFt.slice().sort((a, b) => b.p - a.p)[0];
    const constrained = (pool.length ? pool : pred.htFt).slice().sort((a, b) => b.p - a.p)[0];
    // se a coerência empurra para uma linha improvável, fica com a de maior probabilidade real
    const top = constrained && constrained.p >= 0.22 ? constrained : (best ?? constrained);
    if (top) {
      const [ht, ft] = top.label.split("/") as ["1" | "X" | "2", "1" | "X" | "2"];
      push("Intervalo / Final", `HT ${ht} · FT ${ft}`, top.p, { t: "htft", ht, ft });
    }
  }

  // 6) Cartões — coerente com o ritmo do jogo
  if (ctx.cardsOver45 != null) {
    const b = sided(ctx.cardsOver45, nar.cardsSide, "Mais de 4.5 cartões", "Menos de 4.5 cartões");
    push("Cartões", b.label, b.p, { t: "cards", line: 4.5, side: nar.cardsSide });
  }

  // agregados sobre a matriz
  const lh = pred.lambdaHome;
  const la = pred.lambdaAway;
  const tot = lh + la;
  const pFirstHome = tot > 0 ? lh / tot : 0.5;

  const evo: { first: "H" | "A" | "none"; res: "H" | "D" | "A"; p: number }[] = [
    { first: "H", res: "H", p: 0 }, { first: "H", res: "D", p: 0 }, { first: "H", res: "A", p: 0 },
    { first: "A", res: "A", p: 0 }, { first: "A", res: "D", p: 0 }, { first: "A", res: "H", p: 0 },
  ];
  let noGoal = 0;
  const margins: Record<string, number> = { H1: 0, H2: 0, H3: 0, D: 0, A1: 0, A2: 0, A3: 0 };
  const exact: { i: number; j: number; p: number }[] = [];

  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (!p) continue;
      if (i === 0 && j === 0) noGoal += p;
      const ph = i === 0 && j === 0 ? 0 : j === 0 ? 1 : i === 0 ? 0 : pFirstHome;
      const pa = i === 0 && j === 0 ? 0 : 1 - ph;
      const res: "H" | "D" | "A" = i > j ? "H" : i === j ? "D" : "A";
      for (const e of evo) {
        if (e.res !== res) continue;
        if (e.first === "H") e.p += p * ph;
        else e.p += p * pa;
      }
      const d = i - j;
      if (d === 0) margins.D += p;
      else if (d === 1) margins.H1 += p;
      else if (d === 2) margins.H2 += p;
      else if (d >= 3) margins.H3 += p;
      else if (d === -1) margins.A1 += p;
      else if (d === -2) margins.A2 += p;
      else margins.A3 += p;
      exact.push({ i, j, p });
    }
  }



  // 7) Evolução do jogo — mesmo resultado final do 1X2
  {
    const all = [...evo, { first: "none" as const, res: "D" as const, p: noGoal }];
    let pool = all.filter((e) => e.res === nar.result);
    // com placar fechado sem gols previsto, "sem gol" só entra em cenário travado + empate
    if (nar.result === "D" && nar.flow === "travado") pool = all.filter((e) => e.res === "D");
    else pool = pool.filter((e) => e.first !== "none");
    // quem marca primeiro deve ser o lado dominante, quando existe
    if (nar.dominant !== "none") {
      const dom = pool.filter((e) => e.first === nar.dominant);
      if (dom.length) pool = dom;
    }
    const top = (pool.length ? pool : all).slice().sort((a, b) => b.p - a.p)[0];
    const name = (k: "H" | "A") => (k === "H" ? homeName : awayName);
    const label =
      top.first === "none"
        ? "Sem gol (0 - 0)"
        : `${name(top.first)} marcar primeiro e ${top.res === top.first ? "ganhar" : top.res === "D" ? "empatar" : "perder"}`;
    push("Evolução do Jogo", label, top.p, { t: "evolution", first: top.first, res: top.res });
  }

  // 8) Margem de vitória — em jogos equilibrados, "por 1 gol ou empate" (dupla cobertura)
  {
    const all = [
      { s: `${homeName} por 1 gol`, p: margins.H1, side: "H", by: 1, min: 1 },
      { s: `${homeName} por 2 gols`, p: margins.H2, side: "H", by: 2, min: 2 },
      { s: `${homeName} por 3+ gols`, p: margins.H3, side: "H", by: 3, min: 3 },
      { s: "Empate", p: margins.D, side: "D", by: 0, min: 0 },
      { s: `${awayName} por 1 gol`, p: margins.A1, side: "A", by: 1, min: 1 },
      { s: `${awayName} por 2 gols`, p: margins.A2, side: "A", by: 2, min: 2 },
      { s: `${awayName} por 3+ gols`, p: margins.A3, side: "A", by: 3, min: 3 },
    ];
    // jogo equilibrado (sem dominância clara) → margem curta com empate embutido
    const balanced = nar.dominant === "none";
    const favSide: "H" | "A" =
      nar.result === "A" ? "A" : nar.result === "H" ? "H" : margins.H1 >= margins.A1 ? "H" : "A";
    const pShort = (favSide === "H" ? margins.H1 : margins.A1) + margins.D;
    if (balanced && pShort >= 0.45) {
      push(
        "Margem de Vitória",
        `${favSide === "H" ? homeName : awayName} por 1 gol ou Empate`,
        pShort,
        { t: "margin_or_draw", side: favSide },
      );
    } else {
      let pool = all.filter((x) => x.side === nar.result);
      // jogo de poucos gols não comporta margem larga
      if (nar.goalsSide === "under") pool = pool.filter((x) => x.min <= 1);
      const bestAll = all.slice().sort((a, b) => b.p - a.p)[0];
      const constrained = (pool.length ? pool : all).slice().sort((a, b) => b.p - a.p)[0];
      const top = constrained.p >= 0.22 ? constrained : bestAll;
      push("Margem de Vitória", top.s, top.p, {
        t: "margin",
        side: top.side as "H" | "D" | "A",
        by: top.by,
      });
    }
  }

  /* Clusters de placar por frequência histórica + trava de correlação com
     o mercado "Gols Dinâmico" (Over/Under 2.5). */
  const SCORE_CLUSTERS: Record<"H" | "D" | "A", [number, number][]> = {
    H: [[1, 0], [2, 0], [2, 1]],
    D: [[1, 1], [0, 0]],
    A: [[0, 1], [1, 2]],
  };
  // placares "típicos" — fora dessa lista só com jogo de gols muito alto (> 3.8 xG)
  const TYPICAL: [number, number][] = [
    [1, 0], [2, 0], [2, 1], [1, 1], [0, 0], [0, 1], [1, 2], [2, 2],
  ];
  const projectsOver25 = pred.pOver25 >= 0.5;
  const LOCK: [number, number][] = projectsOver25
    ? [[2, 1], [1, 2], [3, 1], [2, 2]]
    : [[1, 0], [0, 1], [0, 0], [1, 1]];
  const highXg = lh + la > 3.8;
  const has = (list: [number, number][], i: number, j: number) => list.some(([a, b]) => a === i && b === j);
  const resOf = (i: number, j: number) => (i > j ? "H" : i === j ? "D" : "A");

  // confluência obrigatória com "Ambas Marcam" e "Gols Dinâmico"/Over 2.5
  const bttsNo = !nar.btts;
  const confluent = ([i, j]: [number, number]) => {
    if (bttsNo && i > 0 && j > 0) return false; // ambas marcam = Não → sem placares mútuos
    if (projectsOver25 && i + j <= 2) return false; // Over 2.5 → sem placares "under"
    return true;
  };

  const allowedScores = (() => {
    let pool = LOCK.filter(([i, j]) => has(SCORE_CLUSTERS[nar.result], i, j));
    if (!pool.length) pool = LOCK.filter(([i, j]) => resOf(i, j) === nar.result);
    if (!pool.length) pool = LOCK;
    if (!highXg) {
      const t = pool.filter(([i, j]) => has(TYPICAL, i, j));
      if (t.length) pool = t;
    }
    const c = pool.filter(confluent);
    return c.length ? c : pool;
  })();

  const rankedAllowed = exact
    .filter((e) => has(allowedScores, e.i, e.j))
    .sort((a, b) => b.p - a.p);

  // 9) Placar múltiplo exato — cluster de proteção com os 3 placares de maior densidade
  {
    let base = rankedAllowed.slice(0, 3);
    if (base.length < 3) {
      const extra = exact
        .filter((e) => !has(allowedScores, e.i, e.j))
        .filter((e) => confluent([e.i, e.j]))
        .filter((e) => has(SCORE_CLUSTERS[nar.result], e.i, e.j) || has(TYPICAL, e.i, e.j) || highXg)
        .sort((a, b) => b.p - a.p);
      base = [...base, ...extra].slice(0, 3);
    }
    if (base.length) {
      const p = base.reduce((s2, e) => s2 + e.p, 0);
      push(
        "Placar Múltiplo Exato",
        base.map((e) => `${e.i}-${e.j}`).join(", "),
        p,
        { t: "scores", list: base.map((e) => [e.i, e.j] as [number, number]) },
      );
    }
  }

  // 10) Placar exato seco — só com confluência e probabilidade Poisson >= 14%
  {
    const top = rankedAllowed[0];
    if (top && top.p >= MIN_EXACT_PROB) {
      push("Placar Exato Seco", `${top.i} - ${top.j}`, top.p, { t: "scores", list: [[top.i, top.j]] });
    }
  }



  // 11) Aposta montada — no máximo 2 pernas conservadoras e correlacionadas
  {
    const CONSERVATIVE = ["Gols Dinâmico", "Ambas Marcam", "Escanteios", "Cartões"];
    const safe = picks
      .filter((x) => CONSERVATIVE.includes(x.market) && x.prob >= 0.62)
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 2);
    if (safe.length === 2) {
      const p = safe[0].prob * safe[1].prob;
      // combinação só entra se mantiver probabilidade real de acerto
      if (p >= 0.45) {
        push("Aposta Montada", safe.map((x) => x.selection).join(" + "), p, {
          t: "combo",
          legs: safe.map((x) => x.rule),
        });
      }
    }
  }


  /* Filtro de confiança dos mercados críticos.
     A confiança é medida contra o teto realista de cada mercado (a maior
     probabilidade que ele costuma atingir). Só publica quando a confiança
     do modelo for superior a 65%. */
  return picks.filter((p) => {
    const ceiling = CRITICAL_CEILING[p.market];
    if (!ceiling) return true;
    return p.prob / ceiling > requiredConfidence(p.market);
  });
}


// ---------------- Conferência pós-jogo ----------------

function gradeRule(rule: PickRule, r: MatchResult): boolean | null {
  const total = r.goalsH + r.goalsA;
  switch (rule.t) {
    case "1x2": {
      const res = r.goalsH > r.goalsA ? "H" : r.goalsH === r.goalsA ? "D" : "A";
      return rule.pick === res;
    }
    case "totals":
      return rule.side === "over" ? total > rule.line : total < rule.line;
    case "ht_totals": {
      if (r.htH == null || r.htA == null) return null;
      const htTotal = r.htH + r.htA;
      return rule.side === "over" ? htTotal > rule.line : htTotal < rule.line;
    }
    case "btts":
      return (r.goalsH > 0 && r.goalsA > 0) === rule.yes;
    case "corners":
      if (r.corners == null) return null;
      return rule.side === "over" ? r.corners > rule.line : r.corners < rule.line;
    case "cards":
      if (r.cards == null) return null;
      return rule.side === "over" ? r.cards > rule.line : r.cards < rule.line;
    case "htft": {
      if (r.htH == null || r.htA == null) return null;
      const ht = r.htH > r.htA ? "1" : r.htH === r.htA ? "X" : "2";
      const ft = r.goalsH > r.goalsA ? "1" : r.goalsH === r.goalsA ? "X" : "2";
      return rule.ht === ht && rule.ft === ft;
    }
    case "scores":
      return rule.list.some(([i, j]) => i === r.goalsH && j === r.goalsA);
    case "margin": {
      const d = r.goalsH - r.goalsA;
      if (rule.side === "D") return d === 0;
      if (rule.side === "H") return rule.by >= 3 ? d >= 3 : d === rule.by;
      return rule.by >= 3 ? -d >= 3 : -d === rule.by;
    }
    case "margin_or_draw": {
      const d = r.goalsH - r.goalsA;
      return rule.side === "H" ? d === 0 || d === 1 : d === 0 || d === -1;
    }
    case "evolution": {
      // só é conferível com segurança no caso "sem gol"
      if (rule.first === "none") return total === 0;
      return null;
    }
    case "combo": {
      const results = rule.legs.map((l) => gradeRule(l, r));
      if (results.some((x) => x === false)) return false;
      if (results.some((x) => x === null)) return null;
      return true;
    }
    default:
      return null;
  }
}

/** Texto de auditoria: o que realmente aconteceu no mercado apostado. */
export function pickEvidence(rule: PickRule, r: MatchResult): string {
  const total = r.goalsH + r.goalsA;
  const H = r.homeName ?? "Casa";
  const A = r.awayName ?? "Fora";
  const winner = r.goalsH > r.goalsA ? H : r.goalsH < r.goalsA ? A : "Empate";
  const ht = r.htH != null && r.htA != null ? `${r.htH}-${r.htA}` : "—";
  switch (rule.t) {
    case "1x2":
      return `Resultado final: ${winner} (${r.goalsH} - ${r.goalsA})`;
    case "totals":
      return `Total apurado: ${total} ${total === 1 ? "gol" : "gols"} (${r.goalsH} - ${r.goalsA})`;
    case "ht_totals":
      return r.htH == null || r.htA == null
        ? "Placar do 1º tempo não fornecido pela API para esta liga"
        : `1º tempo apurado: ${r.htH + r.htA} ${r.htH + r.htA === 1 ? "gol" : "gols"} (${r.htH} - ${r.htA})`;
    case "btts":
      return `Ambas marcaram: ${r.goalsH > 0 && r.goalsA > 0 ? "Sim" : "Não"} (${r.goalsH} - ${r.goalsA})`;
    case "corners":
      return r.corners == null
        ? "Scout não fornecido pela API para esta liga"
        : `Escanteios apurados: ${r.corners}`;
    case "cards":
      return r.cards == null
        ? "Scout não fornecido pela API para esta liga"
        : `Cartões apurados: ${r.cards}`;
    case "htft":
      return `Intervalo: ${ht} | Final: ${r.goalsH}-${r.goalsA}`;
    case "scores":
    case "margin":
    case "margin_or_draw":
      return `Placar oficial: ${r.goalsH} - ${r.goalsA} (HT ${ht})`;
    case "evolution":
      if (r.firstGoal === "none" || total === 0) return "Primeiro gol: não houve gols";
      if (r.firstGoal === "H" || r.firstGoal === "A") {
        const who = r.firstGoal === "H" ? H : A;
        return `Primeiro gol: ${who}${r.firstGoalMinute ? ` aos ${r.firstGoalMinute}'` : ""} | Final ${r.goalsH}-${r.goalsA}`;
      }
      return "Ordem dos gols não fornecida pela API para esta liga";
    case "combo":
      return rule.legs.map((l) => pickEvidence(l, r)).join(" | ");
    default:
      return `Placar oficial: ${r.goalsH} - ${r.goalsA}`;
  }
}

/** Resumo textual geral do jogo conferido. */
export function resultReason(r: MatchResult): string {
  const ht = r.htH != null && r.htA != null ? `${r.htH}x${r.htA}` : "—";
  return `Real: ${r.goalsH}x${r.goalsA} (HT ${ht}) | Cantos: ${r.corners ?? "Não disponível"} | Cartões: ${r.cards ?? "Não disponível"}`;
}

export function gradeAutoPicks(picks: AutoPick[], r: MatchResult): {
  picks: AutoPick[];
  greens: number;
  reds: number;
  accuracy: number;
} {
  let greens = 0;
  let reds = 0;
  const graded = picks.map((p) => {
    const ok = gradeRule(p.rule, r);
    const status: AutoPick["status"] = ok == null ? "void" : ok ? "green" : "red";
    if (status === "green") greens++;
    if (status === "red") reds++;
    return { ...p, status, evidence: pickEvidence(p.rule, r) };
  });
  const done = greens + reds;
  return { picks: graded, greens, reds, accuracy: done ? greens / done : 0 };
}

export const fmtPct = pct;
