// Validação cruzada de mercados complexos (placar exato, margem, 1X2, ambas e
// evolução do jogo). Puro / client-safe. Alimenta o prompt do Gemini e o
// validador do backend antes da gravação em ai_predictions.

import type { OwnPrediction } from "./own-prediction";

export type Resultado1x2 = "1" | "X" | "2";
export type AmbasMarcam = "Sim" | "Não";
export type Side = "home" | "away";

export const COMPLEX_MARKETS = [
  "placar_exato_seco",
  "margem_vitoria",
  "ambas_marcam",
  "resultado_1x2",
  "evolucao_jogo",
] as const;

export interface ComplexPickSet {
  placar_exato_seco: string;
  margem_vitoria: string;
  ambas_marcam: AmbasMarcam;
  resultado_1x2: Resultado1x2;
  evolucao_jogo: string;
}

export interface ScoreAnchor {
  home: number;
  away: number;
  label: string;
  p: number;
}

export interface ComplexValidation {
  ok: boolean;
  issues: string[];
  corrected: ComplexPickSet | null;
  derived: ComplexPickSet | null;
}

export function parseScoreline(s: string): { home: number; away: number } | null {
  const m = s.replace(/\s+/g, "").match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const home = Number(m[1]);
  const away = Number(m[2]);
  if (!Number.isInteger(home) || !Number.isInteger(away)) return null;
  return { home, away };
}

export function marginName(i: number, j: number): string {
  if (i > j) return `Casa por ${i - j}`;
  if (i < j) return `Fora por ${j - i}`;
  return "Empate";
}

