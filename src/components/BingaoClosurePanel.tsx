import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Loader2, ChevronDown, ChevronUp, Calculator, RotateCw, Save, Trash2, Check, ListOrdered, Pin, Brain, Printer, Share2, Info, Search, ShieldCheck, ClipboardList, Zap, ArrowRight, Download, MessageSquare } from "lucide-react";
import { AiLevelPanel } from "@/components/AiLevelPanel";
import { blockReason, criteriaScore, vetoReason, recentFailure, MAX_LAMBDA_TOTAL, MIN_U15, type CriteriaInput } from "@/lib/bingao-criteria";
import { CriteriaDetailsDialog, type CriteriaDetails } from "@/components/CriteriaDetailsDialog";

import {
  getFixture,
  getFixturesByDate,
  getMatchPreview,
  getBingaoOdds,
  getBookmakerFixtureIds,
  LIVE_STATUSES,
  FINISHED_STATUSES,
  getTeamSeasonStatistics,
  type ApiFixture,
  type ApiTeamSeasonStats,
  type TeamPreviewStats,
  type BingaoOdds,
} from "@/lib/api-football.functions";
import { computeOwnPrediction, dcTau } from "@/lib/own-prediction";
import { usePinnedSections, setPinnedFixtures } from "@/lib/pinned-sections";
import { AiCommentary } from "@/components/AiCommentary";
import { getAiInsight } from "@/lib/ai-insight.functions";

import { listFechamentos, saveFechamento, deleteFechamento, type Fechamento } from "@/lib/fechamentos";
import {
  buildCalibration,
  geoMean,
  ticketConfidenceFromGeo,
  MIN_CALIBRATION_SAMPLE,
  type Calibration,
} from "@/lib/ticket-calibration";
import { printFechamento, shareFechamento, shareFechamentoWhatsApp, type ExportFechamento, type ExportTicket, type ExportProof } from "@/lib/fechamento-export";

/** Converte um fechamento salvo (summary.markets) para o formato de exportação. */
function savedToExport(f: Fechamento): ExportFechamento {
  const summary = f.summary as { markets?: ExportTicket[]; justification?: string } | null;
  const markets = summary?.markets;
  const justification = summary?.justification;

  const tickets: ExportTicket[] = Array.isArray(markets)
    ? markets.map((m) => ({
        market: m.market,
        label: m.label,
        picks: m.picks ?? (m as unknown as { games?: ExportTicket["picks"] }).games ?? [],
      }))
    : (f.tickets ?? []).map((t: any) => ({ market: `B${t.n}`, label: t.label, picks: [] }));

  // Separa os fixos (B1-B5) dos mistos (V1-V5)
  const fixed = tickets.filter((t) => t.market.startsWith("B"));
  const mixed = tickets.filter((t) => t.market.startsWith("V"));

  return {
    name: f.name,
    date: new Date(f.target_date + "T12:00:00").toLocaleDateString("pt-BR"),
    tickets: fixed,
    mixed: mixed,
    justification: justification,
  };
}


// ---- Poisson helpers ----
function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}
function scoreMatrix(lh: number, la: number, max = 6): number[][] {
  const m: number[][] = [];
  let total = 0;
  for (let i = 0; i <= max; i++) {
    m[i] = [];
    for (let j = 0; j <= max; j++) {
      // Dixon-Coles nos placares baixos + normalização (a matriz é truncada em `max`)
      const p = poisson(lh, i) * poisson(la, j) * Math.max(0.01, dcTau(i, j, lh, la));
      m[i][j] = p;
      total += p;
    }
  }
  if (total > 0) for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) m[i][j] /= total;
  return m;
}
function sumScores(m: number[][], pairs: [number, number][]): number {
  return pairs.reduce((s, [i, j]) => s + (m[i]?.[j] ?? 0), 0);
}
function num(v: string | number | null | undefined, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : v ?? fallback;
  return isFinite(n as number) ? (n as number) : fallback;
}

type Enriched = {
  id: number;
  fixture: ApiFixture | null;
  homeStats: ApiTeamSeasonStats | null;
  awayStats: ApiTeamSeasonStats | null;
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  matrix: number[][];
  pUnder15: number;
  pDraw: number;

  pScores: Record<string, number>;
  ready: boolean;
};

const SCORES: [string, [number, number]][] = [
  ["0-0", [0, 0]], ["1-0", [1, 0]], ["0-1", [0, 1]],
  ["1-1", [1, 1]], ["2-0", [2, 0]], ["0-2", [0, 2]],
  ["2-1", [2, 1]], ["1-2", [1, 2]], ["2-2", [2, 2]],
];

function computePoisson(fx: ApiFixture | null, home: ApiTeamSeasonStats | null, away: ApiTeamSeasonStats | null): Omit<Enriched, "id" | "fixture" | "homeStats" | "awayStats"> {
  if (!fx || !home || !away) {
    return { lambdaHome: 0, lambdaAway: 0, lambdaTotal: 0, matrix: [], pUnder15: 0, pDraw: 0, pScores: {}, ready: false };
  }
  const homeFor = num(home.goals?.for?.average?.total, 1.2);
  const homeAgainst = num(home.goals?.against?.average?.total, 1.1);
  const awayFor = num(away.goals?.for?.average?.total, 0.95);
  const awayAgainst = num(away.goals?.against?.average?.total, 1.1);
  let lh = (homeFor + awayAgainst) / 2;
  let la = (awayFor + homeAgainst) / 2;
  const homeCsRate = home.fixtures.played.home > 0 ? home.clean_sheet.home / home.fixtures.played.home : 0;
  const awayCsRate = away.fixtures.played.away > 0 ? away.clean_sheet.away / away.fixtures.played.away : 0;
  la *= 1 - homeCsRate * 0.25;
  lh *= 1 - awayCsRate * 0.25;
  const homeFtsRate = home.fixtures.played.home > 0 ? home.failed_to_score.home / home.fixtures.played.home : 0;
  const awayFtsRate = away.fixtures.played.away > 0 ? away.failed_to_score.away / away.fixtures.played.away : 0;
  lh *= 1 - homeFtsRate * 0.20;
  la *= 1 - awayFtsRate * 0.20;
  const formAdj = (f: string | null | undefined) => {
    if (!f) return 0;
    return f.slice(-5).split("").reduce((a, c) => a + (c === "W" ? 0.02 : c === "L" ? -0.02 : 0), 0);
  };
  lh *= 1 + formAdj(home.form);
  la *= 1 + formAdj(away.form);
  lh = Math.max(0.15, lh);
  la = Math.max(0.15, la);
  const matrix = scoreMatrix(lh, la, 6);
  const pUnder15 = sumScores(matrix, [[0, 0], [1, 0], [0, 1]]);
  const pScores: Record<string, number> = {};
  for (const [label, pair] of SCORES) pScores[label] = matrix[pair[0]][pair[1]];
  let pDraw = 0;
  for (let i = 0; i < matrix.length; i++) pDraw += matrix[i][i] ?? 0;
  return { lambdaHome: lh, lambdaAway: la, lambdaTotal: lh + la, matrix, pUnder15, pDraw, pScores, ready: true };

}

// Concurrency-limited batch runner
async function runBatched<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onEach?: () => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const my = idx++;
      if (my >= items.length) break;
      try {
        results[my] = await fn(items[my]);
      } catch {
        results[my] = null as unknown as R;
      }
      onEach?.();
    }
  });
  await Promise.all(workers);
  return results;
}

// Ligas priorizadas no preenchimento automático (ordem de peso)
const AUTOFILL_LEAGUES = [71, 72, 39, 140, 135, 78, 61, 2, 3, 848, 253, 128, 262, 88, 94, 203, 13, 11, 73, 15];
const SCAN_COUNT = 150; // busca expandida: até 150 jogos para encontrar candidatos com rigor λ < 1.50
const SCAN_DAYS = 2; // hoje + amanhã
const SCAN_WINDOW_MS = 24 * 60 * 60_000; // janela de 24h a partir do momento do clique
// Concorrência das etapas (plano Pro: 7500 req/dia, folga para paralelizar)
const CROSS_CONCURRENCY = 8;
const ODDS_CONCURRENCY = 8;
const STATS_CONCURRENCY = 8;



type ScanRow = {
  id: number;
  home: string;
  away: string;
  homeId: number;
  awayId: number;
  league: string;
  time: string;
  pUnder15: number;
  pDraw: number;
  pScores: Record<string, number>;
  lambdaTotal: number;
  lambdaHome: number;
  lambdaAway: number;
  /** médias de gols marcados/sofridos usadas nos filtros anti-goleada */
  gfHome: number;
  gaHome: number;
  gfAway: number;
  gaAway: number;
  /** motivo do corte (null = aprovado no filtro Under 1.5) */
  block: string | null;
  cornersLambda: number;
  ready: boolean;
  /** true quando o jogo passou pelo cruzamento com o cartão da coluna 3 */
  verified?: boolean;
  /** convicção final (0..1) após cruzamento */
  cross?: number;
  /** sinais dos últimos 6 jogos (etapa 2) */
  sogHome?: number;
  sogAway?: number;
  recentGfHome?: number;
  recentGfAway?: number;
  recentGaHome?: number;
  recentGaAway?: number;
  csHome?: number;
  csAway?: number;
  /** motivo do corte pelo perfil recente (etapa 2) */
  recentBlock?: string | null;
};

// Filtros anti-goleada da etapa 1 vivem em @/lib/bingao-criteria



// ---- Etapa 3: encaixe dos jogos nos 5 bilhetes fixos ----
export type BingoMarket = "B1" | "B2" | "B3" | "B4" | "B5";

const MARKET_LABEL: Record<BingoMarket, string> = {
  B1: "1x0 ou 0x1 (Foco)",
  B2: "2x0 ou 0x2 (Cobertura)",
  B3: "2x1 ou 1x2 (Cobertura)",
  B4: "Empate + Over 9.5 escanteios",
  B5: "Empate + Under 9.5 escanteios",
};

const TICKET_SIZE = 4;
const COMPARE_COUNT = 10; // etapa 1 → etapa 2
const APPROVED_COUNT = 10; // etapa 2 → etapa 3
const MAX_TICKET_REUSE = 3; // um jogo pode entrar em até 3 bilhetes

function poissonCdf(lambda: number, k: number): number {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poisson(lambda, i);
  return Math.min(1, s);
}

// Estimativa de escanteios a partir do volume ofensivo esperado (λ de gols)
function estimateCornersLambda(lambdaTotal: number): number {
  return Math.max(6, Math.min(14, 9.6 + (lambdaTotal - 2.6) * 1.2));
}

/** Escolha do lado (casa/fora) para os placares exatos B1–B3 */
const MARKET_SCORES: Record<"B1" | "B2" | "B3", [string, string]> = {
  B1: ["1-0", "0-1"],
  B2: ["2-0", "0-2"],
  B3: ["2-1", "1-2"],
};

export type MarketPick = { p: number; pick: string; side: "home" | "away" | null };

/** Retorna a probabilidade da linha e, para B1–B3, o lado mais provável. */
function marketPick(r: ScanRow, m: BingoMarket): MarketPick {
  if (!r.ready) return { p: 0, pick: MARKET_LABEL[m], side: null };
  if (m === "B4" || m === "B5") {
    const cdf = poissonCdf(r.cornersLambda, 9);
    const p = m === "B4" ? r.pDraw * (1 - cdf) : r.pDraw * cdf;
    return { p, pick: m === "B4" ? "Empate + Over 9.5 esc." : "Empate + Under 9.5 esc.", side: null };
  }
  const [homeScore, awayScore] = MARKET_SCORES[m];
  const pHome = r.pScores[homeScore] ?? 0;
  const pAway = r.pScores[awayScore] ?? 0;
  if (pHome >= pAway) {
    return { p: pHome, pick: `${homeScore.replace("-", "x")} ${r.home}`, side: "home" };
  }
  return { p: pAway, pick: `${awayScore.replace("-", "x")} ${r.away}`, side: "away" };
}

function marketProb(r: ScanRow, m: BingoMarket): number {
  return marketPick(r, m).p;
}

/** Odd real da casa para a linha do bilhete (placar exato B1–B3, escanteios B4/B5). */
function oddForMarket(r: ScanRow, m: BingoMarket, o: BingaoOdds | null | undefined): number | undefined {
  if (!o) return undefined;
  if (m === "B4" || m === "B5") {
    const book = m === "B4" ? o.cornersOver : o.cornersUnder;
    const line = book["9.5"] ?? book["9"] ?? book["10"];
    // aproximação: empate × escanteios (combinada)
    return line && o.draw ? Number((line * o.draw).toFixed(2)) : undefined;
  }
  const side = marketPick(r, m).side;
  const [homeScore, awayScore] = MARKET_SCORES[m];
  const key = side === "away" ? awayScore : homeScore;
  return o.scores[key];
}

