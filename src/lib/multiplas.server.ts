/**
 * Múltiplas Populares — 3 bilhetes múltiplos montados 1x por dia a partir dos
 * palpites já salvos em `auto_tickets` (zero chamadas extras à API-Football).
 *
 * Níveis (odd total alvo):
 *   baixa  ~5x   · média ~50x · alta ~600x
 * Regras: no máximo 4 jogos por bilhete, 1 mercado por jogo, jogos distintos,
 * e sempre a combinação com a maior probabilidade conjunta para a faixa de odd.
 */

export type MultipleLevel = "baixa" | "media" | "alta";

export interface MultipleLeg {
  fixtureId: number;
  home: string;
  away: string;
  homeLogo: string | null;
  awayLogo: string | null;
  league: string | null;
  kickoff: string;
  market: string;
  selection: string;
  prob: number;
  odd: number;
  status?: "green" | "red" | "void" | null;
}

export interface PopularMultiple {
  level: MultipleLevel;
  label: string;
  targetOdd: number;
  totalOdd: number;
  prob: number;
  legs: MultipleLeg[];
  status: "pending" | "green" | "red";
}

export interface PopularMultiplesSnapshot {
  day: string;
  builtAt: string;
  tickets: PopularMultiple[];
}

const LEVELS: { level: MultipleLevel; label: string; target: number; minProb: number }[] = [
  { level: "baixa", label: "Segura", target: 5, minProb: 0.55 },
  { level: "media", label: "Equilibrada", target: 50, minProb: 0.4 },
  { level: "alta", label: "Ousada", target: 600, minProb: 0.18 },
];

const CACHE_PREFIX = "popular_multiples:";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Dia corrente no fuso de São Paulo (chave diária do bilhete). */
export function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface TicketRow {
  fixture_id: number;
  kickoff: string;
  league: string | null;
  home: string;
  away: string;
  home_logo: string | null;
  away_logo: string | null;
  picks: { market: string; selection: string; prob: number; odd: number; score?: number }[] | null;
}

/** Melhor palpite de cada jogo (1 mercado por jogo), já filtrado por odd útil. */
function candidateLegs(rows: TicketRow[]): MultipleLeg[] {
  const out: MultipleLeg[] = [];
  for (const r of rows) {
    const picks = (r.picks ?? []).filter(
      (p) => Number.isFinite(p?.prob) && Number.isFinite(p?.odd) && p.odd > 1.05 && p.prob > 0.1,
    );
    for (const p of picks) {
      out.push({
        fixtureId: Number(r.fixture_id),
        home: r.home,
        away: r.away,
        homeLogo: r.home_logo,
        awayLogo: r.away_logo,
        league: r.league,
        kickoff: r.kickoff,
        market: p.market,
        selection: p.selection,
        prob: p.prob,
        odd: p.odd,
      });
    }
  }
  return out;
}

/**
 * Busca em feixe (beam search): combina até 4 pernas de jogos distintos
 * procurando a odd total mais próxima do alvo com a maior probabilidade.
 */
function bestCombo(pool: MultipleLeg[], target: number, minProb: number): MultipleLeg[] | null {
  const cands = pool
    .filter((l) => l.prob >= minProb)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 90);
  if (!cands.length) return null;

  const logTarget = Math.log(target);
  const cost = (legs: MultipleLeg[]) => {
    const odd = legs.reduce((s, l) => s * l.odd, 1);
    const prob = legs.reduce((s, l) => s * l.prob, 1);
    return Math.abs(Math.log(odd) - logTarget) * 2 - prob;
  };

  let beam: MultipleLeg[][] = cands.map((l) => [l]);
  let best: MultipleLeg[] | null = null;
  let bestCost = Infinity;

  for (let depth = 1; depth <= 4; depth++) {
    for (const legs of beam) {
      const c = cost(legs);
      if (c < bestCost) {
        bestCost = c;
        best = legs;
      }
    }
    if (depth === 4) break;
    const next: MultipleLeg[][] = [];
    for (const legs of beam.slice(0, 40)) {
      const used = new Set(legs.map((l) => l.fixtureId));
      for (const l of cands) {
        if (used.has(l.fixtureId)) continue;
        next.push([...legs, l]);
      }
    }
    if (!next.length) break;
    next.sort((a, b) => cost(a) - cost(b));
    beam = next.slice(0, 120);
  }

  return best;
}