function canon(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function marginEqual(a: string, b: string): boolean {
  const na = canon(a).replace("visitantepor", "forapor").replace("mandantepor", "casapor");
  const nb = canon(b).replace("visitantepor", "forapor").replace("mandantepor", "casapor");
  return na === nb;
}

export function favoriteOf(pred: OwnPrediction): Side {
  return pred.pHome >= pred.pAway ? "home" : "away";
}

export function favoriteHtMode(pred: OwnPrediction): Resultado1x2 {
  const fav = favoriteOf(pred);
  const { htHome: h, htDraw: d, htAway: a } = pred;
  if (fav === "home") return h >= d && h >= a ? "1" : d >= a ? "X" : "2";
  return a >= d && a >= h ? "2" : d >= h ? "X" : "1";
}

export function evolucaoFor(ht: Resultado1x2, ft: Resultado1x2): string {
  return `${ht}/${ft}`;
}

export function parseEvolucao(s: string): { ht: Resultado1x2; ft: Resultado1x2 } | null {
  const m = s.trim().match(/^([1xX2])\s*[/]\s*([1xX2])$/i);
  if (!m) return null;
  return { ht: m[1]!.toUpperCase() as Resultado1x2, ft: m[2]!.toUpperCase() as Resultado1x2 };
}

export function scorelineAnchors(pred: OwnPrediction, n = 3): ScoreAnchor[] {
  return pred.topScores.slice(0, n).map((s) => {
    const sc = parseScoreline(s.label);
    return { home: sc?.home ?? 0, away: sc?.away ?? 0, label: s.label, p: s.p };
  });
}

export function deriveFromScoreline(i: number, j: number, ht: Resultado1x2): ComplexPickSet {
  const res: Resultado1x2 = i > j ? "1" : i < j ? "2" : "X";
  return {
    placar_exato_seco: `${i}-${j}`,
    margem_vitoria: marginName(i, j),
    ambas_marcam: i > 0 && j > 0 ? "Sim" : "Não",
    resultado_1x2: res,
    evolucao_jogo: evolucaoFor(ht, res),
  };
}

export function applyComplexRules(
  input: ComplexPickSet,
  ctx?: { favoriteHt?: Resultado1x2 },
): ComplexValidation {
  const issues: string[] = [];
  const score = parseScoreline(input.placar_exato_seco ?? "");
  if (!score) {
    return {
      ok: false,
      issues: [`placar_exato_seco "${input.placar_exato_seco}" inválido (esperado "X-Y").`],
      corrected: null,
      derived: null,
    };
  }

  const res: Resultado1x2 = score.home > score.away ? "1" : score.home < score.away ? "2" : "X";
  const margin = marginName(score.home, score.away);
  const ht = ctx?.favoriteHt ?? (res === "1" ? "1" : res === "2" ? "2" : "X");
  const nivel = score.home - score.away;
  const derived: ComplexPickSet = {
    placar_exato_seco: `${score.home}-${score.away}`,
    margem_vitoria: margin,
    ambas_marcam: score.home > 0 && score.away > 0 ? "Sim" : "Não",
    resultado_1x2: res,
    evolucao_jogo: evolucaoFor(ht, res),
  };

  if (!marginEqual(input.margem_vitoria ?? "", margin)) {
    issues.push(
      `margem_vitoria "${input.margem_vitoria}" diverge do placar ${score.home}-${score.away} (deveria ser "${margin}").`,
    );
  }

  if (nivel === 0) {
    const corrAmbas: AmbasMarcam = score.home > 0 ? "Sim" : "Não";
    if (input.resultado_1x2 !== "X") {
      issues.push(`placar é empate (${score.home}-${score.away}) mas resultado_1x2 é "${input.resultado_1x2}" (deveria ser "X").`);
    }
    if (input.ambas_marcam !== corrAmbas) {
      issues.push(`placar é empate (${score.home}-${score.away}) mas ambas_marcam é "${input.ambas_marcam}" (deveria ser "${corrAmbas}").`);
    }
  } else {
    if (input.resultado_1x2 !== res) {
      issues.push(`resultado_1x2 "${input.resultado_1x2}" diverge do placar ${score.home}-${score.away} (deveria ser "${res}").`);
    }
    const corrAmbas: AmbasMarcam = score.home > 0 && score.away > 0 ? "Sim" : "Não";
    if (input.ambas_marcam !== corrAmbas) {
      issues.push(`ambas_marcam "${input.ambas_marcam}" diverge do placar ${score.home}-${score.away} (o correto é "${corrAmbas}").`);
    }
  }

  const ev = parseEvolucao(input.evolucao_jogo ?? "");
  if (!ev) {
    issues.push(`evolucao_jogo "${input.evolucao_jogo}" inválida (esperado "HT/FT" com HT,FT em {1,X,2}).`);
  } else if (ev.ft !== res) {
    issues.push(
      `evolucao_jogo "${input.evolucao_jogo}" tem Final "${ev.ft}" divergente do resultado_1x2 "${res}" (deveria ser "${evolucaoFor(ev.ht, res)}").`,
    );
  }

  const corrected: ComplexPickSet = {
    ...input,
    margem_vitoria: margin,
    ambas_marcam: derived.ambas_marcam,
    resultado_1x2: res,
    evolucao_jogo: derived.evolucao_jogo,
  };

  return { ok: issues.length === 0, issues, corrected, derived };
}

export function pickProbs(pred: OwnPrediction, picks: ComplexPickSet): Record<string, number> {
  const score = parseScoreline(picks.placar_exato_seco ?? "");
  const cell = (i: number, j: number) => pred.matrix?.[i]?.[j] ?? 0;

  let margin = 0;
  if (score && score.home === score.away) {
    for (let i = 0; i <= 6; i++) margin += cell(i, i);
  } else if (score && score.home > score.away) {
    const d = score.home - score.away;
    for (let i = 1; i <= 6; i++) for (let j = 0; j <= 6; j++) if (i - j === d) margin += cell(i, j);
  } else if (score) {
    const d = score.away - score.home;
    for (let i = 0; i <= 6; i++) for (let j = 1; j <= 6; j++) if (j - i === d) margin += cell(i, j);
  }

  const evolucao = evolucaoProb(pred, picks.evolucao_jogo);

  return {
    placar_exato_seco: score ? cell(score.home, score.away) : 0,
    margem_vitoria: margin,
    ambas_marcam: picks.ambas_marcam === "Sim" ? pred.pBTTS : pred.pNoBTTS,
    resultado_1x2: picks.resultado_1x2 === "1" ? pred.pHome : picks.resultado_1x2 === "2" ? pred.pAway : pred.pDraw,
    evolucao_jogo: evolucao,
  };
}

export function evolucaoProb(pred: OwnPrediction, label: string): number {
  const hit = pred.htFt.find((h) => h.label === label);
  if (hit) return hit.p;
  const ev = parseEvolucao(label);
  if (!ev) return 0;
  const htVal = ev.ht === "1" ? pred.htHome : ev.ht === "2" ? pred.htAway : pred.htDraw;
  const ftVal = ev.ft === "1" ? pred.pHome : ev.ft === "2" ? pred.pAway : pred.pDraw;
  return htVal * ftVal;
}

export function makeAdversarial(base: ComplexPickSet): ComplexPickSet[] {
  const variants: ComplexPickSet[] = [];

  const flippedMargin = base.margem_vitoria === "Empate" ? "Casa por 1" : "Empate";
  variants.push({ ...base, margem_vitoria: flippedMargin });

  if (base.placar_exato_seco !== "1-1") {
    variants.push({
      ...base,
      placar_exato_seco: "1-1",
      margem_vitoria: "Empate",
      ambas_marcam: "Não",
      resultado_1x2: "1",
      evolucao_jogo: "X/1",
    });
  } else {
    variants.push({
      ...base,
      placar_exato_seco: "2-1",
      margem_vitoria: "Casa por 1",
      ambas_marcam: "Sim",
      resultado_1x2: "2",
      evolucao_jogo: "1/2",
    });
  }

  const other: Resultado1x2 = base.resultado_1x2 === "X" ? "1" : base.resultado_1x2 === "1" ? "2" : "1";
  variants.push({ ...base, evolucao_jogo: `${other}/${other}` });

  return variants;
}