/** Valor esperado: p × odd − 1. Positivo = mercado paga acima do nosso modelo. */
function evPct(p: number, odd?: number): number | null {
  if (!odd || odd <= 1) return null;
  return p * odd - 1;
}



export type BuiltTicket = {
  market: BingoMarket;
  label: string;
  picks: { row: ScanRow; p: number; pick: string; side: "home" | "away" | null }[];
  jointProbability: number;
  avgProbability: number;
};

/** Média geométrica das probabilidades dos 4 jogos — base do nível de confiança. */
export function ticketGeo(t: BuiltTicket): number {
  return geoMean(t.picks.map((x) => x.p));
}

/** Nível de confiança do bilhete (calibrado pelo histórico quando houver dados). */
export function ticketConfidence(t: BuiltTicket, calib?: Calibration | null) {
  return ticketConfidenceFromGeo(ticketGeo(t), calib);
}



/**
 * Etapa 3 — recebe os 16 jogos aprovados no cruzamento e monta os 5 bilhetes
 * fixos com 4 jogos cada (20 vagas). Como só há 16 jogos, um mesmo jogo pode
 * repetir em até 3 bilhetes, sempre na linha em que tem maior convicção.
 */
function buildBingoTickets(rows: ScanRow[]): { pool: ScanRow[]; tickets: BuiltTicket[] } {
  const markets: BingoMarket[] = ["B1", "B2", "B3", "B4", "B5"];
  const ready = rows.filter((r) => r.ready);

  const fit = (r: ScanRow) => Math.max(...markets.map((m) => marketProb(r, m)));
  
  // Aumentamos o pool para garantir que sempre tenhamos jogos suficientes, mesmo que hajam apenas 3.
  const pool = [...ready].sort((a, b) => fit(b) - fit(a)).slice(0, Math.max(APPROVED_COUNT, ready.length));

  const chosen: Record<BingoMarket, BuiltTicket["picks"]> = { B1: [], B2: [], B3: [], B4: [], B5: [] };
  const uses = new Map<number, number>();
  const useCount = (id: number) => uses.get(id) ?? 0;

  const pairs = pool
    .flatMap((r) => markets.map((m) => ({ r, m, ...marketPick(r, m) })))
    .sort((a, b) => b.p - a.p);

  // Passadas progressivas: permitimos mais repetições se o pool for pequeno
  const maxReuse = pool.length < 4 ? 5 : MAX_TICKET_REUSE;

  for (let limit = 1; limit <= maxReuse; limit++) {
    for (const { r, m, p, pick, side } of pairs) {
      if (chosen[m].length >= TICKET_SIZE) continue;
      if (useCount(r.id) >= limit) continue;
      if (chosen[m].some((c) => c.row.id === r.id)) continue;
      chosen[m].push({ row: r, p, pick, side });
      uses.set(r.id, useCount(r.id) + 1);
    }
  }

  // Preenchimento forçado para garantir que os bilhetes tenham 4 jogos mesmo com poucos aprovados
  for (const m of markets) {
    while (chosen[m].length < TICKET_SIZE && pool.length > 0) {
      const candidates = pool
        .map((r) => ({ row: r, ...marketPick(r, m) }))
        .sort((a, b) => {
          const countA = useCount(a.row.id);
          const countB = useCount(b.row.id);
          if (countA !== countB) return countA - countB;
          return b.p - a.p;
        });
      
      const best = candidates[0];
      if (!best) break;
      chosen[m].push(best);
      uses.set(best.row.id, useCount(best.row.id) + 1);
    }
  }

  const tickets: BuiltTicket[] = markets.map((m) => {
    const picks = chosen[m].sort((a, b) => b.p - a.p);
    const jointProbability = picks.reduce((acc, x) => acc * x.p, 1);
    const avgProbability = picks.length ? picks.reduce((a, x) => a + x.p, 0) / picks.length : 0;
    return { market: m, label: MARKET_LABEL[m], picks, jointProbability, avgProbability };
  });

  return { pool, tickets };
}

// ---- Etapa 4: bilhetes mistos (verticais) — um mercado por jogo ----
export type MixedPick = {
  row: ScanRow;
  market: BingoMarket;
  p: number;
  pick: string;
  side: "home" | "away" | null;
};

export type MixedTicket = {
  code: string;
  label: string;
  picks: MixedPick[];
  jointProbability: number;
  avgProbability: number;
};

const MIXED_COUNT = 5;
const MIXED_SIZE = 4; // 4 jogos por rotação de mercado
const MIXED_MIN = 3;

/** Média geométrica das probabilidades do bilhete misto. */
export function mixedGeo(t: MixedTicket): number {
  return geoMean(t.picks.map((x) => x.p));
}

export function mixedConfidence(t: MixedTicket, calib?: Calibration | null) {
  return ticketConfidenceFromGeo(mixedGeo(t), calib);
}

/**
 * Monta 5 bilhetes "verticais": cada bilhete tem 4 jogos e cada jogo entra em
 * um mercado diferente (rotação B1..B5). Pares jogo+mercado repetidos entre
 * bilhetes são evitados para os mistos não ficarem parecidos.
 */
function buildMixedTickets(rows: ScanRow[]): MixedTicket[] {
  const markets: BingoMarket[] = ["B1", "B2", "B3", "B4", "B5"];
  const pool = rows.filter((r) => r.ready);
  if (pool.length < MIXED_MIN) return [];

  const usedPairs = new Set<string>();
  const globalUses = new Map<number, number>();
  const bump = (id: number) => globalUses.set(id, (globalUses.get(id) ?? 0) + 1);
  const uses = (id: number) => globalUses.get(id) ?? 0;



  const tickets: MixedTicket[] = [];
  for (let v = 0; v < MIXED_COUNT; v++) {
    const picks: MixedPick[] = [];
    const usedInTicket = new Set<number>();

    // 4 slots com rotação de mercado
    for (let k = 0; k < 4; k++) {
      const m = markets[(v + k) % markets.length];
      const candidates = pool
        .filter((r) => !usedInTicket.has(r.id))
        .map((r) => ({ r, ...marketPick(r, m) }))
        .filter((c) => c.p > 0)
        .sort((a, b) => {
          const aNew = usedPairs.has(`${a.r.id}:${m}`) ? 1 : 0;
          const bNew = usedPairs.has(`${b.r.id}:${m}`) ? 1 : 0;
          if (aNew !== bNew) return aNew - bNew;
          const du = uses(a.r.id) - uses(b.r.id);
          if (du !== 0) return du;
          return b.p - a.p;
        });
      const chosen = candidates[0];
      if (!chosen) continue;
      picks.push({ row: chosen.r, market: m, p: chosen.p, pick: chosen.pick, side: chosen.side });
      usedInTicket.add(chosen.r.id);
      usedPairs.add(`${chosen.r.id}:${m}`);
      bump(chosen.r.id);
    }




    if (picks.length < MIXED_MIN) continue;
    const jointProbability = picks.reduce((acc, x) => acc * x.p, 1);
    const avgProbability = picks.reduce((a, x) => a + x.p, 0) / picks.length;
    tickets.push({
      code: `V${v + 1}`,
      label:
        picks.length >= MIXED_SIZE
          ? `Misto · ${picks.length} jogos`
          : `Misto · ${picks.length} jogos (incompleto)`,
      picks,
      jointProbability,
      avgProbability,
    });
  }
  return tickets;
}





const JUNIOR_RE = /(u1[5-9]|u2[0-3]|sub[-\s]?1[5-9]|sub[-\s]?2[0-3]|youth|junior|reserve|women|femin|amateur|friendl)/i;

// status que não devem entrar em análise (adiado, cancelado, abandonado, WO, indefinido)
const INVALID_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO", "TBD"]);

// só entra jogo que ainda não começou (com 30 min de folga)
const notStartedYet = (f: ApiFixture) =>
  new Date(f.fixture.date).getTime() > Date.now() + 30 * 60_000;

const isUpcomingFixture = (f: ApiFixture) =>
  !LIVE_STATUSES.has(f.fixture.status.short) &&
  !FINISHED_STATUSES.has(f.fixture.status.short) &&
  !INVALID_STATUSES.has(f.fixture.status.short) &&
  notStartedYet(f) &&
  !JUNIOR_RE.test(`${f.league.name} ${f.teams.home.name} ${f.teams.away.name}`);

type PreloadPhase = "idle" | "fixtures" | "stats" | "ready";

