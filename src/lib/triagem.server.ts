/**
 * Triagem — persistência e conferência independente (server-only).
 * Cada mercado tem estatística própria; a conferência de um não mexe no outro.
 */
import {
  TRIAGEM_LABEL,
  TRIAGEM_MARKETS,
  gradeTriagem,
  MIN_SCORE,
  MIN_SCORE_BY_MARKET,
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
  avgScore: number; // nota média dos publicados no período
  highAcc: number; // acurácia só dos conferidos com nota >= 90 (0 se highN=0)
  highN: number; // conferidos (green+red) com nota >= 90
  minScore: number; // mínimo exigido pelo crivo do mercado
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
    "id, fixture_id, market_type, passed, status, score_confidence, created_at, kickoff",
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
    score_confidence: number;
    created_at: string;
    kickoff: string | null;
  }>;

  const byDay = new Map<string, TriagemEvolucaoDay>();
  const fixturesPerDay = new Map<string, Set<number>>();
  const marketBuckets = new Map<
    TriagemMarket,
    { g: number; r: number; v: number; sumScore: number; highG: number; highR: number }
  >();
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
      const mb =
        marketBuckets.get(r.market_type) ?? { g: 0, r: 0, v: 0, sumScore: 0, highG: 0, highR: 0 };
      mb.v++;
      mb.sumScore += r.score_confidence;
      if (r.status === "green") {
        mb.g++;
        if (r.score_confidence >= 90) mb.highG++;
      } else if (r.status === "red") {
        mb.r++;
        if (r.score_confidence >= 90) mb.highR++;
      }
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
    const b = marketBuckets.get(market) ?? { g: 0, r: 0, v: 0, sumScore: 0, highG: 0, highR: 0 };
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
    const hN = b.highG + b.highR;
    return {
      market,
      volume: b.v,
      greens: b.g,
      reds: b.r,
      accuracy: n ? b.g / n : 0,
      avgScore: b.v ? Math.round((b.sumScore / b.v) * 10) / 10 : 0,
      highAcc: hN ? b.highG / hN : 0,
      highN: hN,
      minScore: MIN_SCORE_BY_MARKET[market] ?? MIN_SCORE,
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

// ───────────────────── Leituras por fixture (cards/selos) ─────────────────────

export interface TriagemMarketBadge {
  market_type: TriagemMarket;
  label: string;
  selection: string;
  probability: number;
  score: number;
  passed: boolean;
  status: "pending" | "green" | "red" | "void";
}

export interface TriagemFixtureView {
  fixtureId: number;
  matchName: string;
  markets: TriagemMarketBadge[];
}

/**
 * Lê as avaliações da Triagem de uma lista de jogos (9 mercados cada).
 * Usado para preencher selos e notas nos cards de TODAS as abas — a Triagem é a
 * fonte de verdade e aqui ela é entregue ao front-end sem nova varredura.
 */
export async function triagemByFixtures(ids: number[]): Promise<TriagemFixtureView[]> {
  const clean = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (!clean.length) return [];
  const t = await table();
  const out = new Map<number, TriagemFixtureView>();
  for (let i = 0; i < clean.length; i += 400) {
    const { data, error } = await t
      .select("fixture_id, match_name, market_type, predicted_value, probability, score_confidence, passed, status")
      .in("fixture_id", clean.slice(i, i + 400));
    if (error) {
      if (missingTable(error)) return [];
      throw new Error(error.message);
    }
    for (const r of data ?? []) {
      const id = Number(r.fixture_id);
      let view = out.get(id);
      if (!view) {
        view = { fixtureId: id, matchName: r.match_name ?? "", markets: [] };
        out.set(id, view);
      }
      view.markets.push({
        market_type: r.market_type as TriagemMarket,
        label: TRIAGEM_LABEL[r.market_type as TriagemMarket] ?? r.market_type,
        selection: r.predicted_value,
        probability: Number(r.probability),
        score: Number(r.score_confidence),
        passed: Boolean(r.passed),
        status: r.status,
      });
    }
  }
  return [...out.values()];
}

/**
 * Lê TODAS as avaliações da Triagem dos jogos das próximas 24h de uma vez —
 * usado para pré-carregar os selos no login (abas abrem prontas, zero API).
 */
export async function proximas24hTriagem(): Promise<TriagemFixtureView[]> {
  const now = new Date().toISOString();
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const t = await table();
  const out = new Map<number, TriagemFixtureView>();
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await t
      .select("fixture_id, match_name, market_type, predicted_value, probability, score_confidence, passed, status")
      .gte("kickoff", now)
      .lte("kickoff", end)
      .range(from, from + PAGE - 1);
    if (error) {
      if (missingTable(error)) return [];
      throw new Error(error.message);
    }
    const chunk = data ?? [];
    for (const r of chunk) {
      const id = Number(r.fixture_id);
      let view = out.get(id);
      if (!view) {
        view = { fixtureId: id, matchName: r.match_name ?? "", markets: [] };
        out.set(id, view);
      }
      view.markets.push({
        market_type: r.market_type as TriagemMarket,
        label: TRIAGEM_LABEL[r.market_type as TriagemMarket] ?? r.market_type,
        selection: r.predicted_value,
        probability: Number(r.probability),
        score: Number(r.score_confidence),
        passed: Boolean(r.passed),
        status: r.status,
      });
    }
    if (chunk.length < PAGE) break;
  }
  return [...out.values()];
}

