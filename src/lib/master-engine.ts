/**
 * PIPELINE MASTER DE ANÁLISE UNIFICADA
 *
 * Encadeia a previsão em UMA linha de raciocínio coerente, eliminando
 * contradições lógicas entre os mercados:
 *
 *   1. Tendência 1X2 (P_Casa, P_Empate, P_Vis) → vencedor.
 *   2. Placar exato FILTRADO pelo vencedor (só placares consistentes com o 1X2).
 *   3. Linha de Gols alinhada ao placar exato (Over/Under).
 *   4. HT/FT coerente com a tendência (1/1 quando CASA dominante ≥ 50%).
 *   5. Ambas Marcam coerente com o placar exato (2x1 → SIM; 2x0/1x0 → NÃO).
 *
 * Pure / client-safe.
 */
import type { OwnPrediction, ScoreProb } from "./own-prediction";

export type TrendWinner = "home" | "draw" | "away";

export const WINNER_LABEL: Record<TrendWinner, string> = {
  home: "Casa",
  draw: "Empate",
  away: "Visitante",
};

/** Mapeia o vencedor para o símbolo de FT usado nos combos HT/FT. */
export const WINNER_FT: Record<TrendWinner, "1" | "X" | "2"> = {
  home: "1",
  draw: "X",
  away: "2",
};

export interface MasterExactScore {
  h: number;
  a: number;
  label: string;
  p: number;
}

export interface MasterGoals {
  /** Linha imposta pelo placar exato (soma ≥ 2 → Over 1.5; soma ≤ 1 → Under 1.5). */
  line: "Over 1.5" | "Under 1.5";
  side: "over" | "under";
  /** Probabilidade real do lado escolhido. */
  p: number;
  label: string;
  /** Over/Under como o mercado de livros. */
  selection: string;
  over15: number;
  under15: number;
  /** true quando o lado do modelo já batia com o placar exato. */
  consistent: boolean;
}

export interface MasterHtFt {
  /** Combo principal (forçado para 1/1 quando a casa é dominante ≥ 50%). */
  primary: string;
  /** Combos coerentes com o vencedor do 1X2 (FT bate com a tendência). */
  list: ScoreProb[];
  /** true quando a lista original já era coerente com a tendência. */
  consistent: boolean;
}

export interface MasterBtts {
  pick: "SIM" | "NÃO";
  /** Probabilidade real da aposta (Sim → pBTTS; Não → pNoBTTS). */
  p: number;
  selection: string;
  /** true quando o pick probabilístico do modelo já batia com o placar exato. */
  consistent: boolean;
}

export interface MasterPrediction {
  ready: boolean;
  trend: {
    winner: TrendWinner;
    label: string;
    home: number;
    draw: number;
    away: number;
    /** casa dominante (pHome ≥ 50% e maior fatia). */
    dominantHome: boolean;
  };
  /** Placar exato filtrado pela tendência 1X2. */
  exactScore: MasterExactScore;
  /** Top placares DENTRO do bucket do vencedor (coerentes com o 1X2). */
  exactScores: MasterExactScore[];
  goals: MasterGoals;
  htFt: MasterHtFt;
  btts: MasterBtts;
  /** Incoerências detectadas no modelo bruto e corrigidas no mestre. */
  problems: string[];
  /** true quando não havia nenhuma contradição a corrigir. */
  valid: boolean;
}

const EMPTY: MasterPrediction = {
  ready: false,
  trend: { winner: "draw", label: "Empate", home: 0, draw: 0, away: 0, dominantHome: false },
  exactScore: { h: 0, a: 0, label: "0-0", p: 0 },
  exactScores: [],
  goals: { line: "Under 1.5", side: "under", p: 0, label: "Menos de 1.5 gols", selection: "Menos de 1.5 gols", over15: 0, under15: 0, consistent: false },
  htFt: { primary: "X/X", list: [], consistent: false },
  btts: { pick: "NÃO", p: 0, selection: "Ambas marcam · Não", consistent: false },
  problems: [],
  valid: false,
};

/**
 * Etapa 2 — placa exato coerente com o vencedor do 1X2:
 * varre a matriz de Poisson e mantém apenas os placares do bucket do vencedor.
 */
