/**
 * Triagem — persistência e conferência independente (server-only).
 * Cada mercado tem estatística própria; a conferência de um não mexe no outro.
 */
import {
  TRIAGEM_MARKETS,
  gradeTriagem,
  type TriagemEval,
  type TriagemMarket,
  type TriagemMatchData,
} from "./triagem-engine";

/** A tabela é nova e ainda não está nos tipos gerados — acesso solto e seguro. */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function table(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return (supabaseAdmin as any).from("triagem_records");
}

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    (error.message ?? "").includes("triagem_records")
  );
}

/**
 * O PostgREST devolve no máximo 1000 linhas por consulta — sem paginação
 * o relatório diário ficava congelado nas primeiras 1000 avaliações.
 */
async function fetchAllRows(
  select: string,
  apply: (q: any) => any,
  max = 20000,
): Promise<{ rows: any[]; missing: boolean }> {
  const out: any[] = [];
  const page = 1000;
  for (let from = 0; from < max; from += page) {
    const t = await table();
    const { data, error } = await apply(t.select(select)).range(from, from + page - 1);
    if (error) {
      if (missingTable(error)) return { rows: [], missing: true };
      throw new Error(error.message);
    }
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < page) break;
  }
  return { rows: out, missing: false };
}

/** Data do jogo no fuso de São Paulo (YYYY-MM-DD). */
function spDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export interface TriagemRow {
  id: string;
  fixture_id: number;
  match_name: string;
  league: string | null;
  kickoff: string | null;
  market_type: TriagemMarket;
  predicted_value: string;
  score_confidence: number;
  status: "pending" | "green" | "red" | "void";
  passed: boolean;
  probability: number;
  ceiling: number;
  reason: string[];
  result_score: string | null;
  created_at: string;
  graded_at: string | null;
}

/**
 * Grava a avaliação COMPLETA do jogo na Triagem (9 mercados).
 * Mercados que passaram ficam `pending` (entram no painel e na conferência);
 * os reprovados ficam `void` (registrados para a Certificação, fora do painel).
 */
export async function saveTriagem(evals: TriagemEval[], meta: TriagemMatchData): Promise<number> {
  if (!evals.length) return 0;
  const t = await table();
  const rows = evals.map((e) => ({
    fixture_id: meta.fixtureId,
    match_name: meta.matchName,
    league: meta.league ?? null,
    kickoff: meta.kickoff ?? null,
    market_type: e.market,
    predicted_value: e.predicted_value,
    score_confidence: e.score,
    passed: e.passed,
    probability: e.probability,
    ceiling: e.ceiling,
    reason: e.reasons,
    status: e.passed ? "pending" : "void",
  }));
  const { error } = await t.upsert(rows, { onConflict: "fixture_id,market_type" });
  if (error) {
    if (missingTable(error)) {
      console.warn("[triagem] tabela ausente; execute supabase/triagem-certificacao.sql");
      return 0;
    }
    console.warn("[triagem] falha ao gravar", error.message);
    return 0;
  }
  return rows.length;
}

/** Confere todos os mercados de um jogo encerrado (independente entre si). */
export async function gradeTriagemFixture(
  fixtureId: number,
  goalsHome: number,
  goalsAway: number,
): Promise<number> {
  const t = await table();
  const { data, error } = await t
    .select("id, market_type, predicted_value")
    .eq("fixture_id", fixtureId)
    .eq("status", "pending");
  if (error || !data?.length) return 0;

  const now = new Date().toISOString();
  const resultScore = `${goalsHome}x${goalsAway}`;
  let done = 0;
  for (const row of data as { id: string; market_type: TriagemMarket; predicted_value: string }[]) {
    const status = gradeTriagem(row.market_type, row.predicted_value, goalsHome, goalsAway);
    const upd = await (
      await table()
    )
      .update({ status, result_score: resultScore, graded_at: now })
      .eq("id", row.id);
    if (!upd.error) done++;
  }
  return done;
}

export interface TriagemMarketStat {
  market: TriagemMarket;
  greens: number;
  reds: number;
  pending: number;
  accuracy: number; // 0..1
  items: TriagemRow[];
}

