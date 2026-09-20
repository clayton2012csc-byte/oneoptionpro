/**
 * Fechamento Betano (Sistema 3/4) — motor puro / client-safe.
 *
 * OBJETIVO MESTRE DO ONEOPTIONIA: odds altas. Todo dia o app escolhe os
 * 4 melhores jogos e entrega 3 OPÇÕES DE COBERTURA por jogo, para serem
 * apostadas em Sistema 3/4 na Betano (3 acertos cobrem o investimento,
 * 4 acertos multiplicam).
 *
 * Perfis e cobertura:
 *  A) FAVORITO + AMBAS MARCAM → 1) placar múltiplo 2x1/3x1/4x1
 *                               2) especiais 3x2/4x2/5x1
 *                               3) proteção: Empate + Ambas Marcam
 *  B) JOGO TRUNCADO (empate)  → 1) Empate + Mais de 9.5 escanteios
 *                               2) Empate + Menos de 9.5 escanteios (trava)
 *                               3) proteção: placar magro 1x0 / 0x1
 *  C) FAVORITO UNDER          → 1) placar múltiplo 1x0/2x0/3x0
 *                               2) Vitória + Menos de 3.5 gols
 *                               3) proteção: Empate 0x0 / 1x1
 */

export type FechamentoProfile = "favorito_btts" | "truncado" | "favorito_under";

export const PROFILE_LABEL: Record<FechamentoProfile, string> = {
  favorito_btts: "Favorito + Ambas Marcam",
  truncado: "Jogo truncado (empate)",
  favorito_under: "Favorito de jogo fechado",
};

export interface CoverageOption {
  n: 1 | 2 | 3;
  title: string;
  selection: string;
  prob: number;
  odd: number;
  /** a opção 3 é sempre a proteção (empate/zebra) */
  protection: boolean;
  reason: string;
}

export interface CoverageGame {
  fixtureId: number;
  home: string;
  away: string;
  homeLogo: string | null;
  awayLogo: string | null;
  league: string | null;
  kickoff: string;
  profile: FechamentoProfile;
  profileLabel: string;
  score: number;
  options: CoverageOption[];
}

export interface FechamentoSnapshot {
  day: string;
  builtAt: string;
  games: CoverageGame[];
  /** valor por combinação usado nas contas (R$) */
  stake: number;
}

export interface PickLike {
  market: string;
  selection: string;
  prob: number;
  odd: number;
  score?: number;
  elite?: boolean;
}

export interface FixtureLike {
  fixture_id: number;
  kickoff: string;
  league: string | null;
  home: string;
  away: string;
  home_logo: string | null;
  away_logo: string | null;
  picks: PickLike[] | null;
}

/** Odd mínima exigida na Opção 3 (proteção). */
export const MIN_PROTECTION_ODD = 5;
/** Valor padrão por combinação. */
export const DEFAULT_STAKE = 0.5;
/** Quantidade de jogos do fechamento. */
export const GAMES_PER_CLOSURE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Converte probabilidade em odd estimada de casa (margem ~7%). */
function toOdd(p: number): number {
  const safe = clamp(p, 0.004, 0.95);
  return Number(Math.max(1.05, (1 / safe) * 0.93).toFixed(2));
}

interface Reads {
  pHome: number;
  pDraw: number;
  pAway: number;
  pBTTS: number;
  pOverCorners: number;
  pUnder35: number;
  favorite: "H" | "A";
  favName: string;
}

function readPicks(f: FixtureLike): Reads | null {
  const picks = (f.picks ?? []).filter((p) => p && Number.isFinite(p.prob));
  if (!picks.length) return null;
  const get = (market: string) => picks.find((p) => p.market === market);

  const res = get("Resultado 1X2");
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  if (res) {
    if (res.selection === f.home) pHome = res.prob;
    else if (res.selection === f.away) pAway = res.prob;
    else pDraw = res.prob;
  }

  const margin = picks.find((p) => p.market === "Margem de Vitória" && p.selection === "Empate");
  if (margin) pDraw = Math.max(pDraw, margin.prob);
  if (!pDraw) pDraw = 0.26;
  if (!pHome && !pAway) return null;
  if (!pHome) pHome = Math.max(0, 1 - pDraw - pAway);
  if (!pAway) pAway = Math.max(0, 1 - pDraw - pHome);

  const btts = get("Ambas Marcam");
  const pBTTS = btts
    ? /sim/i.test(btts.selection)
      ? btts.prob
      : 1 - btts.prob
    : 0.5;

  const corners = get("Escanteios");
  const pOverCorners = corners
    ? /mais/i.test(corners.selection)
      ? corners.prob
      : 1 - corners.prob
    : 0.5;

  const goals = get("Gols Dinâmico");
  let pUnder35 = 0.62;
  if (goals) {
    if (/menos de 3\.5/i.test(goals.selection)) pUnder35 = goals.prob;
    else if (/mais de 2\.5/i.test(goals.selection)) pUnder35 = clamp(1 - goals.prob * 0.55, 0.25, 0.85);
  }

  const favorite: "H" | "A" = pHome >= pAway ? "H" : "A";
  return {
    pHome,
    pDraw,
    pAway,
    pBTTS,
    pOverCorners,
    pUnder35,
    favorite,
    favName: favorite === "H" ? f.home : f.away,
  };
}