function exactScoresFiltered(pred: OwnPrediction, winner: TrendWinner): MasterExactScore[] {
  const out: MasterExactScore[] = [];
  for (let h = 0; h < pred.matrix.length; h++) {
    const row = pred.matrix[h];
    if (!row) continue;
    for (let a = 0; a < row.length; a++) {
      const p = row[a] || 0;
      if (p <= 0) continue;
      const res: TrendWinner = h > a ? "home" : h === a ? "draw" : "away";
      if (res !== winner) continue;
      out.push({ h, a, label: `${h}-${a}`, p });
    }
  }
  return out.sort((x, y) => y.p - x.p);
}

/**
 * Etapa 4 — HT/FT coerente com a tendência.
 * Só combos onde o FT bate com o vencedor; quando a casa é dominante
 * (pHome ≥ 50%), o 1/1 é escolhido como combo principal.
 */
function htFtCoherent(pred: OwnPrediction, winner: TrendWinner, dominantHome: boolean): MasterHtFt {
  const wantFt = WINNER_FT[winner];
  const coherent = pred.htFt.filter((h) => h.label.split("/")[1] === wantFt);
  const list = coherent.length ? coherent.slice(0, 4) : pred.htFt.slice(0, 4);
  const consistent = coherent.length > 0;

  let primary: string;
  if (dominantHome) {
    primary = "1/1";
  } else {
    primary = coherent[0]?.label ?? list[0]?.label ?? "X/X";
  }
  return { primary, list, consistent };
}

/**
 * Constrói o payload mestre validado a partir da previsão bruta (Poisson).
 * Todas as etapas são encadeadas na mesma linha de raciocínio.
 */
export function buildMasterPrediction(pred: OwnPrediction): MasterPrediction {
  if (!pred.ready || !pred.matrix?.length) return EMPTY;
  const problems: string[] = [];

  // ---- Etapa 1: tendência 1X2 ----
  const winner: TrendWinner =
    pred.pHome >= pred.pDraw && pred.pHome >= pred.pAway
      ? "home"
      : pred.pDraw >= pred.pHome && pred.pDraw >= pred.pAway
        ? "draw"
        : "away";
  const dominantHome = winner === "home" && pred.pHome >= 0.5;

  // ---- Etapa 2: placar exato filtrado pelo vencedor ----
  const exactScores = exactScoresFiltered(pred, winner);
  if (exactScores.length === 0) {
    const all = exactScoresFiltered(pred, winner).length ? exactScores : [];
    const fallback = winner === "home" ? { h: 1, a: 0, label: "1-0" as const, p: pred.matrix[1]?.[0] ?? 0 } : winner === "away" ? { h: 0, a: 1, label: "0-1", p: pred.matrix[0]?.[1] ?? 0 } : { h: 0, a: 0, label: "0-0", p: pred.matrix[0]?.[0] ?? 0 };
    problems.push(`Nenhum placar exato coerente com ${WINNER_LABEL[winner]}; usando ${fallback.label}.`);
    void all;
    const fs: MasterExactScore = { h: fallback.h, a: fallback.a, label: fallback.label, p: fallback.p };
    const exactScore = fs;
    const goals = buildGoals(pred, exactScore, problems);
    const htFt = htFtCoherent(pred, winner, dominantHome);
    const btts = buildBtts(pred, exactScore, problems);
    return {
      ready: true,
      trend: { winner, label: WINNER_LABEL[winner], home: pred.pHome, draw: pred.pDraw, away: pred.pAway, dominantHome },
      exactScore,
      exactScores: [exactScore],
      goals,
      htFt,
      btts,
      problems,
      valid: problems.length === 0,
    };
  }

  const exactScore = exactScores[0];
  // Problema clássico: o placar mais provável bruto contradiz o 1X2.
  const rawBest = rawTopScore(pred);
  if (rawBest && rawBest.label !== exactScore.label) {
    problems.push(
      `Placar bruto mais provável (${rawBest.label}) contradiz a tendência ${WINNER_LABEL[winner]}; usando ${exactScore.label}.`,
    );
  }

  // ---- Etapa 3: linha de gols ----
  const goals = buildGoals(pred, exactScore, problems);

  // ---- Etapa 4: HT/FT ----
  const htFt = htFtCoherent(pred, winner, dominantHome);
  if (!htFt.consistent) {
    problems.push(`Combos HT/FT do modelo não batem com a tendência ${WINNER_LABEL[winner]}; usando ${htFt.primary}.`);
  }

  // ---- Etapa 5: ambas marcam ----
  const btts = buildBtts(pred, exactScore, problems);

  return {
    ready: true,
    trend: { winner, label: WINNER_LABEL[winner], home: pred.pHome, draw: pred.pDraw, away: pred.pAway, dominantHome },
    exactScore,
    exactScores,
    goals,
    htFt,
    btts,
    problems,
    valid: problems.length === 0,
  };
}

