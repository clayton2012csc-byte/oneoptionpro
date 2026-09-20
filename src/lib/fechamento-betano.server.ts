/**
 * Fechamento Betano 3/4 — leitura do banco (server-only).
 * Usa apenas os palpites já gravados em `auto_tickets`: zero chamadas à API-Football.
 */
import {
  DEFAULT_STAKE,
  buildClosure,
  type FechamentoSnapshot,
  type FixtureLike,
} from "./fechamento-betano";

const CACHE_PREFIX = "fechamento_betano:";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Dia corrente no fuso de São Paulo. */
export function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function getFechamentoBetanoSnapshot(force = false): Promise<FechamentoSnapshot> {
  const day = spToday();
  const key = `${CACHE_PREFIX}${day}`;
  const db = await admin();

  if (!force) {
    const { data } = await db.from("api_cache").select("data").eq("key", key).maybeSingle();
    const cached = data?.data as unknown as FechamentoSnapshot | null;
    if (cached?.games?.length) return cached;
  }

  const from = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db
    .from("auto_tickets")
    .select("fixture_id, kickoff, league, home, away, home_logo, away_logo, picks")
    .neq("status", "skipped")
    .gte("kickoff", from)
    .lte("kickoff", until)
    .order("kickoff", { ascending: true })
    .limit(600);

  const snapshot: FechamentoSnapshot = {
    day,
    builtAt: new Date().toISOString(),
    stake: DEFAULT_STAKE,
    games: buildClosure((rows ?? []) as unknown as FixtureLike[]),
  };

  if (snapshot.games.length) {
    await db.from("api_cache").upsert({
      key,
      data: snapshot as unknown as never,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
  }
  return snapshot;
}