/**
 * Confere as triagens de jogos já encerrados usando o placar JÁ salvo em
 * auto_tickets (result_snapshot) — zero requisições à API-Football.
 * Aceita snapshot de QUALQUER status do auto_ticket (antes só `graded`,
 * o que deixava órfãs as triagens de jogos com ticket pending/void).
 * Jogos sem placar salvo em qualquer fonte ficam sem dado → marcados
 * `void` (dado indisponível) para não ficarem `pending` para sempre.
 */
export async function gradeTriagemBacklog(maxFixtures = 800): Promise<number> {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { rows, missing } = await fetchAllRows("fixture_id, kickoff", (q) =>
    q.eq("status", "pending").eq("passed", true).lt("kickoff", cutoff),
  );
  if (missing || !rows.length) return 0;

  // Um mesmo fixture pode ter vários registros pending (vários mercados).
  const byFixture = new Map<number, number>();
  for (const r of rows) {
    const id = Number(r.fixture_id);
    byFixture.set(id, (byFixture.get(id) ?? 0) + 1);
  }
  const ids = [...byFixture.keys()].slice(0, maxFixtures);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const withScore = new Map<number, { h: number; a: number }>();
  const ticketStatus = new Map<number, string>();
  let done = 0;

  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const { data } = await supabaseAdmin
      .from("auto_tickets")
      .select("fixture_id, status, result_snapshot")
      .in("fixture_id", slice);
    for (const row of data ?? []) {
      const fid = Number(row.fixture_id);
      ticketStatus.set(fid, String(row.status ?? ""));
      const snap = row.result_snapshot as { home_score?: number; away_score?: number } | null;
      if (!snap || typeof snap.home_score !== "number" || typeof snap.away_score !== "number") {
        continue;
      }
      withScore.set(fid, { h: snap.home_score, a: snap.away_score });
    }
  }

  // 1) Quem tem placar salvo (qualquer status do ticket) é conferido.
  for (const id of withScore.keys()) {
    done += await gradeTriagemFixture(id, withScore.get(id)!.h, withScore.get(id)!.a);
  }

  // 2) Só anula (dado indisponível) os jogos que REALMENTE não têm caminho:
  //    ticket já `void` (o pipeline desistiu) OU kickoff há ≥ 12h sem placar
  //    salvo (não chegou em nenhuma execução). Jogos recentes ficam pending
  //    para uma futura conferência pegar o placar quando existir.
  const t = await table();
  const now = new Date().toISOString();
  const VOID_KICKOFF_MS = 12 * 60 * 60 * 1000;
  const kickoffOf = new Map<number, string>();
  for (const r of rows) kickoffOf.set(Number(r.fixture_id), r.kickoff);

  const orphans = ids.filter((id) => {
    if (withScore.has(id)) return false;
    if (ticketStatus.get(id) === "void") return true;
    const ko = kickoffOf.get(id);
    if (!ko) return true;
    return Date.now() - new Date(ko).getTime() > VOID_KICKOFF_MS;
  });

  for (let i = 0; i < orphans.length; i += 100) {
    const slice = orphans.slice(i, i + 100);
    const upd = await t
      .update({ status: "void", result_score: null, graded_at: now, reason: ["Dado indisponível"] })
      .eq("status", "pending")
      .in("fixture_id", slice);
    if (upd.error) {
      console.warn("[triagem] falha ao anular órfãos", upd.error.message);
      continue;
    }
    for (const id of slice) done += byFixture.get(id) ?? 0;
  }

  return done;
}