function rawTopScore(pred: OwnPrediction): MasterExactScore | null {
  let best: MasterExactScore | null = null;
  for (let h = 0; h < pred.matrix.length; h++) {
    const row = pred.matrix[h];
    if (!row) continue;
    for (let a = 0; a < row.length; a++) {
      const p = row[a] || 0;
      if (p > 0 && (!best || p > best.p)) best = { h, a, label: `${h}-${a}`, p };
    }
  }
  return best;
}

function buildGoals(pred: OwnPrediction, exact: MasterExactScore, problems: string[]): MasterGoals {
  const sum = exact.h + exact.a;
  const imposed: "over" | "under" = sum >= 2 ? "over" : "under";
  const raw: "over" | "under" = pred.pOver15 >= 0.5 ? "over" : "under";
  if (raw !== imposed) {
    problems.push(
      `Linha de gols do modelo (${raw === "over" ? "Over 1.5" : "Under 1.5"}) contradiz o placar ${exact.label}; alinhado para ${imposed === "over" ? "Over 1.5" : "Under 1.5"}.`,
    );
  }
  const line: MasterGoals["line"] = imposed === "over" ? "Over 1.5" : "Under 1.5";
  return {
    line,
    side: imposed,
    p: imposed === "over" ? pred.pOver15 : pred.pUnder15,
    label: imposed === "over" ? "Mais de 1.5 gols" : "Menos de 1.5 gols",
    selection: imposed === "over" ? "Mais de 1.5 gols" : "Menos de 1.5 gols",
    over15: pred.pOver15,
    under15: pred.pUnder15,
    consistent: raw === imposed,
  };
}

function buildBtts(pred: OwnPrediction, exact: MasterExactScore, problems: string[]): MasterBtts {
  const imposed: "SIM" | "NÃO" = exact.h > 0 && exact.a > 0 ? "SIM" : "NÃO";
  const raw: "SIM" | "NÃO" = pred.pBTTS >= 0.5 ? "SIM" : "NÃO";
  if (raw !== imposed) {
    problems.push(
      `Ambas Marcam (${raw === "SIM" ? "Sim" : "Não"}) contradiz o placar ${exact.label}; alinhado para ${imposed}.`,
    );
  }
  return {
    pick: imposed,
    p: imposed === "SIM" ? pred.pBTTS : pred.pNoBTTS,
    selection: imposed === "SIM" ? "Ambas marcam · Sim" : "Ambas marcam · Não",
    consistent: raw === imposed,
  };
}

/* ============================================================
 * VALIDADOR DE COERÊNCIA — aceita um payload genérico de previsão
 * (ex.: payload mestre, picks de auto-ticket, fechamentos Bingão)
 * e devolve: válido? + lista de contradições + payload corrigido.
 * ============================================================ */
export interface PredictionPayload {
  /** Tendência 1X2 — aceita winner (home/draw/away) ou label ("Casa"/...) ou pick ("1"/"X"/"2"). */
  trend?: { winner?: TrendWinner | string; pick?: string; label?: string };
  /** Placar exato previsto. */
  exactScore?: { h?: number; a?: number; label?: string };
  /** Linha de gols. */
  goals?: { line?: string; side?: string; selection?: string };
  /** Ambas marcam. */
  btts?: { pick?: string; selection?: string };
  /** Combo HT/FT (ex.: "1/1"). */
  htFt?: string;
  /** Texto livre (narrativa). */
  narrative?: string;
}

export interface CoherenceResult {
  valid: boolean;
  problems: string[];
  fixed: PredictionPayload;
}

