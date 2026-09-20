/**
 * Robô de apostas da conta demo.
 *
 * Monta, uma vez por dia e sem gastar nenhuma chamada da API-Football, as
 * apostas que o robô faria em cada aba do site:
 *   - apostas SIMPLES (uma seleção)
 *   - apostas MÚLTIPLAS (várias seleções no mesmo bilhete)
 *
 * Tudo sai dos palpites já salvos em `auto_tickets`, e o resultado de cada
 * seleção também vem de lá (status green/red gravado pela conferência).
 */
import { spToday } from "./multiplas.server";

export type RobotKind = "simples" | "multipla";
export type RobotStatus = "pending" | "green" | "red";

export interface RobotLeg {
  fixtureId: number;
  home: string;
  away: string;
  league: string | null;
  kickoff: string;
  market: string;
  selection: string;
  odd: number;
  prob: number;
  status: "green" | "red" | null;
}

export interface RobotPlay {
  id: string;
  source: string;
  kind: RobotKind;
  legs: RobotLeg[];
  odd: number;
  prob: number;
  status: RobotStatus;
}

export interface RobotPlaysSnapshot {
  day: string;
  builtAt: string;
  plays: RobotPlay[];
}

interface PickRow {
  market: string;
  selection: string;
  prob: number;
  odd: number;
  score?: number;
  elite?: boolean;
  status?: string | null;
}

