/**
 * Beta — Gerador Híbrido automático (Sistema 3/4 da Betano).
 *
 * Lê apenas o que já está salvo na Triagem (triagem_records): zero chamadas
 * à API-Football. Escolhe os 4 melhores jogos do perfil defensivo
 * (under_1_5 · ambas_nao · casa_vence, score >= 75) e divide em dois pares:
 *
 *  - Par superior (jogos 1 e 2): eixo do empate dividido entre a família OVER
 *    e a família UNDER de escanteios + vitórias secas (1x0 · 2x0).
 *  - Par inferior (jogos 3 e 4): vitórias controladas + Múltipla Especial da
 *    Betano (2x1 · 3x1 · 4x1) como blindagem contra explosão de gols.
 *
 * Cada jogo recebe 3 opções → Sistema 3/4 = 4 trios x 27 = 108 combinações.
 */

export const BETA_MIN_SCORE = 75;
export const BETA_GAMES = 4;
export const BETA_STAKE = 0.5;

/** Mercados defensivos aceitos como porta de entrada do Beta. */
export const BETA_MARKETS = ["under_1_5", "ambas_nao", "casa_vence"] as const;
export type BetaMarket = (typeof BETA_MARKETS)[number];

export interface BetaMarketRow {
  market_type: string;
  predicted_value: string;
  score_confidence: number;
  probability: number;
}

export interface BetaCandidate {
  fixtureId: number;
  matchName: string;
  home: string;
  away: string;
  league: string | null;
  kickoff: string | null;
  /** maior score_confidence dentre os mercados defensivos */
  score: number;
  markets: BetaMarketRow[];
}

export interface BetaOption {
  n: 1 | 2 | 3;
  title: string;
  selection: string;
  prob: number;
  odd: number;
  note: string;
}

export type BetaBlock = "superior" | "inferior";

export interface BetaGame {
  fixtureId: number;
  home: string;
  away: string;
  league: string | null;
  kickoff: string | null;
  score: number;
  block: BetaBlock;
  blockLabel: string;
  options: BetaOption[];
}

export interface BetaSystemMath {
  games: number;
  /** 4 trios x 27 combinações */
  combos: number;
  cost: number;
  /** retorno médio acertando 3 de 4 (menor odd de cada jogo) */
  return3: number;
  /** retorno acertando os 4 */
  return4: number;
  /** os 4 trios do sistema (índices dos jogos) */
  triples: { skipped: number; games: number[]; odd: number }[];
}

export interface BetaSnapshot {
  day: string;
  builtAt: string;
  stake: number;
  games: BetaGame[];
  /** jogos avaliados na base da Triagem */
  scanned: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Probabilidade → odd estimada de casa (margem ~7%). */
export function toOdd(p: number): number {
  const safe = clamp(p, 0.004, 0.95);
  return Number(Math.max(1.05, (1 / safe) * 0.93).toFixed(2));
}

function prob(c: BetaCandidate, market: string, fallback: number): number {
  const row = c.markets.find((m) => m.market_type === market);
  if (!row) return fallback;
  const p = row.probability > 1 ? row.probability / 100 : row.probability;
  return p > 0 && p <= 1 ? p : fallback;
}

function option(n: 1 | 2 | 3, title: string, selection: string, p: number, note: string): BetaOption {
  const safe = clamp(p, 0.01, 0.9);
  return { n, title, selection, prob: safe, odd: toOdd(safe), note };
}

/** Par superior: eixo do empate (famílias de escanteio) + vitória seca. */
function superiorOptions(c: BetaCandidate, side: "over" | "under"): BetaOption[] {
  const pUnder15 = prob(c, "under_1_5", 0.42);
  const pNoBtts = prob(c, "ambas_nao", 0.5);
  const pHome = prob(c, "casa_vence", 0.45);
  const pDraw = clamp(1 - pHome - 0.28, 0.14, 0.38);
  return [
    side === "over"
      ? option(1, "Empate + Família OVER escanteios", "Empate & Mais de 9.5 escanteios", pDraw * 0.55, "eixo de empate com jogo aberto no canto")
      : option(1, "Empate + Família UNDER escanteios", "Empate & Menos de 9.5 escanteios", pDraw * 0.5, "trava do empate em jogo truncado"),
    option(2, "Vitória seca do mandante", "Placar múltiplo 1x0 · 2x0", pHome * 0.46, "casa vence sem sofrer gol"),
    option(3, "Blindagem defensiva", pNoBtts >= pUnder15 ? "Ambas marcam: NÃO" : "Menos de 1.5 gols", Math.max(pNoBtts, pUnder15) * 0.9, "proteção do perfil Under"),
  ];
}

/** Par inferior: vitória controlada + Múltipla Especial da Betano. */
function inferiorOptions(c: BetaCandidate): BetaOption[] {
  const pUnder15 = prob(c, "under_1_5", 0.42);
  const pNoBtts = prob(c, "ambas_nao", 0.5);
  const pHome = prob(c, "casa_vence", 0.45);
  return [
    option(1, "Vitória controlada", "Casa vence & Menos de 3.5 gols", pHome * 0.78, "favorito sem jogo aberto"),
    option(2, "Placar múltiplo seco", "1x0 · 2x0 · 3x0", pHome * 0.52, "vitória do mandante sem sofrer gol"),
    option(3, "Especial Betano (blindagem)", "Placar múltiplo 2x1 · 3x1 · 4x1", clamp(pHome * (1 - Math.max(pNoBtts, pUnder15)) * 0.9, 0.04, 0.3), "cobre a explosão de gols do favorito"),
  ];
}

/** Monta os 4 jogos do dia em blocos híbridos a partir dos candidatos da Triagem. */
export function buildBetaHibrido(candidates: BetaCandidate[]): BetaGame[] {
  const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, BETA_GAMES);
  return top.map((c, i) => {
    const block: BetaBlock = i < 2 ? "superior" : "inferior";
    return {
      fixtureId: c.fixtureId,
      home: c.home,
      away: c.away,
      league: c.league,
      kickoff: c.kickoff,
      score: c.score,
      block,
      blockLabel: block === "superior" ? "Par superior · empate + vitória seca" : "Par inferior · vitória controlada + especial Betano",
      options: block === "superior" ? superiorOptions(c, i === 0 ? "over" : "under") : inferiorOptions(c),
    };
  });
}