function resolveWinner(trend?: PredictionPayload["trend"]): TrendWinner | null {
  const w = trend?.winner;
  if (w === "home" || w === "H" || w === "1" || w === "Casa") return "home";
  if (w === "away" || w === "A" || w === "2" || w === "Visitante" || w === "Fora") return "away";
  if (w === "draw" || w === "D" || w === "X" || w === "Empate") return "draw";
  const pick = trend?.pick;
  if (pick === "H" || pick === "1") return "home";
  if (pick === "A" || pick === "2") return "away";
  if (pick === "D" || pick === "X") return "draw";
  const label = trend?.label?.toUpperCase().trim();
  if (label === "CASA") return "home";
  if (label === "EMPATE") return "draw";
  if (label === "VISITANTE" || label === "FORA") return "away";
  return null;
}

/** Vencedor implícito no placar exato. */
function scoreWinner(h?: number, a?: number): TrendWinner | null {
  if (h == null || a == null) return null;
  return h > a ? "home" : h === a ? "draw" : "away";
}

/**
 * Regras de coerência:
 *  1. 1X2 ≠ placar exato → inválido.
 *  2. Linha de Gols → texto (ex.: "Foco Under 1.5") → Over vs UNDER → inválido.
 *  3. Placar exato (1x0/2x0/0x1/0x2) + BTTS "Sim" → inválido.
 *  4. Placar exato com gols dos dois lados + BTTS "Não" → inválido.
 *  5. Linha de gols vs soma do placar exato → inválido.
 *  6. HT/FT com FT ≠ tendência → inválido.
 * O payload corrigido (fixed) realinha todas as contradições encontradas.
 */