interface TicketRow {
  fixture_id: number;
  kickoff: string;
  league: string | null;
  home: string;
  away: string;
  status: string;
  picks: PickRow[] | null;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const indication = (p: PickRow) => (Number.isFinite(Number(p.score)) ? Number(p.score) / 100 : p.prob);

function legOf(r: TicketRow, p: PickRow): RobotLeg {
  return {
    fixtureId: Number(r.fixture_id),
    home: r.home,
    away: r.away,
    league: r.league,
    kickoff: r.kickoff,
    market: p.market,
    selection: p.selection,
    odd: Number(num(p.odd).toFixed(2)),
    prob: num(p.prob),
    status: p.status === "green" || p.status === "red" ? p.status : null,
  };
}

function playOf(source: string, kind: RobotKind, day: string, key: string, legs: RobotLeg[]): RobotPlay {
  const odd = legs.reduce((s, l) => s * (l.odd > 1 ? l.odd : 1), 1);
  const prob = legs.reduce((s, l) => s * (l.prob > 0 ? l.prob : 0.01), 1);
  const status: RobotStatus = legs.some((l) => l.status === "red")
    ? "red"
    : legs.every((l) => l.status === "green")
      ? "green"
      : "pending";
  return {
    id: `${source}|${day}|${key}`,
    source,
    kind,
    legs,
    odd: Number(odd.toFixed(2)),
    prob,
    status,
  };
}

const usable = (p: PickRow) =>
  !!p && Number.isFinite(Number(p.odd)) && Number.isFinite(Number(p.prob)) && num(p.odd) > 1.1 && num(p.prob) > 0.05;

const TRIAGEM_HINTS = ["gols", "escanteio", "cartõ", "carto", "ambas"];
const isTriagem = (m: string) => TRIAGEM_HINTS.some((h) => m.toLowerCase().includes(h));

/** Melhor palpite de cada jogo dentro de um filtro de mercado. */
function bestPerFixture(rows: TicketRow[], filter: (p: PickRow) => boolean, limit: number) {
  const out: { row: TicketRow; pick: PickRow }[] = [];
  for (const r of rows) {
    const picks = (r.picks ?? []).filter((p) => usable(p) && p.elite !== false && filter(p));
    if (!picks.length) continue;
    picks.sort((a, b) => indication(b) - indication(a));
    out.push({ row: r, pick: picks[0]! });
  }
  out.sort((a, b) => indication(b.pick) - indication(a.pick));
  return out.slice(0, limit);
}

/** Múltipla com N jogos distintos, priorizando indicação do motor. */
function buildMultiple(
  rows: TicketRow[],
  filter: (p: PickRow) => boolean,
  games: number,
): RobotLeg[] {
  const best = bestPerFixture(rows, filter, games * 4);
  const legs: RobotLeg[] = [];
  const used = new Set<number>();
  for (const { row, pick } of best) {
    if (used.has(Number(row.fixture_id))) continue;
    used.add(Number(row.fixture_id));
    legs.push(legOf(row, pick));
    if (legs.length >= games) break;
  }
  return legs.length === games ? legs : [];
}

export async function getRobotPlays(): Promise<RobotPlaysSnapshot> {
  const day = spToday();
  const db = await admin();

  const from = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from("auto_tickets")
    .select("fixture_id, kickoff, league, home, away, status, picks")
    .neq("status", "skipped")
    .gte("kickoff", from)
    .lte("kickoff", until)
    .order("kickoff", { ascending: true })
    .limit(600);

  const rows = ((data ?? []) as unknown as TicketRow[]).filter((r) => Array.isArray(r.picks) && r.picks.length);
  const plays: RobotPlay[] = [];

  // ---- Bilhetes Auto: simples com os melhores palpites do dia
  for (const { row, pick } of bestPerFixture(rows, (p) => p.odd >= 1.4, 8)) {
    plays.push(playOf("Bilhetes Auto", "simples", day, `${row.fixture_id}:${pick.market}:${pick.selection}`, [
      legOf(row, pick),
    ]));
  }

  // ---- Triagem: simples de gols / escanteios / cartões / ambas marcam
  for (const { row, pick } of bestPerFixture(rows, (p) => isTriagem(p.market), 6)) {
    plays.push(playOf("Triagem", "simples", day, `${row.fixture_id}:${pick.market}:${pick.selection}`, [
      legOf(row, pick),
    ]));
  }

  // ---- Dupla e tripla montadas pelo robô com os palpites mais indicados
  const dupla = buildMultiple(rows, (p) => p.odd >= 1.4, 2);
  if (dupla.length) plays.push(playOf("Robô · Dupla", "multipla", day, "dupla", dupla));
  const tripla = buildMultiple(rows, (p) => p.odd >= 1.5, 3);
  if (tripla.length) plays.push(playOf("Robô · Tripla", "multipla", day, "tripla", tripla));

  // ---- Múltiplas Populares (3 bilhetes do dia já montados)
  try {
    const { getPopularMultiples } = await import("./multiplas.server");
    const snap = await getPopularMultiples(false);
    for (const t of snap.tickets) {
      const legs: RobotLeg[] = t.legs.map((l) => ({
        fixtureId: l.fixtureId,
        home: l.home,
        away: l.away,
        league: l.league,
        kickoff: l.kickoff,
        market: l.market,
        selection: l.selection,
        odd: Number(num(l.odd).toFixed(2)),
        prob: num(l.prob),
        status: l.status === "green" || l.status === "red" ? l.status : null,
      }));
      if (legs.length) {
        plays.push(playOf("Múltiplas Populares", "multipla", day, t.level, legs));
      }
    }
  } catch (e) {
    console.warn("[robo] múltiplas indisponíveis:", (e as Error).message);
  }

  // ---- Fechamento Betano 3/4: uma múltipla com a opção principal de cada jogo
  try {
    const { getFechamentoBetanoSnapshot } = await import("./fechamento-betano.server");
    const snap = await getFechamentoBetanoSnapshot(false);
    const byFixture = new Map(rows.map((r) => [Number(r.fixture_id), r]));
    const legs: RobotLeg[] = [];
    for (const g of snap.games) {
      const opt = g.options[0];
      if (!opt) continue;
      const row = byFixture.get(Number(g.fixtureId));
      const graded = (row?.picks ?? []).find((p) => p.selection === opt.selection);
      legs.push({
        fixtureId: Number(g.fixtureId),
        home: g.home,
        away: g.away,
        league: g.league,
        kickoff: g.kickoff,
        market: g.profileLabel,
        selection: opt.selection,
        odd: Number(num(opt.odd).toFixed(2)),
        prob: num(opt.prob),
        status: graded?.status === "green" || graded?.status === "red" ? graded.status : null,
      });
    }
    if (legs.length >= 2) {
      plays.push(playOf("Fechamento Betano 3/4", "multipla", day, "fechamento", legs));
    }
  } catch (e) {
    console.warn("[robo] fechamento indisponível:", (e as Error).message);
  }

  return { day, builtAt: new Date().toISOString(), plays };
}