/** Painel: estatística exclusiva de cada mercado + jogos triados. */
export async function triagemBoard(): Promise<{ markets: TriagemMarketStat[]; total: number }> {
  const base: TriagemMarketStat[] = TRIAGEM_MARKETS.map((market) => ({
    market,
    greens: 0,
    reds: 0,
    pending: 0,
    accuracy: 0,
    items: [],
  }));
  const byMarket = new Map(base.map((m) => [m.market, m]));

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { rows: raw, missing } = await fetchAllRows(
    "id, fixture_id, match_name, league, kickoff, market_type, predicted_value, score_confidence, status, result_score, created_at, graded_at",
    (q) => q.eq("passed", true).gte("created_at", since).order("kickoff", { ascending: true }),
  );
  if (missing) {
    console.warn("[triagem] tabela ausente; execute supabase/triagem.sql");
    return { markets: base, total: 0 };
  }

  const rows = raw as TriagemRow[];
  for (const row of rows) {
    const m = byMarket.get(row.market_type);
    if (!m) continue;
    if (row.status === "green") m.greens++;
    else if (row.status === "red") m.reds++;
    else if (row.status === "pending") m.pending++;
    if (m.items.length < 60) m.items.push(row);
  }
  for (const m of base) {
    const n = m.greens + m.reds;
    m.accuracy = n ? m.greens / n : 0;
  }
  return { markets: base, total: rows.length };
}

// ───────────────────────── Certificação ─────────────────────────

export interface TriagemCertFixture {
  fixture_id: number;
  match_name: string;
  league: string | null;
  kickoff: string | null;
  /** 9 avaliações — passou/falhou + motivo. */
  evals: TriagemRow[];
  published: number;
}

export interface TriagemCertification {
  total: number;
  fixtures: TriagemCertFixture[];
  /** taxa de jogos que entraram em ≥ 1 mercado */
  routingRate: number;
}

const SELECT_ALL =
  "id, fixture_id, match_name, league, kickoff, market_type, predicted_value, score_confidence, probability, ceiling, reason, passed, status, result_score, created_at, graded_at";

/**
 * Certificação: cada jogo analisado com os 9 mercados avaliados —
 * nota, passou/falhou e motivo. Permitir ver, jogo a jogo, se o
 * roteamento para o(s) mercado(s) certo(s) confere.
 */
export async function triagemCertificacao(days = 21, limit = 3000): Promise<TriagemCertification> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { rows: raw, missing } = await fetchAllRows(
    SELECT_ALL,
    (q) => q.gte("created_at", since).order("kickoff", { ascending: true }),
    limit,
  );
  if (missing) {
    console.warn("[triagem] tabela ausente; execute supabase/triagem-certificacao.sql");
    return { total: 0, fixtures: [], routingRate: 0 };
  }

  const rows = raw as TriagemRow[];
  const byFixture = new Map<number, TriagemCertFixture>();
  for (const r of rows) {
    let f = byFixture.get(r.fixture_id);
    if (!f) {
      f = {
        fixture_id: r.fixture_id,
        match_name: r.match_name,
        league: r.league,
        kickoff: r.kickoff,
        evals: [],
        published: 0,
      };
      byFixture.set(r.fixture_id, f);
    }
    f.evals.push(r);
    if (r.passed) f.published++;
  }
  const fixtures = [...byFixture.values()].sort((a, b) =>
    (b.kickoff ?? "").localeCompare(a.kickoff ?? ""),
  );
  const analyzed = fixtures.length;
  const entered = fixtures.filter((f) => f.published > 0).length;
  return {
    total: analyzed,
    fixtures,
    routingRate: analyzed ? entered / analyzed : 0,
  };
}

// ───────────────────────── Evolução diária ─────────────────────────

export interface TriagemEvolucaoDay {
  date: string; // YYYY-MM-DD
  analyzed: number; // fixtures distintas
  published: number; // mercados publicados (passed)
  greens: number;
  reds: number;
  pending: number;
  accuracy: number; // greens / (greens+reds)
}

export interface TriagemEvolucaoMarket {
  market: TriagemMarket;
  volume: number; // publicados no período
  greens: number;
  reds: number;
  accuracy: number;
  trend: TriagemEvolucaoDay[]; // últimos 14 dias com volume>0 ou acc
}

export interface TriagemEvolucao {
  days: TriagemEvolucaoDay[];
  markets: TriagemEvolucaoMarket[];
  totalAnalyzed: number;
  totalPublished: number;
  overallAccuracy: number;
}