export function BingaoClosurePanel() {
  const pinned = usePinnedSections();
  const ids = pinned.bingao;
  const [open, setOpen] = useState(true);
  const [generated, setGenerated] = useState(false);
  const [phase, setPhase] = useState<PreloadPhase>("idle");
  const [fxLoaded, setFxLoaded] = useState(0);
  const [statsLoaded, setStatsLoaded] = useState(0);
  const [statsTotal, setStatsTotal] = useState(0);
  const [fixtures, setFixtures] = useState<Record<number, ApiFixture | null>>({});
  const [teamStats, setTeamStats] = useState<Record<string, ApiTeamSeasonStats | null>>({});
  const runIdRef = useRef(0);

  const queryClient = useQueryClient();
  const fetchFixture = useServerFn(getFixture);
  const fetchTeamStats = useServerFn(getTeamSeasonStatistics);
  const fetchFixturesByDate = useServerFn(getFixturesByDate);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);
  const [criteriaMatch, setCriteriaMatch] = useState<CriteriaDetails | null>(null);
  const [scanDone, setScanDone] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);
  const [scanOpen, setScanOpen] = useState(true);
  const [levelOpen, setLevelOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Etapa 2 — seleção para comparação
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [crossing, setCrossing] = useState(false);
  const [crossDone, setCrossDone] = useState(0);
  const [crossMsg, setCrossMsg] = useState<string | null>(null);
  const [approvedRows, setApprovedRows] = useState<ScanRow[]>([]);
  // Odds reais (Betano) dos jogos aprovados — 1 chamada por jogo
  const [oddsMap, setOddsMap] = useState<Record<number, BingaoOdds | null>>({});
  const [oddsLoading, setOddsLoading] = useState(false);
  const fetchBingaoOdds = useServerFn(getBingaoOdds);
  const fetchBookmakerIds = useServerFn(getBookmakerFixtureIds);
  // Etapa 3 — encaixe nos 5 bilhetes fixos
  const [builtTickets, setBuiltTickets] = useState<BuiltTicket[] | null>(null);
  const [builtPool, setBuiltPool] = useState<ScanRow[]>([]);
  // Etapa 4 — bilhetes mistos (verticais)
  const [mixedTickets, setMixedTickets] = useState<MixedTicket[] | null>(null);
  const [justification, setJustification] = useState<string | null>(null);
  const [justLoading, setJustLoading] = useState(false);
  const askInsight = useServerFn(getAiInsight);
  const [savingFechamento, setSavingFechamento] = useState(false);

  const buildAll = (rows: ScanRow[]) => {
    const { pool, tickets } = buildBingoTickets(rows);
    setBuiltPool(pool);
    setBuiltTickets(tickets);
    setMixedTickets(buildMixedTickets(pool));
    setJustification(null);
  };

  /** Sinais medidos de um jogo, em texto curto. */
  const signalsOf = (r: ScanRow): string => {
    const gap = Math.abs(r.lambdaHome - r.lambdaAway);
    const s = criteriaScore(r);
    return (
      `λ ${r.lambdaTotal.toFixed(2)} · Δλ ${gap.toFixed(2)} · ` +
      `GM ${r.gfHome.toFixed(2)}/${r.gfAway.toFixed(2)} · GS ${r.gaHome.toFixed(2)}/${r.gaAway.toFixed(2)} · ` +
      `U1.5 ${Math.round(r.pUnder15 * 100)}% · nota ${s.score} (${s.tier})`
    );
  };

  /** Jogos vetados/cortados da varredura, com o motivo. */
  const vetoedRows = (): { r: ScanRow; why: string }[] =>
    scanRows
      .map((r) => ({ r, why: vetoReason(r) ?? blockReason(r) ?? "" }))
      .filter((x) => x.why)
      .sort((a, b) => b.r.lambdaTotal - a.r.lambdaTotal)
      .slice(0, 12);

  /** Texto de justificativa local (usado como fallback quando a IA falha). */
  const localJustification = (): string => {
    const t = builtTickets ?? [];
    const mx = mixedTickets ?? [];
    const all = [...t.flatMap((x) => x.picks.map((p) => p.row)), ...mx.flatMap((x) => x.picks.map((p) => p.row))];
    const uniq = Array.from(new Map(all.map((r) => [r.id, r])).values());
    const lam = uniq.length ? uniq.reduce((a, r) => a + r.lambdaTotal, 0) / uniq.length : 0;
    const conf = t.length ? Math.round((t.reduce((a, x) => a + x.avgProbability, 0) / t.length) * 100) : 0;
    const aprov = uniq
      .sort((a, b) => a.lambdaTotal - b.lambdaTotal)
      .map((r) => `• ${r.home} x ${r.away} — ${signalsOf(r)}`)
      .join("\n");
    const cortes = vetoedRows()
      .map((x) => `• ${x.r.home} x ${x.r.away} — ${x.why} (${signalsOf(x.r)})`)
      .join("\n");
    return (
      `Seleção com λ médio de ${lam.toFixed(2)} gols por jogo (teto obrigatório de 1.50) e piso de Under 1.5 em ${Math.round(MIN_U15 * 100)}%. ` +
      `O foco é Under 1.5 (B1), com placares 2x0 e 2x1 servindo de cobertura estratégica. ` +
      `${t.length} bilhetes fixos (probabilidade média de ${conf}%) e ${mx.length} mistos.\n\n` +
      `APROVADOS — sinais que passaram no filtro Under 1.5:\n${aprov || "—"}\n\n` +
      `BLOQUEADOS — vetos de maior risco de goleada:\n${cortes || "nenhum jogo vetado nesta varredura"}`
    );
  };

  const buildJustification = async (): Promise<string> => {
    if (justification) return justification;
    const picked = Array.from(
      new Map(
        [
          ...(builtTickets ?? []).flatMap((t) => t.picks.map((p) => p.row)),
          ...(mixedTickets ?? []).flatMap((t) => t.picks.map((p) => p.row)),
        ].map((r) => [r.id, r]),
      ).values(),
    );
    const ctx =
      `REGRAS: λ total obrigatoriamente < 1.50; U1.5 mínimo ${Math.round(MIN_U15 * 100)}%; ` +
      `veto por ataque/defesa ≥ 2.3 de média ou Δλ > 1.5 (favorito folgado).\n\n` +
      "JOGOS APROVADOS (sinais medidos):\n" +
      picked.map((r) => `- ${r.home} x ${r.away} [${r.league}] ${signalsOf(r)}`).join("\n") +
      "\n\nJOGOS BLOQUEADOS (motivo do veto):\n" +
      vetoedRows()
        .map((x) => `- ${x.r.home} x ${x.r.away} [${x.r.league}] VETO: ${x.why} | ${signalsOf(x.r)}`)
        .join("\n") +
      "\n\nBILHETES FIXOS:\n" +
      (builtTickets ?? [])
        .map(
          (t) =>
            `${t.market} (${t.label}): ` +
            t.picks.map((p) => `${p.row.home} x ${p.row.away} ${p.pick} ${(p.p * 100).toFixed(0)}%`).join(" | "),
        )
        .join("\n") +
      "\n\nMISTOS:\n" +
      (mixedTickets ?? [])
        .map(
          (t) =>
            `${t.code}: ` +
            t.picks.map((p) => `[${p.market}] ${p.row.home} x ${p.row.away} ${p.pick} ${(p.p * 100).toFixed(0)}%`).join(" | "),
        )
        .join("\n");
    try {
      setJustLoading(true);
      const r = await askInsight({ data: { kind: "bingao" as const, context: ctx.slice(0, 11000) } });
      const text = r.text?.trim() || localJustification();
      setJustification(text);
      return text;
    } catch {
      const text = localJustification();
      setJustification(text);
      return text;
    } finally {
      setJustLoading(false);
    }
  };


  const currentExport = (name: string, just?: string): ExportFechamento => {
    const proofRows = scanRows.filter((r) => compareIds.includes(r.id));
    const proof: ExportFechamento["proof"] = proofRows.map((r) => {
      const block = blockReason(r) || recentFailure(r);
      return {
        home: r.home,
        away: r.away,
        league: r.league,
        time: r.time,
        lambdaTotal: r.lambdaTotal,
        lambdaHome: r.lambdaHome,
        lambdaAway: r.lambdaAway,
        gfHome: r.gfHome,
        gaHome: r.gaHome,
        gfAway: r.gfAway,
        gaAway: r.gaAway,
        pUnder15: r.pUnder15,
        score: criteriaScore(r).score,
        status: block ? "RISCO ALTO" : "APROVADO",
        note: block || undefined,
      };
    });

    return {
      name,
      date: new Date().toLocaleDateString("pt-BR"),
      justification: just ?? justification ?? undefined,
      proof,
      tickets: (builtTickets ?? []).map((t) => ({
        market: t.market,
        label: t.label,
        picks: t.picks.map((p) => ({
          home: p.row.home,
          away: p.row.away,
          league: p.row.league,
          time: p.row.time,
          pick: p.pick,
          side: p.side,
          p: p.p,
        })),
      })),
      mixed: (mixedTickets ?? []).map((t) => ({
        market: t.code,
        label: t.label,
        picks: t.picks.map((p) => ({
          home: p.row.home,
          away: p.row.away,
          league: p.row.league,
          time: p.row.time,
          pick: p.pick,
          side: p.side,
          p: p.p,
          tag: p.market,
        })),
      })),
    };
  };




  const fetchMatchPreview = useServerFn(getMatchPreview);

  /**
   * Etapa 2 — cruza os 24 jogos com o cartão da coluna 3 (resumo / Match Preview:
   * últimos jogos, escanteios reais, BTTS, forma) e aprova os 16 melhores.
   */
  const runCrossCheck = async (passedRows?: ScanRow[], passedIds?: number[]) => {
    const activeRows = passedRows || scanRows;
    const activeIds = passedIds || compareIds;
    const rows = activeRows.filter((r) => activeIds.includes(r.id) && r.ready);
    if (rows.length < 2) return;
    setCrossing(true);
    setCrossDone(0);
    setCrossMsg(null);
    setCompareOpen(true);
    try {
      const results = await runBatched(rows, CROSS_CONCURRENCY, async (r) => {
        try {
          const prev = (await queryClient.ensureQueryData({
            queryKey: ["match-preview", r.homeId, r.awayId, 6],
            queryFn: () => fetchMatchPreview({ data: { homeId: r.homeId, awayId: r.awayId, last: 6 } }),
            staleTime: 45 * 60_000,
          })) as { home: TeamPreviewStats; away: TeamPreviewStats } | null;
          if (!prev?.home || !prev?.away) return { ...r, verified: false, cross: r.pUnder15 * 0.8 };
          const own = computeOwnPrediction(prev.home, prev.away);
          if (!own.ready) return { ...r, verified: false, cross: r.pUnder15 * 0.8 };
          // média entre o modelo da temporada (etapa 1) e o cartão da coluna 3
          const mix = (a: number, b: number) => (a + b) / 2;
          const merged: ScanRow = {
            ...r,
            pUnder15: mix(r.pUnder15, own.pUnder15),
            pDraw: mix(r.pDraw, own.pDraw),
            lambdaTotal: mix(r.lambdaTotal, own.expectedGoals),
            // escanteios reais dos últimos jogos substituem a estimativa por λ
            cornersLambda: own.lambdaCornersTotal > 0 ? own.lambdaCornersTotal : r.cornersLambda,
            pScores: { ...r.pScores },
            verified: true,
            sogHome: prev.home.shotsOnGoalAvg,
            sogAway: prev.away.shotsOnGoalAvg,
            recentGfHome: prev.home.goalsForAvg,
            recentGfAway: prev.away.goalsForAvg,
            recentGaHome: prev.home.goalsAgainstAvg,
            recentGaAway: prev.away.goalsAgainstAvg,
            csHome: prev.home.cleanSheetPct,
            csAway: prev.away.cleanSheetPct,
          };
          merged.recentBlock = recentFailure(merged);
          merged.block = blockReason(merged);
          for (const [label] of SCORES) {
            const fromCard = own.topScores.find((s) => s.label === label || s.label === label.replace("-", "x"))?.p;
            if (typeof fromCard === "number") merged.pScores[label] = mix(r.pScores[label] ?? 0, fromCard);
          }
          const markets: BingoMarket[] = ["B1", "B2", "B3", "B4", "B5"];
          merged.cross = Math.max(...markets.map((m) => marketProb(merged, m)));
          return merged;
        } catch {
          return { ...r, verified: false, cross: r.pUnder15 * 0.8 };
        }
      }, () => setCrossDone((n) => n + 1));

      const merged = results.filter(Boolean) as ScanRow[];
      // Trava obrigatória: gols esperados (λ total) precisam ficar abaixo do limite ajustado
      const overLambda = merged.filter((r) => !(r.lambdaTotal < MAX_LAMBDA_TOTAL));
      const underLambda = merged.filter((r) => r.lambdaTotal < MAX_LAMBDA_TOTAL);
      // perfil recente reprovado (finalizações / defesa / ataque) sai da lista — sem exceção
      const pool = underLambda.filter((r) => !r.recentBlock && !r.block);
      pool.sort((a, b) => Number(b.verified) - Number(a.verified) || b.pUnder15 - a.pUnder15);
      const approved = pool.slice(0, APPROVED_COUNT);
      setApprovedRows(approved);
      setBuiltTickets(null);
      setMixedTickets(null);
      setJustification(null);
      setBuiltPool([]);

      const ok = approved.filter((r) => r.verified).length;
      const cutMsg = overLambda.length
        ? ` · ${overLambda.length} cortado(s) por gols esperados ≥ ${MAX_LAMBDA_TOTAL.toFixed(2)}`
        : "";
      setCrossMsg(
        approved.length === 0
          ? `${merged.length} jogos cruzados · nenhum jogo com gols esperados abaixo de ${MAX_LAMBDA_TOTAL.toFixed(2)} passou no cruzamento.${cutMsg}`
          : `${merged.length} jogos cruzados com o cartão de resumo · ${approved.length} aprovados (${ok} com dados completos)${cutMsg} — prontos para "Gerar Fechamento IA".`,
      );
      loadOdds(approved);
      if (approved.length >= 3) {
        // Automação: Gera o fechamento automaticamente se houver jogos suficientes
        setTimeout(() => {
          buildAll(approved);
          setCurrentStep(3);
        }, 1500);
      }
    } catch {
      setCrossMsg("Falha no cruzamento com os cartões de resumo. Tente novamente.");
    } finally {
      setCrossing(false);
    }
  };

  /** Odds reais da Betano apenas para os jogos aprovados (1 chamada por jogo). */
  const loadOdds = async (rows: ScanRow[]) => {
    if (rows.length === 0) return;
    setOddsLoading(true);
    try {
      const out: Record<number, BingaoOdds | null> = {};
      await runBatched(rows, ODDS_CONCURRENCY, async (r) => {
        try {
          out[r.id] = (await queryClient.ensureQueryData({
            queryKey: ["bingao-odds", r.id],
            queryFn: () => fetchBingaoOdds({ data: { id: r.id } }),
            staleTime: 15 * 60_000,
          })) as BingaoOdds | null;
        } catch {
          out[r.id] = null;
        }
        return null;
      });
      setOddsMap((prev) => ({ ...prev, ...out }));
    } finally {
      setOddsLoading(false);
    }
  };




  const handleAutoScan = async () => {
    if (scanning) return;
    await scanUnder15();
  };

  // ---- Scanner Under 1.5: busca profunda dos próximos jogos e ranqueia por prob. de Under 1.5 ----
  const scanUnder15 = async () => {
    // começa sempre de zero: limpa etapas 1, 2, 3 e os jogos fixados do fechamento anterior
    resetPipeline(true);
    setScanning(true);
    setScanOpen(true);

    try {
      const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      // janela fixa: do clique até +24h
      const windowEnd = Date.now() + SCAN_WINDOW_MS;
      const isEligible = (f: ApiFixture) =>
        isUpcomingFixture(f) && new Date(f.fixture.date).getTime() <= windowEnd;



      const collected: ApiFixture[] = [];
      const seen = new Set<number>();
      // ids que a Betano realmente cobre (por data) — só esses entram no fechamento
      const betanoIds = new Set<number>();
      let betanoOk = false;
      // varre dia a dia até juntar SCAN_COUNT jogos COM mercado na Betano
      const betanoCount = () => collected.filter((f) => betanoIds.has(f.fixture.id)).length;
      for (let offset = 0; offset < SCAN_DAYS; offset++) {
        const dt = new Date();
        dt.setDate(dt.getDate() + offset);
        const dateStr = fmt(dt);
        const [day, ids] = await Promise.all([
          fetchFixturesByDate({ data: { date: dateStr } }) as Promise<ApiFixture[]>,
          queryClient
            .fetchQuery({
              queryKey: ["betano-fixture-ids", dateStr],
              queryFn: () => fetchBookmakerIds({ data: { date: dateStr, bookmaker: 32 } }),
              staleTime: 30 * 60_000,
            })
            .catch(() => [] as number[]) as Promise<number[]>,
        ]);
        for (const id of ids) betanoIds.add(id);
        if (ids.length > 0) betanoOk = true;
        for (const f of day.filter(isEligible)) {
          if (seen.has(f.fixture.id)) continue;
          seen.add(f.fixture.id);
          collected.push(f);
        }
        const have = betanoOk ? betanoCount() : collected.length;
        if (have >= SCAN_COUNT) break;
      }
      // só jogos com mercado na Betano (se a lista da casa falhar, mantém todos)
      const eligible = betanoOk ? collected.filter((f) => betanoIds.has(f.fixture.id)) : collected;
      const upcoming = eligible
        .sort((a, b) => {
          const ra = AUTOFILL_LEAGUES.indexOf(a.league.id);
          const rb = AUTOFILL_LEAGUES.indexOf(b.league.id);
          const r = (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
          if (r !== 0) return r;
          return new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime();
        })
        .slice(0, SCAN_COUNT);

      if (upcoming.length === 0) {
        setScanMsg(
          betanoOk
            ? "Nenhum jogo próximo com mercado na Betano encontrado."
            : "Nenhum jogo próximo encontrado para hoje.",
        );
        return;
      }


      // dedupe de times (team,league,season) para economizar chamadas
      const jobs = new Map<string, { team: number; league: number; season: number }>();
      for (const f of upcoming) {

        jobs.set(teamKey(f.teams.home.id, f.league.id, f.league.season), { team: f.teams.home.id, league: f.league.id, season: f.league.season });
        jobs.set(teamKey(f.teams.away.id, f.league.id, f.league.season), { team: f.teams.away.id, league: f.league.id, season: f.league.season });
      }
      const entries = Array.from(jobs.entries());
      setScanTotal(entries.length);

      const statsMap: Record<string, ApiTeamSeasonStats | null> = {};
      await runBatched(entries, STATS_CONCURRENCY, async ([key, input]) => {
        try {
          statsMap[key] = (await queryClient.ensureQueryData({
            queryKey: ["teamStats", input.team, input.league, input.season],
            queryFn: () => fetchTeamStats({ data: input }),
            staleTime: 6 * 60 * 60_000,
          })) as ApiTeamSeasonStats | null;
        } catch {
          statsMap[key] = null;
        }
        return null;
      }, () => setScanDone((n) => n + 1));


      const rows: ScanRow[] = upcoming.map((f) => {
        const hs = statsMap[teamKey(f.teams.home.id, f.league.id, f.league.season)] ?? null;
        const as = statsMap[teamKey(f.teams.away.id, f.league.id, f.league.season)] ?? null;
        const p = computePoisson(f, hs, as);
        // Fallback progressivo: se não tem estatística da temporada (hs/as null), 
        // usamos um valor neutro de 1.2 mas marcamos como s/ dados no ready.
        const gfHome = num(hs?.goals.for.average.home, 1.2);
        const gaHome = num(hs?.goals.against.average.home, 1.2);
        const gfAway = num(as?.goals.for.average.away, 1.0);
        const gaAway = num(as?.goals.against.average.away, 1.2);
        const base: CriteriaInput = {
          pUnder15: p.pUnder15,
          lambdaTotal: p.lambdaTotal,
          lambdaHome: p.lambdaHome,
          lambdaAway: p.lambdaAway,
          gfHome, gaHome, gfAway, gaAway,
          ready: p.ready,
        };
        return {
          id: f.fixture.id,
          home: f.teams.home.name,
          away: f.teams.away.name,
          homeId: f.teams.home.id,
          awayId: f.teams.away.id,
          league: f.league.name,
          time: f.fixture.date,
          pDraw: p.pDraw,
          pScores: p.pScores,
          cornersLambda: estimateCornersLambda(p.lambdaTotal),
          block: blockReason(base),
          ...base,
        };
      });
      // aprovados primeiro (filtro anti-goleada), depois melhor Under 1.5
      rows.sort((a, b) => Number(!!a.block) - Number(!!b.block) || b.pUnder15 - a.pUnder15);

      setScanRows(rows);
      // Etapa 1 → 2: só jogos com gols esperados abaixo do limite e aprovados nos filtros
      const approvedList = rows.filter((r) => r.ready && !r.block && r.lambdaTotal < MAX_LAMBDA_TOTAL);
      const topIds = approvedList.slice(0, COMPARE_COUNT).map((r) => r.id);
      setCompareIds(topIds);
      setApprovedRows([]);
      setBuiltTickets(null);
      setMixedTickets(null);
      setJustification(null);

      setCompareOpen(topIds.length > 0);
      const withData = rows.filter((r) => r.ready).length;
      const overLambda = rows.filter((r) => r.ready && !(r.lambdaTotal < MAX_LAMBDA_TOTAL)).length;
      const quotaWarn =
        withData < rows.length / 2
          ? " · atenção: a API não retornou parte das estatísticas (limite de requisições). Tente novamente em alguns instantes."
          : "";
      const thinWarn =
        approvedList.length > 0 && approvedList.length < 8
          ? " · atenção: poucos jogos realmente seguros hoje, considere esperar outra rodada."
          : approvedList.length === 0
            ? ` · nenhum jogo com gols esperados abaixo de ${MAX_LAMBDA_TOTAL.toFixed(2)} hoje.`
            : "";
      setScanMsg(
        `${rows.length} jogo(s) com mercado na Betano · ${withData} com estatísticas · ${overLambda} cortado(s) por gols esperados ≥ ${MAX_LAMBDA_TOTAL.toFixed(2)} · ${approvedList.length} aprovados · ${topIds.length} enviados para Auditoria Elite.${quotaWarn}${thinWarn}`,
      );

      if (topIds.length > 0) {
        setCurrentStep(2);
        // Automação: Avança para a Prova Real (Cruzamento) automaticamente
        setTimeout(() => {
          runCrossCheck(rows, topIds);
        }, 1500);
      }
    } catch {
      setScanMsg("Falha ao analisar os próximos jogos. Tente novamente.");
    } finally {
      setScanning(false);
    }
  };



  // Saved fechamentos (per-device, no login)
  const savedQuery = useQuery({
    queryKey: ["fechamentos"],
    queryFn: listFechamentos,
    staleTime: 30_000,
  });
  const saved: Fechamento[] = (Array.isArray(savedQuery.data) ? savedQuery.data : []).filter((f: Fechamento) => !f.name.startsWith("Beta"));
  const [viewingSavedId, setViewingSavedId] = useState<string | null>(null);
  const calibration = useMemo<Calibration>(() => buildCalibration(saved), [saved]);
  const viewingSaved = viewingSavedId ? saved.find((f) => f.id === viewingSavedId) ?? null : null;

  const saveMut = useMutation({
    mutationFn: saveFechamento,
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["fechamentos"] });
      setViewingSavedId((row as Fechamento).id);
    },
  });
  const deleteMut = useMutation({
    mutationFn: deleteFechamento,
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ["fechamentos"] });
      if (viewingSavedId === (id as unknown as string)) setViewingSavedId(null);
    },
  });

  const teamKey = (team: number, league: number, season: number) => `${team}:${league}:${season}`;

  const runPreload = async () => {
    if (ids.length === 0) return;
    const myRun = ++runIdRef.current;
    setPhase("fixtures");
    setFxLoaded(0);
    setStatsLoaded(0);
    setStatsTotal(0);

    // 1) Fixtures — batches of 6
    const fxResults = await runBatched(ids, 6, async (id) => {
      const data = await queryClient.fetchQuery({
        queryKey: ["fixture", id],
        queryFn: () => fetchFixture({ data: { id } }),
        staleTime: 60_000,
      });
      return { id, data: data as ApiFixture | null };
    }, () => { if (runIdRef.current === myRun) setFxLoaded((n) => n + 1); });
    if (runIdRef.current !== myRun) return;

    const fxMap: Record<number, ApiFixture | null> = {};
    for (const r of fxResults) if (r) fxMap[r.id as number] = r.data;
    setFixtures(fxMap);

    // 2) Team stats — dedupe by (team,league,season), lotes paralelos com retry
    const teamJobs = new Map<string, { team: number; league: number; season: number }>();
    for (const fx of Object.values(fxMap)) {
      if (!fx) continue;
      const s = fx.league.season;
      const l = fx.league.id;
      teamJobs.set(teamKey(fx.teams.home.id, l, s), { team: fx.teams.home.id, league: l, season: s });
      teamJobs.set(teamKey(fx.teams.away.id, l, s), { team: fx.teams.away.id, league: l, season: s });
    }
    const jobs = Array.from(teamJobs.entries());
    setStatsTotal(jobs.length);
    setPhase("stats");

    const statsMap: Record<string, ApiTeamSeasonStats | null> = {};
    await runBatched(jobs, STATS_CONCURRENCY, async ([key, input]) => {
      let last: ApiTeamSeasonStats | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          last = (await queryClient.ensureQueryData({
            queryKey: ["team-stats", input.team, input.league, input.season],
            queryFn: () => fetchTeamStats({ data: input }),
            staleTime: 6 * 60 * 60_000,
          })) as ApiTeamSeasonStats | null;
          if (last) break;
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
      statsMap[key] = last;
    }, () => { if (runIdRef.current === myRun) setStatsLoaded((n) => n + 1); });
    if (runIdRef.current !== myRun) return;

    setTeamStats(statsMap);
    setPhase("ready");
  };

  // Sem carregamento automático: só carrega quando o usuário aciona (busca de jogos / Gerar Fechamento)
  useEffect(() => {
    if (ids.length === 0) { setPhase("idle"); setGenerated(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  // Limpa toda a esteira (etapas 1, 2 e 3) para começar um novo fechamento
  const resetPipeline = (clearPinned = true) => {
    setScanRows([]);
    setScanMsg(null);
    setScanDone(0);
    setScanTotal(0);
    setCompareIds([]);
    setCompareOpen(false);
    setApprovedRows([]);
    setOddsMap({});
    setCrossMsg(null);
    setCrossDone(0);
    setBuiltTickets(null);
    setMixedTickets(null);
    setJustification(null);
    setBuiltPool([]);

    setGenerated(false);
    setAutoMsg(null);
    setCurrentStep(1);
    setJustification(null);
    if (clearPinned) setPinnedFixtures("bingao", []);
  };


  // Automação: Executa a varredura automaticamente ao abrir a aba
  useEffect(() => {
    if (scanRows.length === 0 && !scanning) {
      handleAutoScan();
    }
  }, []);

  const enriched: Enriched[] = useMemo(() => {
    return ids.map((id: number) => {
      const fx = fixtures[id] ?? null;
      let home: ApiTeamSeasonStats | null = null;
      let away: ApiTeamSeasonStats | null = null;
      if (fx) {
        home = teamStats[teamKey(fx.teams.home.id, fx.league.id, fx.league.season)] ?? null;
        away = teamStats[teamKey(fx.teams.away.id, fx.league.id, fx.league.season)] ?? null;
      }
      return { id, fixture: fx, homeStats: home, awayStats: away, ...computePoisson(fx, home, away) };
    });
  }, [ids, fixtures, teamStats]);

  const missingStats = enriched.filter((e) => !e.ready).length;
  const isPreloading = phase === "fixtures" || phase === "stats";
  const canGenerate = phase === "ready" && ids.length >= 3;

  const eligible = enriched
    .filter((e) => e.ready && e.pUnder15 >= 0.25)
    .sort((a, b) => a.lambdaTotal - b.lambdaTotal);
  const selected = generated ? eligible.slice(0, Math.max(3, eligible.length)) : [];

  const tickets = useMemo(() => {
    if (selected.length < 3) return [];
    const pickBest = (labels: string[]) => {
      let best = { game: selected[0], p: 0, label: labels[0] };
      for (const g of selected) for (const lb of labels) {
        const p = g.pScores[lb] ?? 0;
        if (p > best.p) best = { game: g, p, label: lb };
      }
      return best;
    };
    const t1 = pickBest(["1-0", "0-1"]);
    const t2 = pickBest(["2-0", "0-2"]);
    const t3 = pickBest(["2-1", "1-2"]);
    const drawBest = (() => {
      let best = selected[0]; let bestP = 0;
      for (const g of selected) {
        const pDraw = (g.pScores["0-0"] ?? 0) + (g.pScores["1-1"] ?? 0) + (g.pScores["2-2"] ?? 0);
        if (pDraw > bestP) { best = g; bestP = pDraw; }
      }
      return { game: best, p: bestP };
    })();
    const conf = (p: number) => Math.round(Math.min(99, p * 100 * 2.5));
    return [
      { n: 1, type: "Fixo", label: `Placar ${t1.label.replace("-", "x")}`, detail: `Under 1.5 (soma ≤ 1) · ${t1.game.fixture?.teams.home.name} × ${t1.game.fixture?.teams.away.name}`, conf: conf(t1.p) },
      { n: 2, type: "Fixo", label: `Placar ${t2.label.replace("-", "x")}`, detail: `Over 1.5 · placar cobertura (soma 2) · ${t2.game.fixture?.teams.home.name} × ${t2.game.fixture?.teams.away.name}`, conf: conf(t2.p) },
      { n: 3, type: "Fixo", label: `Placar ${t3.label.replace("-", "x")}`, detail: `Over 1.5 · placar cobertura (soma 3) · ${t3.game.fixture?.teams.home.name} × ${t3.game.fixture?.teams.away.name}`, conf: conf(t3.p) },
      { n: 4, type: "Aposta Criada", label: "Empate + Over 9.5 escanteios", detail: `${drawBest.game.fixture?.teams.home.name} × ${drawBest.game.fixture?.teams.away.name}`, conf: Math.round(Math.min(99, drawBest.p * 100 * 1.8)) },
      { n: 5, type: "Aposta Criada", label: "Empate + Under 9.5 escanteios", detail: `${drawBest.game.fixture?.teams.home.name} × ${drawBest.game.fixture?.teams.away.name}`, conf: Math.round(Math.min(99, drawBest.p * 100 * 1.8)) },
    ];
  }, [selected]);

  const progressPct = phase === "fixtures"
    ? Math.round((fxLoaded / Math.max(1, ids.length)) * 100)
    : phase === "stats"
      ? Math.round((statsLoaded / Math.max(1, statsTotal)) * 100)
      : phase === "ready" ? 100 : 0;

  return (
    <>
    <div className="mx-3 mb-3 flex justify-end">
      <button
        onClick={() => setLevelOpen((v) => !v)}
        title="Nível da IA — conferência automática dos fechamentos salvos"
        className={`text-xs font-bold px-4 py-2 rounded-full border flex items-center gap-1.5 ${
          levelOpen
            ? "bg-fuchsia-500/25 text-fuchsia-100 border-fuchsia-400/50"
            : "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30 hover:bg-fuchsia-500/20"
        }`}
      >
        <Brain className="w-3.5 h-3.5" /> Nível da IA
      </button>
    </div>

    {levelOpen && (
      <>
        {/* Resumo da Justificativa da IA (mais compacto) */}
        {(justification || justLoading) && (
          <div className="mx-3 mb-2 rounded-2xl bg-blue-600/5 border border-blue-600/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                <Brain className="w-3.5 h-3.5" />
                Justificativa da IA
              </div>
              {justLoading && (
                <div className="flex items-center gap-1 text-[10px] text-blue-400/60 italic">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  Gerando análise...
                </div>
              )}
            </div>
            <div className="text-[11px] leading-relaxed text-muted-foreground/90 line-clamp-4">
              {justification || "Aguardando processamento dos jogos para análise detalhada de sinais e vetos..."}
            </div>
          </div>
        )}
        <AiLevelPanel />
      </>
    )}



    <div className="mx-3 mb-4 rounded-[2rem] bg-gradient-to-br from-neutral-900/90 to-black border border-white/5 overflow-hidden shadow-2xl">
      {/* Stepper Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        {[
          { step: 1, label: "Varredura", icon: Search },
          { step: 2, label: "Prova Real", icon: ShieldCheck },
          { step: 3, label: "Fechamento", icon: Calculator },
          { step: 4, label: "Relatório IA", icon: ClipboardList },
        ].map((s, i) => (
          <div key={s.step} className="flex items-center group">
            <div className="flex flex-col items-center gap-1.5 relative">
              {s.step === 1 && (scanning || scanRows.length > 0) && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-600/20 border border-blue-500/30 animate-pulse z-20 whitespace-nowrap">
                  <span className="w-1 h-1 rounded-full bg-blue-400" />
                  <span className="text-[7px] font-black text-blue-400 uppercase tracking-widest">Robô OneOption Ativo</span>
                </div>
              )}
              <div 
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                  currentStep >= s.step 
                    ? "bg-blue-600 text-white shadow-[0_0_15px_rgba(234,88,12,0.4)]" 
                    : "bg-white/5 text-white/30 border border-white/10"
                }`}
              >
                <s.icon className="w-5 h-5" />
              </div>
              <span className={`text-[10px] font-black uppercase tracking-tighter ${
                currentStep >= s.step ? "text-blue-400" : "text-white/20"
              }`}>
                {s.label}
              </span>
            </div>
            {i < 3 && (
              <div className={`w-8 h-[2px] mb-4 mx-2 rounded-full transition-colors duration-500 ${
                currentStep > s.step ? "bg-blue-600/50" : "bg-white/5"
              }`} />
            )}
          </div>
        ))}
      </div>


      <div className="px-6 pb-6 pt-4">
        {/* Step 1: Varredura */}
        {currentStep === 1 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center shrink-0">
                <Search className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white leading-tight uppercase tracking-tight">Varredura Estratégica</h3>
                <p className="text-xs text-neutral-400 mt-1">Busca profunda por padrões Under 1.5 nas próximas 24h.</p>
              </div>
            </div>

            {scanMsg && (
              <div className="mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 text-[11px] leading-relaxed text-neutral-300">
                <div className="flex items-center gap-2 mb-1.5 text-blue-400 font-bold uppercase tracking-wider">
                  <Info className="w-3.5 h-3.5" /> Resultado da Varredura
                </div>
                {scanMsg}
              </div>
            )}

            <button
              onClick={async () => {
                await scanUnder15();
                // O scanUnder15 já lida com o estado scanning interna ou externamente.
                // Se o scan completar com sucesso e houver resultados, mostramos a lista.
              }}
              disabled={scanning}
              className="w-full h-14 rounded-2xl bg-blue-600 text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all hover:brightness-110 active:scale-[0.98] shadow-xl shadow-blue-500/20 disabled:opacity-40"
            >
              {scanning ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  ANALISANDO MERCADOS...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  INICIAR VARREDURA (UNDER 1.5)
                </>
              )}
            </button>
          </div>
        )}

        {/* Step 2: Prova Real */}
        {currentStep === 2 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-black text-white leading-tight uppercase tracking-tight">Prova Real (Auditoria Elite)</h3>
                <p className="text-xs text-neutral-400 mt-1">Cruzamento rigoroso de médias históricas com performance em tempo real.</p>
              </div>
              <div className="px-3 py-1 rounded-full bg-blue-600/10 border border-blue-600/20 text-[10px] font-black text-blue-400 uppercase">
                {compareIds.length} Jogos na Fila
              </div>
            </div>

            {/* Lista de Jogos em Auditoria */}
            <div className="space-y-3 mb-6 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {scanRows
                .filter((r) => compareIds.includes(r.id))
                .map((r) => {
                  const s = criteriaScore(r);
                  return (
                    <div key={r.id} className="p-3 rounded-2xl bg-white/5 border border-white/10 hover:border-blue-500/30 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-0.5">{r.league}</div>
                          <div className="text-sm font-bold text-white leading-tight">{r.home} x {r.away}</div>
                        </div>
                        <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          s.tier === 'SEGURO' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          s.tier === 'MÉDIO' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {s.tier}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[9px] text-neutral-400">
                        <div>λ <span className="text-white font-bold">{r.lambdaTotal.toFixed(2)}</span></div>
                        <div>U1.5 <span className="text-white font-bold">{Math.round(r.pUnder15 * 100)}%</span></div>
                        <div>GM <span className="text-white font-bold">{r.gfHome.toFixed(1)}/{r.gfAway.toFixed(1)}</span></div>
                        <div>GS <span className="text-white font-bold">{r.gaHome.toFixed(1)}/{r.gaAway.toFixed(1)}</span></div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {crossMsg && (
              <div className="mb-6 p-4 rounded-2xl bg-blue-600/5 border border-blue-600/20 text-[11px] leading-relaxed text-neutral-300">
                <div className="flex items-center gap-2 mb-1.5 text-blue-400 font-bold uppercase tracking-wider">
                  <Info className="w-3.5 h-3.5" /> Relatório de Auditoria
                </div>
                {crossMsg}
              </div>
            )}

            <button
              onClick={() => runCrossCheck()}
              disabled={crossing || compareIds.length === 0}
              className="w-full h-14 rounded-2xl bg-blue-600 text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all hover:bg-blue-500 active:scale-[0.98] shadow-xl shadow-blue-900/30 disabled:opacity-40"
            >
              {crossing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  EXECUTANDO AUDITORIA ({crossDone}/{compareIds.length})...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5" />
                  EXECUTAR PROVA REAL
                </>
              )}
            </button>
            <button 
              onClick={() => setCurrentStep(1)}
              className="w-full mt-3 text-[10px] font-bold text-neutral-500 uppercase tracking-widest hover:text-neutral-300 transition-colors"
            >
              Voltar para Varredura
            </button>
          </div>
        )}

        {/* Step 3: Fechamento */}
        {currentStep === 3 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center shrink-0">
                <Calculator className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white leading-tight uppercase tracking-tight">Gerar Fechamento IA</h3>
                <p className="text-xs text-neutral-400 mt-1">Montagem estratégica de 10 bilhetes (5 fixos + 5 mistos).</p>
              </div>
            </div>

            <div className="mb-6 p-4 rounded-2xl bg-blue-600/5 border border-blue-600/20">
              <div className="text-[11px] font-bold text-blue-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> Filtro de Segurança
              </div>
              <p className="text-[11px] text-neutral-300 leading-relaxed">
                {approvedRows.length} jogos aprovados na Prova Real. O sistema agora irá distribuir estes jogos em mercados estratégicos para maximizar o lucro.
              </p>
            </div>

            <button
              onClick={async () => {
                const { pool } = buildBingoTickets(approvedRows);
                buildAll(approvedRows);
                setPinnedFixtures("bingao", pool.map((r) => r.id));
                setGenerated(true);
                setCurrentStep(4);
              }}
              className="w-full h-14 rounded-2xl bg-blue-600 text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all hover:bg-blue-500 active:scale-[0.98] shadow-xl shadow-blue-900/30"
            >
              <Sparkles className="w-5 h-5" />
              GERAR 10 BILHETES ESTRATÉGICOS
            </button>
            <button 
              onClick={() => setCurrentStep(2)}
              className="w-full mt-3 text-[10px] font-bold text-neutral-500 uppercase tracking-widest hover:text-neutral-300 transition-colors"
            >
              Voltar para Prova Real
            </button>
          </div>
        )}

        {/* Step 4: Relatório IA */}
        {currentStep === 4 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center shrink-0">
                <ClipboardList className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white leading-tight uppercase tracking-tight">Relatório de Operação</h3>
                <p className="text-xs text-neutral-400 mt-1">Finalização, salvamento e exportação dos bilhetes.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                onClick={async () => {
                  const just = await buildJustification();
                  printFechamento(currentExport("Relatório Bingão IA", just));
                }}
                disabled={justLoading}
                className="h-12 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/10 transition-all"
              >
                {justLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Exportar PDF
              </button>
              <button
                onClick={async () => {
                  const just = await buildJustification();
                  shareFechamentoWhatsApp(currentExport("Bingão IA", just));
                }}
                disabled={justLoading}
                className="h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-emerald-500/20 transition-all"
              >
                {justLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                WhatsApp
              </button>
            </div>

            <button
              onClick={async () => {
                setSavingFechamento(true);
                try {
                  const just = await buildJustification();
                  const nextNum = saved.length + 1;
                  const exp = currentExport(`Fechamento ${nextNum}`, just);
                  await saveMut.mutateAsync({
                    name: exp.name,
                    target_date: new Date().toISOString().split("T")[0],
                    games: (approvedRows.length ? approvedRows : selected).map((r: any) => ({ 
                      id: r.id, 
                      home: r.home || r.fixture?.teams?.home?.name || "Time Casa", 
                      away: r.away || r.fixture?.teams?.away?.name || "Time Fora", 
                      league: r.league || r.fixture?.league?.name 
                    })),
                    tickets: tickets.length ? tickets : [],
                    summary: exp as any,
                  });
                  setLevelOpen(true);
                } finally {
                  setSavingFechamento(false);
                }
              }}
              disabled={savingFechamento || justLoading}
              className="w-full h-14 rounded-2xl bg-blue-600 text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all hover:brightness-110 active:scale-[0.98] shadow-xl shadow-blue-500/20"
            >
              {savingFechamento ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              SALVAR E MONITORAR (NÍVEL IA)
            </button>
            
            <button 
              onClick={() => resetPipeline(true)}
              className="w-full mt-3 text-[10px] font-bold text-neutral-500 uppercase tracking-widest hover:text-neutral-300 transition-colors"
            >
              Iniciar Novo Fechamento
            </button>
          </div>
        )}
      </div>

      {/* Fixture Selector (Optional visual link) */}
      {currentStep === 1 && ids.length > 0 && (
        <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5">
          <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2 flex items-center gap-2">
            <ListOrdered className="w-3.5 h-3.5" /> Jogos na Varredura ({ids.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {ids.slice(0, 5).map((id) => (
              <div key={id} className="px-2 py-1 rounded bg-white/5 border border-white/5 text-[9px] text-neutral-400">
                #{id}
              </div>
            ))}
            {ids.length > 5 && <div className="text-[9px] text-neutral-600 self-center">+{ids.length - 5}</div>}
          </div>
        </div>
      )}
    </div>



    {/* Ranking Section */}
    <div className="mx-3 mt-4">

      




      {autoMsg && (
        <div className="px-3 pb-2 text-[11px] text-blue-300">{autoMsg}</div>
      )}

      {currentStep === 1 && (scanning || scanRows.length > 0 || scanMsg) && (
        <div className="px-3 pb-3">
          <div className="rounded-xl bg-black/30 border border-blue-500/20 overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-white/5">
              <ListOrdered className="w-3.5 h-3.5 text-blue-300" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-blue-200">Ranking Under 1.5 · {scanRows.length || SCAN_COUNT} jogos</div>
                {scanMsg && <div className="text-[10px] text-muted-foreground truncate">{scanMsg}</div>}
              </div>
              {scanRows.length > 0 && (
                <>
                  <button
                    onClick={() => runCrossCheck()}
                    disabled={compareIds.length < 3 || compareIds.length > 6 || crossing}
                    title={compareIds.length < 3 ? "Selecione pelo menos 3 jogos APROVADOS" : "Cruzar e validar Prova Real"}
                    className={`text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${
                      compareIds.length >= 3 && compareIds.length <= 6
                        ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/50 hover:bg-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                        : "bg-white/5 text-muted-foreground border-white/10 cursor-not-allowed"
                    }`}
                  >
                    Comparar ({compareIds.length}/3-6)
                  </button>

                  {compareIds.length > 0 && (
                    <button
                      onClick={() => { setCompareIds([]); setCompareOpen(false); }}
                      title="Limpar seleção"
                      className="text-[10px] px-2 py-1 rounded-full border border-white/10 text-muted-foreground hover:text-foreground"
                    >
                      Limpar seleção
                    </button>
                  )}
                  <button onClick={() => { setScanRows([]); setCompareIds([]); setCompareOpen(false); }} title="Limpar lista" className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button onClick={() => setScanOpen((v) => !v)} className="w-6 h-6 flex items-center justify-center text-muted-foreground">
                {scanOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {scanning && (
              <div className="px-2.5 py-2">
                <div className="text-[10px] text-muted-foreground mb-1">
                  Analisando estatísticas… {scanDone}/{scanTotal || "…"}
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-blue-400 transition-all" style={{ width: `${scanTotal ? Math.round((scanDone / scanTotal) * 100) : 5}%` }} />
                </div>
              </div>
            )}

            {scanOpen && scanRows.length > 0 && (
              <div className="max-h-[70vh] overflow-y-auto divide-y divide-white/5">
                {scanRows.map((r, i) => {
                  const u15 = Math.round(r.pUnder15 * 100);
                  // único mercado do Bingão: Under 1.5
                  const u15Under = r.pUnder15 >= 0.5;
                  const u15Pct = u15Under ? u15 : 100 - u15;
                  const u15Strong = u15Pct >= 65;
                  const block = blockReason(r);
                  return (
                    <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <span className="w-5 text-[10px] text-muted-foreground text-right">{i + 1}</span>
                      
                      <div className="flex flex-col gap-1 shrink-0 w-[92px]">
                        {r.ready ? (
                          <>
                            <span
                              className={`text-center text-[10px] font-bold px-1 py-0.5 rounded border tabular-nums ${
                                u15Under
                                  ? u15Strong
                                    ? "text-emerald-200 border-emerald-400/60 bg-emerald-500/20"
                                    : "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                                  : u15Strong
                                    ? "text-rose-200 border-rose-400/60 bg-rose-500/20"
                                    : "text-rose-300 border-rose-500/30 bg-rose-500/10"
                              }`}
                              title={`Linha 1.5 gols · Poisson + Dixon-Coles · λ total ${r.lambdaTotal.toFixed(2)}`}
                            >
                              UNDER 1.5 {u15Pct}%
                            </span>
                            <span 
                              className={`text-[8px] font-black py-0.5 rounded text-center border ${
                                block 
                                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40" 
                                  : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                              }`}
                            >
                              {block ? "RISCO ALTO" : "APROVADO"}
                            </span>
                          </>
                        ) : (
                          <span className="text-center text-[10px] font-bold px-1 py-0.5 rounded border border-white/10 bg-white/5 text-muted-foreground">
                            s/ dados
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium truncate flex items-center gap-1">
                          <span className="truncate">{r.home} × {r.away}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setCriteriaMatch({
                                home: r.home, away: r.away, league: r.league,
                                ready: r.ready, lambdaTotal: r.lambdaTotal,
                                lambdaHome: r.lambdaHome, lambdaAway: r.lambdaAway,
                                gfHome: r.gfHome, gaHome: r.gaHome, gfAway: r.gfAway, gaAway: r.gaAway,
                                pUnder15: r.pUnder15,
                                sogHome: r.sogHome, sogAway: r.sogAway,
                                recentGfHome: r.recentGfHome, recentGfAway: r.recentGfAway,
                                recentGaHome: r.recentGaHome, recentGaAway: r.recentGaAway,
                                csHome: r.csHome, csAway: r.csAway,
                              })
                            }
                            title="Ver detalhes dos critérios (λ, Δλ, GM/GS, Under 1.5)"
                            className={`shrink-0 text-[8px] font-bold px-1 py-px rounded border hover:brightness-125 ${
                              block
                                ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                                : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                            }`}
                          >
                            {block ?? "ok"} <Info className="inline w-2.5 h-2.5 -mt-px" />
                          </button>
                        </div>

                        <div className="text-[10px] text-muted-foreground truncate">
                          {r.league} · {new Date(r.time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {r.ready && <> · λ {r.lambdaHome.toFixed(2)}/{r.lambdaAway.toFixed(2)}</>}
                        </div>
                      </div>


                      {r.ready ? (
                        <div className="shrink-0 text-right text-[9px] leading-tight tabular-nums text-muted-foreground">
                          <div>U1.5 <span className="text-foreground font-semibold">{(r.pUnder15 * 100).toFixed(0)}%</span></div>
                          <div>λ {r.lambdaTotal.toFixed(2)}</div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}

                      <button
                        onClick={() => {
                          if (block) {
                            alert(`BLOQUEADO: Este jogo foi classificado como RISCO ALTO (${block}). Selecione apenas jogos APROVADOS.`);
                            return;
                          }
                          setCompareIds((prev) => {
                            if (prev.includes(r.id as number)) return prev.filter((x) => x !== r.id);
                            if (prev.length >= 6) {
                              alert("Selecione no máximo 6 jogos para a Prova Real.");
                              return prev;
                            }
                            return [...prev, r.id];
                          });
                        }}
                        title={compareIds.includes(r.id) ? "Remover da comparação" : block ? "Jogo Bloqueado (Risco Alto)" : "Selecionar para comparar"}
                         className={`w-6 h-6 flex items-center justify-center rounded-full border transition-all ${
                          compareIds.includes(r.id)
                            ? "bg-blue-600/25 border-blue-400 text-blue-200"
                            : block
                              ? "border-rose-500/20 text-rose-500/30 cursor-not-allowed"
                              : "border-white/10 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Pin className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {currentStep === 2 && (
        <div className="px-3 pb-3">
          <div className="rounded-xl bg-black/30 border border-blue-600/30 overflow-hidden">
            <div className="flex flex-col gap-2 p-2.5 border-b border-white/5 bg-blue-600/5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-blue-300 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> PROVA REAL: Relatório de Validação
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {crossing
                      ? `Cruzando com o cartão de resumo… ${crossDone}/${compareIds.length}`
                      : oddsLoading
                        ? "Buscando odds da Betano dos jogos aprovados…"
                        : crossMsg ?? "Verificação concluída nos jogos selecionados."}
                  </div>
                </div>
              </div>

              {approvedRows.length >= 3 && !crossing && (
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {approvedRows.map(r => {
                    return (
                      <div key={r.id} className="bg-black/40 border border-blue-600/20 rounded-lg p-1.5 text-[9px]">
                        <div className="font-bold truncate text-blue-200">{r.home} x {r.away}</div>
                        <div className="flex items-center justify-between text-muted-foreground mt-0.5">
                          <span>λ {r.lambdaTotal.toFixed(2)} · Δλ {Math.abs(r.lambdaHome - r.lambdaAway).toFixed(2)}</span>
                          <span className="text-blue-400 font-black">OK</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2">
              {approvedRows.length > 0 && !crossing && (
                <button
                  onClick={() => loadOdds(approvedRows)}
                  disabled={oddsLoading}
                  title="Buscar odds reais da Betano para os jogos aprovados (1 chamada por jogo)"
                  className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 flex items-center gap-1"
                >
                  {oddsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>🎰</span>}
                  Odds Betano
                </button>
              )}
              {approvedRows.length >= 3 && (
                <button
                  onClick={() => buildAll(approvedRows)}
                  title="Montar os 5 bilhetes fixos + 5 bilhetes mistos com os jogos aprovados"
                  className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-600/25 text-blue-100 border border-blue-400/50 hover:bg-blue-600/40"
                >
                  Montar 10 bilhetes
                </button>
              )}

              <button
                onClick={() => {
                  const list = builtPool.length
                    ? builtPool.map((r) => r.id)
                    : (approvedRows.length ? approvedRows : scanRows.filter((r) => compareIds.includes(r.id))).map((r) => r.id);
                  if (!list.length) return;
                  setViewingSavedId(null);
                  setGenerated(false);
                  setPinnedFixtures("bingao", list);
                  setAutoMsg(`${list.length} jogos fixados no Bingão.`);
                }}
                className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-600/20 text-blue-400 border border-blue-600/40 hover:bg-blue-600/30"
              >
                Fixar no Bingão
              </button>
              <button
                onClick={() => setCompareOpen(false)}
                title="Fechar comparação"
                className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </div>

            {crossing && (
              <div className="px-2.5 py-2">
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-blue-400 transition-all" style={{ width: `${compareIds.length ? Math.round((crossDone / compareIds.length) * 100) : 5}%` }} />
                </div>
              </div>
            )}

            <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/5">
              {(approvedRows.length ? approvedRows : scanRows.filter((r) => compareIds.includes(r.id)))
                .map((r) => {

                  const markets = [
                    { label: "UNDER 1.5", p: r.pUnder15 },
                  ];
                  const best = [...markets].sort((a, b) => b.p - a.p)[0];
                  return { r, markets, best };
                })
                .sort((a, b) => (b.r.ready ? b.best.p : -1) - (a.r.ready ? a.best.p : -1))
                .map(({ r, markets, best }, i) => (
                  <div key={r.id} className="px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-[10px] text-muted-foreground text-right">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium truncate">{r.home} × {r.away}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {r.league} · {new Date(r.time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {r.ready && <> · λ {r.lambdaTotal.toFixed(2)}</>}
                        </div>
                        {(() => {
                          const o = oddsMap[r.id];
                          if (!o) return null;
                          const items: { k: string; odd?: number; p: number }[] = [
                            { k: "U1.5", odd: o.under15, p: r.pUnder15 },
                          ].filter((x) => x.odd);
                          if (items.length === 0) return null;
                          return (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              <span className="text-[8px] uppercase tracking-wider text-muted-foreground">{o.bookmaker}</span>
                              {items.map((x) => {
                                const ev = evPct(x.p, x.odd);
                                return (
                                  <span
                                    key={x.k}
                                    className={`text-[9px] font-bold px-1 py-0.5 rounded tabular-nums border ${
                                      ev !== null && ev > 0
                                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                        : "bg-white/5 text-muted-foreground border-white/10"
                                    }`}
                                    title={ev !== null ? `Valor esperado ${(ev * 100).toFixed(0)}%` : undefined}
                                  >
                                    {x.k} {x.odd!.toFixed(2)}
                                    {ev !== null && <> · {ev > 0 ? "+" : ""}{(ev * 100).toFixed(0)}%</>}
                                  </span>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${
                          r.ready
                            ? "text-blue-200 border-blue-400/50 bg-blue-600/20"
                            : "text-muted-foreground border-white/10 bg-white/5"
                        }`}
                      >
                        {r.ready ? `${best.label} ${Math.round(best.p * 100)}%` : "s/ dados"}
                      </span>
                      <button
                        onClick={() => setCompareIds((prev) => prev.filter((x) => x !== r.id))}
                        title="Remover da comparação"
                        className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {r.ready && (
                      <div className="mt-1.5 pl-7 space-y-1">
                        {markets.map((m) => (
                          <div key={m.label} className="flex items-center gap-2">
                            <span className="w-[64px] text-[9px] text-muted-foreground">{m.label}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className={`h-full ${m.label === best.label ? "bg-blue-400" : "bg-white/25"}`}
                                style={{ width: `${Math.round(m.p * 100)}%` }}
                              />
                            </div>
                            <span className="w-8 text-right text-[9px] tabular-nums text-foreground font-semibold">
                              {Math.round(m.p * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {currentStep >= 3 && builtTickets && (
              <div className="border-t border-blue-600/20">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold text-blue-200">
                      Etapa 3 · {(builtTickets?.length ?? 0) + (mixedTickets?.length ?? 0)} bilhetes · {builtPool.length}/{APPROVED_COUNT} jogos encaixados
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      5 fixos (4 jogos, 1 mercado) + {mixedTickets?.length ?? 0} mistos (5 jogos, 1 mercado por jogo)
                    </div>

                  </div>
                  <button
                    onClick={async () => {
                      const just = await buildJustification();
                      printFechamento(currentExport(`Fechamento ${saved.length + 1}`, just));
                    }}
                    disabled={justLoading}
                    title="Imprimir / salvar em PDF (1 folha, com justificativa da IA)"
                    className="text-[10px] font-bold px-2 py-1 rounded-full bg-white/10 text-foreground border border-white/15 hover:bg-white/20 disabled:opacity-40 flex items-center gap-1"
                  >
                    {justLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />} PDF
                  </button>

                  <button
                    onClick={async () => {
                      const just = await buildJustification();
                      shareFechamentoWhatsApp(currentExport(`Fechamento ${saved.length + 1}`, just));
                    }}
                    title="Enviar no WhatsApp"
                    className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 flex items-center gap-1"
                  >
                    <Share2 className="w-3 h-3" /> WhatsApp
                  </button>
                  <button
                    onClick={async () => {
                      const just = await buildJustification();
                      const r = await shareFechamento(currentExport(`Fechamento ${saved.length + 1}`, just));
                      if (r === "copied") alert("Bilhetes copiados para a área de transferência.");
                    }}

                    title="Compartilhar bilhetes"
                    className="text-[10px] font-bold px-2 py-1 rounded-full bg-sky-500/20 text-sky-200 border border-sky-500/40 hover:bg-sky-500/30 flex items-center gap-1"
                  >
                    <Share2 className="w-3 h-3" /> Compartilhar
                  </button>

                  <button
                    onClick={() => {
                      if (!builtTickets) return;
                      const nextNum = saved.length + 1;
                      const games = builtPool.map((r) => ({
                        id: r.id,
                        home: r.home,
                        away: r.away,
                        league: r.league,
                      }));
                      const markets = builtTickets.map((t) => ({
                        market: t.market,
                        label: t.label,
                        conf: ticketConfidence(t, calibration).score,
                        confLevel: ticketConfidence(t, calibration).level,
                        geo: ticketGeo(t),

                        games: t.picks.map((p) => ({
                          id: p.row.id,
                          home: p.row.home,
                          away: p.row.away,
                          league: p.row.league,
                          time: p.row.time,
                          p: p.p,
                          pick: p.pick,
                          side: p.side,
                        })),
                      }));
                      const mixedMarkets = (mixedTickets ?? []).map((t) => ({
                        market: t.code,
                        label: t.label,
                        conf: Math.round(t.avgProbability * 100),
                        games: t.picks.map((p) => ({
                          id: p.row.id,
                          home: p.row.home,
                          away: p.row.away,
                          league: p.row.league,
                          time: p.row.time,
                          p: p.p,
                          pick: p.pick,
                          side: p.side,
                          market: p.market,
                        })),
                      }));
                      const allMarkets = [...markets, ...mixedMarkets];
                      const ticketRows = [
                        ...builtTickets.map((t, i) => ({
                          n: i + 1,
                          type: t.market === "B4" || t.market === "B5" ? "Aposta Criada" : "Placar exato",
                          label: t.label,
                          detail: t.picks.map((p) => `${p.row.home} × ${p.row.away} → ${p.pick}`).join(" · "),
                          conf: Math.round(t.avgProbability * 100),
                        })),
                        ...(mixedTickets ?? []).map((t, i) => ({
                          n: builtTickets.length + i + 1,
                          type: "Misto vertical",
                          label: t.label,
                          detail: t.picks.map((p) => `[${p.market}] ${p.row.home} × ${p.row.away} → ${p.pick}`).join(" · "),
                          conf: Math.round(t.avgProbability * 100),
                        })),
                      ];
                      saveMut.mutate({
                        name: `Fechamento ${nextNum}`,
                        target_date: new Date().toISOString().slice(0, 10),
                        games,
                        tickets: ticketRows,
                        summary: {
                          kind: "bingao10",
                          markets: allMarkets,
                          justification,
                          selection: builtPool.map((r) => ({
                            id: r.id,
                            home: r.home,
                            away: r.away,
                            league: r.league,
                            time: r.time,
                            pUnder15: r.pUnder15,
                            lambdaTotal: r.lambdaTotal,
                          })),
                        },
                      }, { onSuccess: () => resetPipeline(true) });


                    }}
                    disabled={saveMut.isPending}
                    title="Salvar este fechamento (vai para a aba Nível da IA)"
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1"
                  >
                    {saveMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Salvar fechamento
                  </button>
                  <button
                    onClick={() => { setBuiltTickets(null); setMixedTickets(null); setJustification(null); setBuiltPool([]); }}
                    title="Limpar bilhetes"
                    className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="px-2.5 pb-1 text-[9px] text-muted-foreground">
                  {calibration.sample >= MIN_CALIBRATION_SAMPLE
                    ? `Confiança calibrada com ${calibration.sample} bilhetes já conferidos (taxa real de green por faixa).`
                    : `Confiança pela escala do modelo — calibra automaticamente com o histórico real após ${MIN_CALIBRATION_SAMPLE} bilhetes conferidos (${calibration.sample}/${MIN_CALIBRATION_SAMPLE}).`}
                </div>
                <div className="px-2.5 pb-2.5 grid gap-2">
                  {builtTickets.map((t) => {
                    const avg = Math.round(t.avgProbability * 100);
                    const joint = t.jointProbability;
                    const jointTxt = joint >= 0.01 ? `${(joint * 100).toFixed(1)}%` : `${(joint * 100).toFixed(2)}%`;
                    const conf = ticketConfidence(t, calibration);
                    const full = t.picks.length === TICKET_SIZE;
                    return (
                      <div key={t.market} className="rounded-xl bg-gradient-to-br from-white/[0.05] to-transparent border border-white/10 overflow-hidden shadow-lg transition-all hover:border-violet-500/30">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-white/5">
                          <span className="w-7 h-6 rounded-lg bg-violet-500/20 text-violet-200 text-[11px] font-black flex items-center justify-center border border-violet-500/30">
                            {t.market}
                          </span>
                          <span className="text-[11px] font-bold truncate flex-1 tracking-tight">{t.label}</span>
                          <div className="flex flex-col items-end shrink-0">
                            <span
                              className={`text-[9px] font-black px-2 py-0.5 rounded-full border tabular-nums uppercase tracking-wider ${conf.cls}`}
                              title={
                                conf.source === "calibrado"
                                  ? `Calibrado: ${conf.score}% dos bilhetes nesta faixa deram green (${conf.sample} conferidos)`
                                  : "Escala do modelo (média geométrica das 4 linhas). Fica calibrado após 20 bilhetes conferidos."
                              }
                            >
                              {conf.level} · {conf.score}{conf.source === "calibrado" ? "% real" : ""}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[9px] text-muted-foreground tabular-nums">avg {avg}%</span>
                              <span className="text-[10px] font-black text-violet-300 tabular-nums">comb {jointTxt}</span>
                            </div>
                          </div>
                        </div>

                        {!full && (
                          <div className="px-2 py-1 text-[10px] text-amber-300">
                            Apenas {t.picks.length} jogo(s) disponíveis para este bilhete.
                          </div>
                        )}
                        <div className="divide-y divide-white/5">
                          {t.picks.map((p, i) => (
                            <div key={`${t.market}-${p.row.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02] transition-colors">
                              <span className="w-4 text-[10px] font-black text-muted-foreground/40 text-right tabular">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-bold truncate leading-tight mb-0.5">{p.row.home} × {p.row.away}</div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-md shadow-sm border ${p.side === "home" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : p.side === "away" ? "bg-sky-500/10 text-sky-300 border-sky-500/20" : "bg-violet-500/10 text-violet-200 border-violet-500/20"}`}>
                                    {p.side === "home" ? "CASA" : p.side === "away" ? "FORA" : "EMPATE"} · {p.pick}
                                  </span>
                                  {(() => {
                                    const odd = oddForMarket(p.row, t.market, oddsMap[p.row.id]);
                                    if (!odd) return null;
                                    const ev = evPct(p.p, odd);
                                    return (
                                      <span
                                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${
                                          ev !== null && ev > 0
                                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                            : "bg-white/5 text-muted-foreground border-white/10"
                                        }`}
                                        title="Odd da casa × valor esperado vs nosso modelo"
                                      >
                                        @{odd.toFixed(2)}
                                        {ev !== null && <> · EV {ev > 0 ? "+" : ""}{(ev * 100).toFixed(0)}%</>}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="text-[9px] text-muted-foreground truncate">
                                  {p.row.league} · {new Date(p.row.time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  {(t.market === "B4" || t.market === "B5") && <> · esc. λ {p.row.cornersLambda.toFixed(1)}</>}
                                  {(t.market !== "B4" && t.market !== "B5") && <> · λ {p.row.lambdaTotal.toFixed(2)}</>}
                                </div>
                              </div>
                              <span className="shrink-0 text-[10px] font-bold tabular-nums text-violet-200">
                                {(p.p * 100).toFixed(1)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {mixedTickets && mixedTickets.length > 0 && (
                  <div className="px-2.5 pb-2.5 grid gap-2">
                    <div className="text-[11px] font-bold text-sky-200">
                      Bilhetes mistos verticais · {mixedTickets.length} cartelas × 5 jogos
                    </div>
                    {mixedTickets.map((t) => (
                      <div key={t.code} className="rounded-xl bg-gradient-to-br from-sky-500/10 to-transparent border border-sky-400/20 overflow-hidden shadow-lg transition-all hover:border-sky-400/40">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-sky-500/5">
                          <span className="w-7 h-6 rounded-lg bg-blue-600/20 text-blue-100 text-[11px] font-black flex items-center justify-center border border-blue-600/30">
                            {t.code}
                          </span>
                          <span className="text-[11px] font-bold truncate flex-1 tracking-tight">{t.label}</span>
                          <span className="text-[9px] font-black text-sky-300/60 tabular uppercase tracking-wider">avg {Math.round(t.avgProbability * 100)}%</span>
                        </div>
                        <div className="divide-y divide-white/5">
                          {t.picks.map((p, i) => (
                            <div key={`${t.code}-${i}`} className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02] transition-colors">
                              <span className="w-4 text-[10px] font-black text-muted-foreground/40 text-right tabular">{i + 1}</span>
                              <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-200 border border-sky-500/30 uppercase tracking-tighter shrink-0">{p.market}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-bold truncate mb-0.5">{p.row.home} × {p.row.away}</div>
                                <div className="text-[9px] font-medium text-muted-foreground/70 truncate flex items-center gap-1.5">
                                  <span className="uppercase text-sky-300/80">{p.side === "home" ? "CASA" : p.side === "away" ? "FORA" : "EMPATE"}</span>
                                  <span className="text-muted-foreground/30">•</span>
                                  <span>{p.pick}</span>
                                </div>
                              </div>
                              <span className="shrink-0 text-[11px] font-black tabular text-sky-200">
                                {(p.p * 100).toFixed(1)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {justification && (
                  <div className="px-2.5 pb-2.5">
                    <div className="rounded-lg bg-black/30 border border-white/10 px-2 py-1.5">
                      <div className="text-[10px] font-bold text-violet-200 mb-0.5">Justificativa da IA (vai no PDF)</div>
                      <div className="text-[10px] text-muted-foreground whitespace-pre-line">{justification}</div>
                    </div>
                  </div>
                )}

                <div className="px-2.5 pb-2.5">
                  <AiCommentary
                    kind="bingao"
                    title="Análise da IA dos bilhetes"
                    buildContext={() =>
                      builtTickets
                        .map(
                          (t) =>
                            `${t.market} (${t.label}) — prob. conjunta ${(t.jointProbability * 100).toFixed(2)}%\n` +
                            t.picks
                              .map(
                                (p) =>
                                  `  ${p.row.home} x ${p.row.away} | ${p.side} | prob ${(p.p * 100).toFixed(1)}% | λ total ${p.row.lambdaTotal.toFixed(2)} | escanteios λ ${p.row.cornersLambda.toFixed(1)}`,
                              )
                              .join("\n"),
                        )
                        .join("\n\n")
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}





      {saved.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {saved.map((f) => {
            const active = viewingSavedId === f.id;
            return (
              <div
                key={f.id}
                className={`group flex items-center gap-1 text-[11px] rounded-full pl-2.5 pr-1 py-1 border ${
                  active
                    ? "bg-blue-600/25 border-blue-600 text-white"
                    : "bg-black/30 border-white/10 text-muted-foreground hover:text-foreground"
                }`}
              >
                <button
                  onClick={() => { setViewingSavedId(active ? null : f.id); setOpen(true); }}
                  className="flex items-center gap-1 font-medium"
                >
                  {active && <Check className="w-3 h-3" />}
                  {f.name}
                  <span className="opacity-60 text-[10px]">· {new Date(f.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                </button>
                <button
                  onClick={() => printFechamento(savedToExport(f))}
                  title={`Imprimir / PDF · ${f.name}`}
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/15 text-muted-foreground hover:text-foreground"
                >
                  <Printer className="w-3 h-3" />
                </button>
                <button
                  onClick={() => shareFechamentoWhatsApp(savedToExport(f))}
                  title={`WhatsApp · ${f.name}`}
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-emerald-500/25 text-muted-foreground hover:text-emerald-200"
                >
                  <Share2 className="w-3 h-3" />
                </button>
                <button

                  onClick={async () => {
                    const r = await shareFechamento(savedToExport(f));
                    if (r === "copied") alert("Bilhetes copiados para a área de transferência.");
                  }}
                  title={`Compartilhar · ${f.name}`}
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-sky-500/25 text-muted-foreground hover:text-sky-200"
                >
                  <Share2 className="w-3 h-3" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Excluir ${f.name}?`)) deleteMut.mutate(f.id);
                  }}
                  title="Excluir"
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-destructive/30 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {viewingSaved && open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {viewingSaved.name} · {new Date(viewingSaved.created_at).toLocaleString("pt-BR")}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Jogos ({viewingSaved.games.length})</div>
            <div className="space-y-1">
              {viewingSaved.games.map((g) => (
                <div key={g.id} className="text-[11px] bg-black/30 rounded px-2 py-1 truncate">
                  {g.home} × {g.away} <span className="text-muted-foreground">· {g.league ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Bilhetes salvos</div>
            <div className="grid gap-1.5">
              {viewingSaved.tickets.map((t) => (
                <div key={t.n} className="rounded-lg bg-black/30 border border-white/5 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-blue-600/20 text-blue-400 text-[10px] font-bold flex items-center justify-center">B{t.n}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.type}</span>
                    <span className="ml-auto text-[11px] font-bold text-blue-400 tabular">Nota {t.conf}%</span>
                  </div>
                  <div className="text-xs font-medium mt-0.5">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {ids.length < 3 && (
        <div className="px-3 pb-3 text-[11px] text-muted-foreground">
          Importe pelo menos 3 jogos para a pasta Bingão usando o atalho 🎯 nos cards.
        </div>
      )}

      {isPreloading && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            {phase === "fixtures"
              ? `Carregando dados dos jogos: ${fxLoaded}/${ids.length}`
              : `Carregando estatísticas dos times: ${statsLoaded}/${statsTotal}`}
          </div>
          <div className="h-1.5 rounded-full bg-black/40 overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="space-y-1 pt-1">
            {ids.map((id) => {
              const fx = fixtures[id];
              const hasFx = fx !== undefined;
              let hasHome = false;
              let hasAway = false;
              if (fx) {
                hasHome = teamStats[teamKey(fx.teams.home.id, fx.league.id, fx.league.season)] !== undefined;
                hasAway = teamStats[teamKey(fx.teams.away.id, fx.league.id, fx.league.season)] !== undefined;
              }
              const steps = (hasFx ? 1 : 0) + (hasHome ? 1 : 0) + (hasAway ? 1 : 0);
              const pct = Math.round((steps / 3) * 100);
              const done = pct === 100;
              const label = fx
                ? `${fx.teams.home.name} × ${fx.teams.away.name}`
                : `Jogo #${id}`;
              return (
                <div key={`prog-${id}`} className="flex items-center gap-2 text-[11px]">
                  <div className="flex-1 min-w-0 truncate text-muted-foreground">{label}</div>
                  <div className="w-24 h-1 rounded-full bg-black/40 overflow-hidden">
                    <div
                      className={`h-full transition-all ${done ? "bg-emerald-500" : "bg-blue-600"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="tabular text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-3 pb-3">
        <div className="rounded-[2rem] border border-white/10 bg-black/40 p-5 text-[11px] leading-relaxed text-muted-foreground shadow-inner">
          <div className="text-[12px] font-black text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
             <Info className="w-4 h-4" /> Metodologia de Operação
          </div>
          <div className="space-y-3">
            <div><span className="text-blue-400 font-black uppercase tracking-tighter">1 · Varredura de Mercado (24h)</span> — A IA monitora as próximas 24 horas de futebol, selecionando jogos com liquidez e mercado aberto. Filtramos times com médias de gols baixas (λ) focando no padrão Under 1.5.</div>
            <div><span className="text-blue-400 font-black uppercase tracking-tighter">2 · Prova Real (Cruzamento)</span> — Os jogos selecionados passam por uma auditoria contra o desempenho real dos últimos 6 jogos (finalizações, defesa vazada e fase atual), aprovando apenas os mais seguros.</div>
            <div><span className="text-blue-400 font-black uppercase tracking-tighter">3 · Fechamento de Precisão</span> — Os aprovados são distribuídos em 5 bilhetes fixos (B1-B5). O foco é o Under 1.5 (B1), com placares 2x0 e 2x1 (B2 e B3) servindo de cobertura estratégica.</div>
            <div><span className="text-emerald-400 font-black uppercase tracking-tighter">4 · Auditoria Automática</span> — Ao salvar, o sistema monitora os resultados reais. A aba <span className="font-black text-white uppercase tracking-tighter">Assertividade da IA</span> valida se o modelo acertou o padrão esperado para cada bilhete.</div>
          </div>
        </div>
        {phase === "ready" && !generated && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {missingStats === 0
              ? `✅ Todos os ${ids.length} jogos com estatísticas completas — pronto para analisar.`
              : `⚠️ ${ids.length - missingStats}/${ids.length} jogos com dados. ${missingStats} sem stats (times sem histórico na temporada) — resultado pode ser incompleto.`}
          </div>
        )}
      </div>


      {generated && open && phase === "ready" && !viewingSaved && (
        <div className="px-3 pb-3 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Diagnóstico de dados (API-Football)
            </div>
            <div className="space-y-1">
              {enriched.map((e) => {
                const h = e.homeStats;
                const a = e.awayStats;
                const okH = !!h && h.fixtures.played.total > 0;
                const okA = !!a && a.fixtures.played.total > 0;
                const isSelected = selected.some((s) => s.id === e.id);
                let statusText: string;
                let statusColor: string;
                if (isSelected) { statusText = "SELECIONADO"; statusColor = "text-blue-400"; }
                else if (!e.ready) { statusText = "sem stats"; statusColor = "text-destructive"; }
                else if (e.pUnder15 < 0.25) { statusText = `descartado · P(Under 1.5)=${Math.round(e.pUnder15 * 100)}%`; statusColor = "text-blue-500/60"; }
                else { statusText = `elegível não-top · λ=${e.lambdaTotal.toFixed(2)}`; statusColor = "text-muted-foreground"; }
                return (
                  <div key={`diag-${e.id}`} className="text-[11px] bg-black/30 rounded-lg px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${isSelected ? "bg-blue-600" : e.ready ? "bg-blue-400/50" : "bg-destructive"}`} />
                      <div className="flex-1 min-w-0 truncate font-medium">
                        {e.fixture ? `${e.fixture.teams.home.name} × ${e.fixture.teams.away.name}` : `Fixture ${e.id}`}
                      </div>
                      <span className={`text-[10px] font-bold ${statusColor}`}>{statusText}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-1 text-[10px] text-muted-foreground">
                      <div>
                        <span className={okH ? "text-green-400" : "text-destructive"}>● Casa</span>{" "}
                        {h ? `J${h.fixtures.played.home} · GF ${h.goals.for.average.home} · GA ${h.goals.against.average.home} · CS ${h.clean_sheet.home} · FTS ${h.failed_to_score.home} · ${h.form?.slice(-5) ?? "–"}` : "estatísticas indisponíveis"}
                      </div>
                      <div>
                        <span className={okA ? "text-green-400" : "text-destructive"}>● Fora</span>{" "}
                        {a ? `J${a.fixtures.played.away} · GF ${a.goals.for.average.away} · GA ${a.goals.against.average.away} · CS ${a.clean_sheet.away} · FTS ${a.failed_to_score.away} · ${a.form?.slice(-5) ?? "–"}` : "estatísticas indisponíveis"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Jogos elegíveis ({selected.length}/3+) · P(Under 1.5) ≥ 25%
            </div>
            {selected.length < 3 && (
              <div className="text-xs text-destructive mb-1">
                {missingStats > 0
                  ? "Estatísticas de temporada indisponíveis para alguns times."
                  : "Poucos jogos com perfil defensivo suficiente. Adicione mais confrontos travados."}
              </div>
            )}
            <div className="space-y-1">
              {selected.map((e, idx) => (
                <div key={e.id} className="flex items-center gap-2 text-xs bg-black/30 rounded-lg px-2 py-1.5">
                  <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 text-[10px] font-bold flex items-center justify-center">J{idx + 1}</span>
                  <div className="flex-1 min-w-0 truncate">
                    {e.fixture ? `${e.fixture.teams.home.name} × ${e.fixture.teams.away.name}` : `Fixture ${e.id}`}
                  </div>
                  <span className="text-muted-foreground tabular text-[10px]">λ {e.lambdaHome.toFixed(2)}/{e.lambdaAway.toFixed(2)}</span>
                  <span className="text-blue-400 font-bold tabular">{Math.round(e.pUnder15 * 100)}%</span>
                </div>
              ))}
            </div>
          </div>

          {tickets.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Bilhetes gerados (Poisson)</div>
              <div className="grid gap-1.5">
                {tickets.map((t) => (
                  <div key={t.n} className="rounded-lg bg-black/30 border border-white/5 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-blue-600/20 text-blue-400 text-[10px] font-bold flex items-center justify-center">B{t.n}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.type}</span>
                      <span className="ml-auto text-[11px] font-bold text-blue-400 tabular">Nota {t.conf}%</span>
                    </div>
                    <div className="text-xs font-medium mt-0.5">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{t.detail}</div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                * λ = expectativa de gols (média ataque time × média defesa adversário). Nota = P(placar) via Poisson escalada. Sempre confirme antes de apostar.
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    <CriteriaDetailsDialog match={criteriaMatch} onClose={() => setCriteriaMatch(null)} />
    </>
  );
}

