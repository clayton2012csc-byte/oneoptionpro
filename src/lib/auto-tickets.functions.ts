/**
 * Módulo 3 — Server functions dos Bilhetes Automáticos.
 * Client-safe: só o corpo dos handlers roda no servidor.
 */
import { createServerFn } from "@tanstack/react-start";

type SupabaseError = { code?: string; message?: string };

function isMissingAutoTicketsTable(error: SupabaseError | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    error.message?.includes("public.auto_tickets") === true
  );
}

export interface AutoTicketRow {
  id: string;
  fixture_id: number;
  kickoff: string;
  league: string | null;
  home: string;
  away: string;
  home_logo: string | null;
  away_logo: string | null;
  picks: {
    market: string;
    selection: string;
    prob: number;
    odd: number;
    status?: "green" | "red" | "void";
    evidence?: string;
  }[];
  meta: (Record<string, number | string | undefined> & { headline?: string; flow?: string }) | null;
  result_snapshot: {
    home_score: number;
    away_score: number;
    ht_home_score: number | null;
    ht_away_score: number | null;
    total_corners: number | null;
    total_cards: number | null;
    first_goal: "home" | "away" | "none" | null;
    reason: string;
  } | null;
  status: string;
  greens: number;
  reds: number;
  accuracy: number | null;
}

/** Processa um lote pequeno e espaçado (carga inicial e incremental). */
export const runAutoTickets = createServerFn({ method: "POST" })
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { runAutoTicketsBatch } = await import("./auto-tickets.server");
    const limit = Math.min(Math.max(data.limit ?? 5, 1), 10);
    return await runAutoTicketsBatch(limit);
  });

/** Conferência manual: liquida bilhetes de jogos já encerrados (lote maior). */
export const gradeAutoTickets = createServerFn({ method: "POST" })
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { gradePending, overduePendingCount, purgeExpiredCache, persistMarketRanking } = await import(
      "./auto-tickets.server"
    );
    const { AUTO_MARKETS } = await import("./auto-ticket");
    const limit = Math.min(Math.max(data.limit ?? 400, 50), 800);
    const graded = await gradePending(limit);
    await purgeExpiredCache().catch(() => 0);
    await persistMarketRanking(AUTO_MARKETS).catch(() => []);
    return { ok: true, graded, backlog: await overduePendingCount() };
  });

/** Status compacto da carga das próximas 24h (mini painel + selo "IA Pronta"). */
export const autoTicketStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("auto_tickets")
    .select("fixture_id, status")
    .gte("kickoff", from)
    .lte("kickoff", until)
    .limit(1000);
  if (isMissingAutoTicketsTable(error)) {
    console.warn(
      "[auto-tickets] tabela public.auto_tickets ainda não instalada; execute supabase/setup-supabase-completo.sql",
    );
    return { ready: 0, total: 0, coverage: 0, ids: [] as number[] };
  }
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { fixture_id: number; status: string }[];
  const ready = rows.filter((r) => r.status !== "skipped");
  const processed = rows.length;
  const coverage = processed ? Math.round((ready.length / processed) * 100) : 0;
  return {
    ready: ready.length,
    total: processed,
    coverage,
    ids: ready.map((r) => Number(r.fixture_id)),
  };
});

/** Lista TODOS os bilhetes salvos (sem teto artificial) — paginação interna. */
export const listAutoTickets = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const from = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const cols =
    "id, fixture_id, kickoff, league, home, away, home_logo, away_logo, picks, meta, result_snapshot, status, greens, reds, accuracy";
  const out: AutoTicketRow[] = [];
  const page = 500;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabaseAdmin
      .from("auto_tickets")
      .select(cols)
      .gte("kickoff", from)
      .neq("status", "skipped")
      .order("kickoff", { ascending: true })
      .range(i * page, i * page + page - 1);
    if (isMissingAutoTicketsTable(error)) {
      console.warn(
        "[auto-tickets] tabela public.auto_tickets ainda não instalada; execute supabase/setup-supabase-completo.sql",
      );
      return [];
    }
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as AutoTicketRow[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
});

export interface MarketAccuracyRow {
  market: string;
  total: number;
  greens: number;
  reds: number;
  voids: number;
  accuracy: number;
  recentGreens: number;
  recentReds: number;
  recentAccuracy: number;
  verdict: "otimo" | "bom" | "atencao" | "ruim" | "sem-dados";
}

/**
 * Ranking dos 11 mercados: consolida todas as conferências automáticas
 * e devolve também o desempenho recente (últimos 14 dias) e o veredito.
 */
export const marketAccuracy = createServerFn({ method: "GET" }).handler(async (): Promise<{
  updatedAt: string | null;
  rows: MarketAccuracyRow[];
}> => {
  const { computeMarketRanking, readMarketRankingSnapshot } = await import("./auto-tickets.server");
  const { AUTO_MARKETS } = await import("./auto-ticket");
  const rows = await computeMarketRanking(AUTO_MARKETS);
  const snap = await readMarketRankingSnapshot().catch(() => ({ at: null, rows: [] }));
  return { updatedAt: snap.at, rows };
});