/** Relatório diário: evolução da Triagem por dia + por mercado. */
export async function triagemEvolucao(days = 60): Promise<TriagemEvolucao> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { rows: raw, missing } = await fetchAllRows(
    "id, fixture_id, market_type, passed, status, created_at, kickoff",
    (q) => q.gte("created_at", since),
  );
  if (missing) {
    console.warn("[triagem] tabela ausente; execute supabase/triagem-certificacao.sql");
    return { days: [], markets: [], totalAnalyzed: 0, totalPublished: 0, overallAccuracy: 0 };
  }

  const rows = raw as Array<{
    fixture_id: number;
    market_type: TriagemMarket;
    passed: boolean;
    status: string;
    created_at: string;
    kickoff: string | null;
  }>;

  const byDay = new Map<string, TriagemEvolucaoDay>();
  const fixturesPerDay = new Map<string, Set<number>>();
  const marketBuckets = new Map<TriagemMarket, { g: number; r: number; v: number }>();
  const marketByDay = new Map<string, Map<TriagemMarket, { g: number; r: number; v: number }>>();
  let totalPublished = 0;
  let totalGreens = 0;
  let totalReds = 0;

  for (const r of rows) {
    // Dia do JOGO (fuso de São Paulo) — o upsert mantém created_at antigo,
    // então agrupar pela gravação congelava o relatório diário.
    const date = spDay(r.kickoff) || (r.created_at ?? "").slice(0, 10);
    if (!date) continue;

    let day = byDay.get(date);
    if (!day) {
      day = { date, analyzed: 0, published: 0, greens: 0, reds: 0, pending: 0, accuracy: 0 };
      byDay.set(date, day);
    }
    let set = fixturesPerDay.get(date);
    if (!set) {
      set = new Set();
      fixturesPerDay.set(date, set);
    }
    set.add(r.fixture_id);

    if (r.passed) {
      day.published++;
      totalPublished++;
      if (r.status === "green") {
        day.greens++;
        totalGreens++;
      } else if (r.status === "red") {
        day.reds++;
        totalReds++;
      } else if (r.status === "pending") {
        day.pending++;
      }
      const mb = marketBuckets.get(r.market_type) ?? { g: 0, r: 0, v: 0 };
      mb.v++;
      if (r.status === "green") mb.g++;
      else if (r.status === "red") mb.r++;
      marketBuckets.set(r.market_type, mb);

      let mds = marketByDay.get(date);
      if (!mds) {
        mds = new Map();
        marketByDay.set(date, mds);
      }
      const mm = mds.get(r.market_type) ?? { g: 0, r: 0, v: 0 };
      mm.v++;
      if (r.status === "green") mm.g++;
      else if (r.status === "red") mm.r++;
      mds.set(r.market_type, mm);
    }
  }

  for (const [date, set] of fixturesPerDay) {
    const day = byDay.get(date);
    if (day) day.analyzed = set.size;
  }
  const dayList = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of dayList) {
    const n = d.greens + d.reds;
    d.accuracy = n ? d.greens / n : 0;
  }

  const markets: TriagemEvolucaoMarket[] = TRIAGEM_MARKETS.map((market) => {
    const b = marketBuckets.get(market) ?? { g: 0, r: 0, v: 0 };
    const trend: TriagemEvolucaoDay[] = dayList.slice(-14).map((d) => {
      const m = marketByDay.get(d.date)?.get(market);
      const g = m?.g ?? 0;
      const r = m?.r ?? 0;
      return {
        ...d,
        published: m?.v ?? 0,
        greens: g,
        reds: r,
        pending: 0,
        accuracy: g + r ? g / (g + r) : 0,
      };
    });
    const n = b.g + b.r;
    return {
      market,
      volume: b.v,
      greens: b.g,
      reds: b.r,
      accuracy: n ? b.g / n : 0,
      trend,
    };
  });

  const accN = totalGreens + totalReds;
  return {
    days: dayList,
    markets,
    totalAnalyzed: new Set(rows.map((r) => r.fixture_id)).size,
    totalPublished,
    overallAccuracy: accN ? totalGreens / accN : 0,
  };
}

// ───────────────────── Conferência de pendentes (backlog) ─────────────────────

/**
 * Confere as triagens de jogos já encerrados usando o placar JÁ salvo em
 * auto_tickets (result_snapshot) — zero requisições à API-Football.
 * Antes, um registro só era conferido se o bilhete do mesmo jogo fosse
 * conferido na mesma execução, o que deixava pendentes órfãos para sempre.
 */
export async function gradeTriagemBacklog(maxFixtures = 400): Promise<number> {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { rows, missing } = await fetchAllRows("fixture_id", (q) =>
    q.eq("status", "pending").eq("passed", true).lt("kickoff", cutoff),
  );
  if (missing || !rows.length) return 0;

  const ids = [...new Set(rows.map((r) => Number(r.fixture_id)))].slice(0, maxFixtures);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let done = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const { data } = await supabaseAdmin
      .from("auto_tickets")
      .select("fixture_id, result_snapshot")
      .in("fixture_id", slice)
      .eq("status", "graded");
    for (const row of data ?? []) {
      const snap = row.result_snapshot as { home_score?: number; away_score?: number } | null;
      if (!snap || typeof snap.home_score !== "number" || typeof snap.away_score !== "number") {
        continue;
      }
      done += await gradeTriagemFixture(Number(row.fixture_id), snap.home_score, snap.away_score);
    }
  }
  return done;
}