/** Contas do Sistema 3/4 com a MENOR odd de cada jogo (cenário conservador). */
export function betaSystemMath(games: BetaGame[], stake = BETA_STAKE): BetaSystemMath {
  const n = games.length;
  const odds = games.map((g) => Math.min(...g.options.map((o) => o.odd)));
  const triples = games.map((_, skip) => {
    const idx = games.map((_g, i) => i).filter((i) => i !== skip);
    const odd = idx.reduce((s, i) => s * odds[i], 1);
    return { skipped: skip, games: idx, odd: Number(odd.toFixed(2)) };
  });
  const combos = n === BETA_GAMES ? 4 * 27 : 0;
  const avg = triples.length ? triples.reduce((s, t) => s + t.odd, 0) / triples.length : 0;
  return {
    games: n,
    combos,
    cost: Number((combos * stake).toFixed(2)),
    return3: Number((avg * stake).toFixed(2)),
    return4: Number((triples.reduce((s, t) => s + t.odd, 0) * stake).toFixed(2)),
    triples,
  };
}

/** "Colinha" pronta para replicar o bilhete na Betano. */
export function betaText(snapshot: BetaSnapshot): string {
  const math = betaSystemMath(snapshot.games, snapshot.stake);
  const lines: string[] = [
    `BETA — GERADOR HÍBRIDO · SISTEMA 3/4 (${snapshot.day})`,
    `${snapshot.games.length} jogos x 3 opções · R$ ${snapshot.stake.toFixed(2)} por combinação`,
    "",
  ];
  snapshot.games.forEach((g, i) => {
    const hora = g.kickoff
      ? new Date(g.kickoff).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
      : "--:--";
    lines.push(`JOGO ${i + 1} — ${g.home} x ${g.away} (${hora}) · ${g.blockLabel}`);
    for (const o of g.options) lines.push(`  Opção ${o.n}: ${o.title} — ${o.selection} @ ${o.odd.toFixed(2)}`);
    lines.push("");
  });
  lines.push("TRIOS DO SISTEMA 3/4:");
  math.triples.forEach((t) => {
    lines.push(`  Trio sem o jogo ${t.skipped + 1}: ${t.games.map((i) => i + 1).join(" + ")} @ ${t.odd.toFixed(2)}`);
  });
  lines.push(
    "",
    `Sistema 3/4: ${math.combos} combinações · custo R$ ${math.cost.toFixed(2)}`,
    `Retorno estimado com 3 acertos: R$ ${math.return3.toFixed(2)}`,
    `Retorno estimado com 4 acertos: R$ ${math.return4.toFixed(2)}`,
  );
  return lines.join("\n");
}