export function validatePredictionCoherence(payload: PredictionPayload): CoherenceResult {
  const problems: string[] = [];
  const fixed: PredictionPayload = JSON.parse(JSON.stringify(payload)) as PredictionPayload;

  const winner = resolveWinner(fixed.trend);
  const h = fixed.exactScore?.h;
  const a = fixed.exactScore?.a;

  // ---- Regra 1: tendência vs placar exato ----
  const sw = scoreWinner(h, a);
  if (winner && sw && winner !== sw) {
    problems.push(
      `Contradição: 1X2 → ${WINNER_LABEL[winner]}, mas placar exato ${h}-${a} indica ${WINNER_LABEL[sw]}.`,
    );
    // Corrige: recalcula um placar coerente com a tendência (sufixo ex.: 1-0 / 0-0 / 0-1).
    const nh = winner === "home" ? Math.max(h ?? 0, (a ?? 0) + 1) : winner === "away" ? Math.min(h ?? 0, (a ?? 0) - 1) : (a ?? 0);
    const na = winner === "home" ? Math.max(0, (a ?? 0) - (h ?? 0) < (h ?? 0) ? (a ?? 0) : 0) : winner === "away" ? Math.max(0, (a ?? 0)) : (h ?? 0);
    if (winner === "home") {
      const fs = { h: Math.max(1, (a ?? 0) + 1), a: Math.max(0, a ?? 0) };
      fixed.exactScore = { h: fs.h, a: fs.a, label: `${fs.h}-${fs.a}` };
      problems.push(`Placar exato corrigido para ${fixed.exactScore.h}-${fixed.exactScore.a}.`);
    } else if (winner === "away") {
      const fs = { h: Math.max(0, h ?? 0), a: Math.max(1, (h ?? 0) + 1) };
      fixed.exactScore = { h: fs.h, a: fs.a, label: `${fs.h}-${fs.a}` };
      problems.push(`Placar exato corrigido para ${fixed.exactScore.h}-${fixed.exactScore.a}.`);
    } else {
      fixed.exactScore = { h: 1, a: 1, label: "1-1" };
      problems.push(`Placar exato corrigido para 1-1 (empate).`);
    }
    void nh; void na;
  }

  const fh = fixed.exactScore?.h;
  const fa = fixed.exactScore?.a;

  // ---- Regra 3 & 4: placar exato vs Ambas Marcam ----
  if (fh != null && fa != null) {
    const bothScored = fh > 0 && fa > 0;
    const bttsPick = (fixed.btts?.pick ?? fixed.btts?.selection ?? "").toUpperCase();
    if (!bothScored && (bttsPick.includes("SIM") || bttsPick.startsWith("S"))) {
      problems.push(`Contradição: placar ${fh}-${fa} (sem gols dos dois lados) com Ambas Marcam "Sim".`);
      fixed.btts = { pick: "NÃO", selection: "Ambas marcam · Não" };
      problems.push("Ambas Marcam corrigido para NÃO.");
    } else if (bothScored && (bttsPick.includes("NÃO") || (bttsPick.length > 0 && !bttsPick.includes("SIM") && !bttsPick.startsWith("S")))) {
      problems.push(`Contradição: placar ${fh}-${fa} (gols dos dois lados) com Ambas Marcam "Não".`);
      fixed.btts = { pick: "SIM", selection: "Ambas marcam · Sim" };
      problems.push("Ambas Marcam corrigido para SIM.");
    }
  }

  // ---- Regra 5: linha de gols vs soma do placar exato ----
  if (fh != null && fa != null) {
    const sum = fh + fa;
    const imposed: "over" | "under" = sum >= 2 ? "over" : "under";
    const lineRaw = (fixed.goals?.line ?? fixed.goals?.selection ?? "").toUpperCase();
    const saysOver = /OVER\s*1?\.?5|MAIS DE 1\.5|O1\.5/.test(lineRaw);
    const saysUnder = /UNDER\s*1?\.?5|MENOS DE 1\.5|U1\.5/.test(lineRaw);
    if (saysOver && imposed === "under") {
      problems.push(`Contradição: linha Over 1.5 com placar ${fh}-${fa} (soma ${sum} < 2).`);
      fixed.goals = { line: "Under 1.5", side: "under", selection: "Menos de 1.5 gols" };
      problems.push("Linha de gols corrigida para Under 1.5.");
    } else if (saysUnder && imposed === "over") {
      problems.push(`Contradição: linha Under 1.5 com placar ${fh}-${fa} (soma ${sum} ≥ 2).`);
      fixed.goals = { line: "Over 1.5", side: "over", selection: "Mais de 1.5 gols" };
      problems.push("Linha de gols corrigida para Over 1.5.");
    }
  }

  // ---- Regra 2: linha de gols vs narrativa (Over vs UNDER no texto) ----
  if (fixed.narrative) {
    const narr = fixed.narrative.toUpperCase();
    const goalsSide = (fixed.goals?.line ?? fixed.goals?.selection ?? "").toUpperCase();
    const saysOverText = /\bOVER\b|O1\.5/.test(narr);
    const saysUnderText = /\bUNDER\b|U1\.5/.test(narr);
    const lineIsOver = goalsSide.includes("OVER") || goalsSide.includes("MAIS");
    const lineIsUnder = goalsSide.includes("UNDER") || goalsSide.includes("MENOS");
    if (lineIsOver && saysUnderText && !saysOverText) {
      problems.push(`Contradição: linha Over 1.5 com narrativa citando UNDER.`);
      if (fixed.goals) {
        fixed.goals = { line: "Under 1.5", side: "under", selection: "Menos de 1.5 gols" };
      }
      problems.push("Linha de gols corrigida para Under 1.5 (acompanha a narrativa).");
    } else if (lineIsUnder && saysOverText && !saysUnderText) {
      problems.push(`Contradição: linha Under 1.5 com narrativa citando OVER.`);
      if (fixed.goals) {
        fixed.goals = { line: "Over 1.5", side: "over", selection: "Mais de 1.5 gols" };
      }
      problems.push("Linha de gols corrigida para Over 1.5 (acompanha a narrativa).");
    }
  }

  // ---- Regra 6: HT/FT vs tendência ----
  if (winner && fixed.htFt) {
    const ft = fixed.htFt.split("/")[1] ?? "";
    const want = WINNER_FT[winner];
    if (ft && ft !== want) {
      problems.push(`Contradição: HT/FT ${fixed.htFt} com tendência ${WINNER_LABEL[winner]} (FT deve ser ${want}).`);
      const ht = fixed.htFt.split("/")[0] || "X";
      fixed.htFt = `${ht}/${want}`;
      problems.push(`HT/FT corrigido para ${fixed.htFt}.`);
    }
  }

  return { valid: problems.length === 0, problems, fixed };
}

/** aplica o validador e retorna o payload mestre corrigido (ou original validado). */
export function applyCoherence(payload: PredictionPayload): PredictionPayload {
  const { fixed } = validatePredictionCoherence(payload);
  return fixed;
}