function buildTickets(rows: TicketRow[]): PopularMultiple[] {
  const pool = candidateLegs(rows);
  const tickets: PopularMultiple[] = [];
  const usedFixtures = new Set<number>();

  for (const lv of LEVELS) {
    const available = pool.filter((l) => !usedFixtures.has(l.fixtureId));
    const legs = bestCombo(available.length >= 4 ? available : pool, lv.target, lv.minProb);
    if (!legs?.length) continue;
    for (const l of legs) usedFixtures.add(l.fixtureId);
    const totalOdd = legs.reduce((s, l) => s * l.odd, 1);
    const prob = legs.reduce((s, l) => s * l.prob, 1);
    tickets.push({
      level: lv.level,
      label: lv.label,
      targetOdd: lv.target,
      totalOdd: Number(totalOdd.toFixed(2)),
      prob,
      legs: legs.sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
      status: "pending",
    });
  }
  return tickets;
}

/** Aplica o resultado já conferido em `auto_tickets` nas pernas do bilhete. */
async function applyResults(snapshot: PopularMultiplesSnapshot): Promise<PopularMultiplesSnapshot> {
  const ids = [...new Set(snapshot.tickets.flatMap((t) => t.legs.map((l) => l.fixtureId)))];
  if (!ids.length) return snapshot;
  const db = await admin();
  const { data } = await db
    .from("auto_tickets")
    .select("fixture_id, status, picks")
    .in("fixture_id", ids);

  const graded = new Map<number, { market: string; selection: string; status?: string }[]>();
  for (const r of (data ?? []) as unknown as TicketRow[] & { status: string }[]) {
    const row = r as unknown as { fixture_id: number; status: string; picks: TicketRow["picks"] };
    if (row.status !== "graded") continue;
    graded.set(
      Number(row.fixture_id),
      (row.picks ?? []) as unknown as { market: string; selection: string; status?: string }[],
    );
  }

  for (const t of snapshot.tickets) {
    for (const leg of t.legs) {
      const picks = graded.get(leg.fixtureId);
      if (!picks) {
        leg.status = null;
        continue;
      }
      const hit = picks.find((p) => p.market === leg.market && p.selection === leg.selection);
      leg.status = (hit?.status as MultipleLeg["status"]) ?? null;
    }
    const states = t.legs.map((l) => l.status);
    if (states.some((s) => s === "red")) t.status = "red";
    else if (states.every((s) => s === "green")) t.status = "green";
    else t.status = "pending";
  }
  return snapshot;
}

/** Lê o bilhete do dia; monta e grava se ainda não existir. */
export async function getPopularMultiples(force = false): Promise<PopularMultiplesSnapshot> {
  const day = spToday();
  const key = `${CACHE_PREFIX}${day}`;
  const db = await admin();

  if (!force) {
    const { data } = await db.from("api_cache").select("data").eq("key", key).maybeSingle();
    const cached = data?.data as unknown as PopularMultiplesSnapshot | null;
    if (cached?.tickets?.length) return await applyResults(cached);
  }

  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db
    .from("auto_tickets")
    .select("fixture_id, kickoff, league, home, away, home_logo, away_logo, picks")
    .neq("status", "skipped")
    .gte("kickoff", from)
    .lte("kickoff", until)
    .order("kickoff", { ascending: true })
    .limit(600);

  const snapshot: PopularMultiplesSnapshot = {
    day,
    builtAt: new Date().toISOString(),
    tickets: buildTickets((rows ?? []) as unknown as TicketRow[]),
  };

  if (snapshot.tickets.length) {
    await db.from("api_cache").upsert({
      key,
      data: snapshot as unknown as never,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
  }
  return await applyResults(snapshot);
}