function profileOf(r: Reads): FechamentoProfile | null {
  const pFav = r.favorite === "H" ? r.pHome : r.pAway;
  if (pFav > 0.55 && r.pBTTS > 0.55) return "favorito_btts";
  if (pFav > 0.55 && r.pBTTS <= 0.5) return "favorito_under";
  if (r.pDraw >= 0.27) return "truncado";
  return null;
}

function opt(
  n: 1 | 2 | 3,
  title: string,
  selection: string,
  prob: number,
  reason: string,
  protection = false,
): CoverageOption {
  return { n, title, selection, prob, odd: toOdd(prob), protection, reason };
}

function buildOptions(f: FixtureLike, r: Reads, profile: FechamentoProfile): CoverageOption[] {
  const fav = r.favName;
  const dog = r.favorite === "H" ? f.away : f.home;
  const pFav = r.favorite === "H" ? r.pHome : r.pAway;
  const sc = (h: number, a: number) => (r.favorite === "H" ? `${h}x${a}` : `${a}x${h}`);

  if (profile === "favorito_btts") {
    return [
      opt(
        1,
        "Placar múltiplo",
        `${sc(2, 1)} · ${sc(3, 1)} · ${sc(4, 1)}`,
        pFav * r.pBTTS * 0.46,
        `${fav} favorito (${(pFav * 100).toFixed(0)}%) com gol do adversário (${(r.pBTTS * 100).toFixed(0)}%)`,
      ),
      opt(
        2,
        "Especial Betano (goleada)",
        `${sc(3, 2)} · ${sc(4, 2)} · ${sc(5, 1)}`,
        pFav * r.pBTTS * 0.12,
        "cobertura de jogo aberto com muitos gols dos dois lados",
      ),
      opt(
        3,
        "Proteção — Aposta montada",
        "Empate + Ambas marcam",
        r.pDraw * r.pBTTS * 0.62,
        `trava do empate com gol dos dois lados (${(r.pDraw * 100).toFixed(0)}% de empate)`,
        true,
      ),
    ];
  }

  if (profile === "truncado") {
    return [
      opt(
        1,
        "Aposta montada",
        "Empate + Mais de 9.5 escanteios",
        r.pDraw * r.pOverCorners,
        `empate provável (${(r.pDraw * 100).toFixed(0)}%) em jogo de pressão`,
      ),
      opt(
        2,
        "Aposta montada (trava)",
        "Empate + Menos de 9.5 escanteios",
        r.pDraw * (1 - r.pOverCorners),
        "se o jogo empatar, a Opção 1 ou a 2 bate obrigatoriamente",
      ),
      opt(
        3,
        "Proteção — Placar magro",
        `${f.home} 1x0 · ${f.away} 0x1`,
        (1 - r.pDraw) * 0.3,
        "cobertura da vitória apertada em jogo travado",
        true,
      ),
    ];
  }

  return [
    opt(
      1,
      "Placar múltiplo seco",
      `${sc(1, 0)} · ${sc(2, 0)} · ${sc(3, 0)}`,
      pFav * (1 - r.pBTTS) * 0.72,
      `${fav} favorito com defesa forte contra o ${dog}`,
    ),
    opt(
      2,
      "Aposta montada",
      `${fav} vence + Menos de 3.5 gols`,
      pFav * r.pUnder35,
      "jogo de poucos gols com favorito claro",
    ),
    opt(
      3,
      "Proteção — Placar múltiplo empate",
      "0x0 · 1x1",
      r.pDraw * 0.72,
      "cobertura do empate magro",
      true,
    ),
  ];
}

/** Monta as 3 opções de cobertura de um jogo (ou null se não se encaixa no método). */
export function buildCoverageGame(f: FixtureLike): CoverageGame | null {
  const r = readPicks(f);
  if (!r) return null;
  const profile = profileOf(r);
  if (!profile) return null;
  const options = buildOptions(f, r, profile);
  const protection = options.find((o) => o.protection);
  if (!protection || protection.odd < MIN_PROTECTION_ODD) return null;

  const pFav = r.favorite === "H" ? r.pHome : r.pAway;
  const coverage = options.reduce((s, o) => s + o.prob, 0);
  const score = Math.round(
    clamp(coverage * 100 * 0.7 + (profile === "truncado" ? r.pDraw : pFav) * 100 * 0.3, 0, 100),
  );

  return {
    fixtureId: Number(f.fixture_id),
    home: f.home,
    away: f.away,
    homeLogo: f.home_logo,
    awayLogo: f.away_logo,
    league: f.league,
    kickoff: f.kickoff,
    profile,
    profileLabel: PROFILE_LABEL[profile],
    score,
    options,
  };
}

/** Escolhe os 4 melhores jogos do dia para o fechamento. */
export function buildClosure(rows: FixtureLike[]): CoverageGame[] {
  const games: CoverageGame[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(Number(r.fixture_id))) continue;
    const g = buildCoverageGame(r);
    if (!g) continue;
    seen.add(g.fixtureId);
    games.push(g);
  }
  return games
    .sort((a, b) => b.score - a.score)
    .slice(0, GAMES_PER_CLOSURE)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

export interface SystemMath {
  games: number;
  /** combinações do Sistema 3/4 (4 triplas x 27) */
  combos34: number;
  cost34: number;
  /** combinações da quádrupla seca (3^4) */
  combos44: number;
  cost44: number;
  /** retorno médio acertando 3 de 4 */
  return3: number;
  /** retorno médio acertando os 4 */
  return4: number;
}

/** Contas do Sistema 3/4 usando a MENOR odd de cada jogo (cenário conservador). */
export function systemMath(games: CoverageGame[], stake = DEFAULT_STAKE): SystemMath {
  const odds = games.map((g) => Math.min(...g.options.map((o) => o.odd)));
  const n = games.length;
  const triples: number[] = [];
  for (let skip = 0; skip < n; skip++) {
    const prod = odds.filter((_, i) => i !== skip).reduce((s, o) => s * o, 1);
    triples.push(prod);
  }
  const combos34 = n === 4 ? 4 * 27 : 0;
  const combos44 = n === 4 ? 81 : 0;
  const avgTriple = triples.length ? triples.reduce((s, v) => s + v, 0) / triples.length : 0;
  return {
    games: n,
    combos34,
    cost34: Number((combos34 * stake).toFixed(2)),
    combos44,
    cost44: Number((combos44 * stake).toFixed(2)),
    return3: Number((avgTriple * stake).toFixed(2)),
    return4: Number((triples.reduce((s, v) => s + v, 0) * stake).toFixed(2)),
  };
}

/** Texto pronto para copiar e executar na Betano. */
export function closureText(snapshot: FechamentoSnapshot): string {
  const math = systemMath(snapshot.games, snapshot.stake);
  const lines: string[] = [
    `FECHAMENTO BETANO — SISTEMA 3/4 (${snapshot.day})`,
    `${snapshot.games.length} jogos x 3 opções · R$ ${snapshot.stake.toFixed(2)} por combinação`,
    "",
  ];
  snapshot.games.forEach((g, i) => {
    const hora = new Date(g.kickoff).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(`JOGO ${i + 1} — ${g.home} x ${g.away} (${hora}) · ${g.profileLabel}`);
    for (const o of g.options) {
      lines.push(`  Opção ${o.n}: ${o.title} — ${o.selection} @ ${o.odd.toFixed(2)}`);
    }
    lines.push("");
  });
  lines.push(
    `Sistema 3/4: ${math.combos34} combinações · custo R$ ${math.cost34.toFixed(2)}`,
    `Retorno estimado com 3 acertos: R$ ${math.return3.toFixed(2)}`,
    `Retorno estimado com 4 acertos: R$ ${math.return4.toFixed(2)}`,
  );
  return lines.join("\n");
}
