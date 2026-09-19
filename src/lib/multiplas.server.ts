/**
 * Múltiplas Populares — 3 bilhetes múltiplos montados 1x por dia a partir dos
 * palpites já salvos em `auto_tickets` (zero chamadas extras à API-Football).
 *
 * Níveis (odd total alvo):
 *   baixa  ~5x   · média ~50x · alta ~600x
 * Regras: no máximo 4 jogos por bilhete, jogos distintos e seleção automática
 * do mercado (ou combinação do próprio jogo) com melhor indicação estatística.
 */

export type MultipleLevel = "baixa" | "media" | "alta";

export interface LegPart {
  market: string;
  selection: string;
  prob: number;
  odd: number;
  score?: number;
  status?: "green" | "red" | "void" | null;
}

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
  /** combinação de mercados do MESMO jogo usada para alcançar a odd alvo */
  parts?: LegPart[];
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

/**
 * Cada jogo entra com odd combinada mínima de 5 (mercados do mesmo jogo somados).
 * baixa = 1 jogo (>=5) · média = 2 jogos (>=50 com 2-3 jogos) · alta = 4 jogos (>=600).
 */
const MIN_LEG_ODD = 5;
const MAX_LEG_ODD = 26;

const LEVELS: {
  level: MultipleLevel;
  label: string;
  target: number;
  games: number;
  minProb: number;
}[] = [
  { level: "baixa", label: "Segura", target: 5, games: 1, minProb: 0.1 },
  { level: "media", label: "Equilibrada", target: 50, games: 2, minProb: 0.05 },
  { level: "alta", label: "Ousada", target: 600, games: 4, minProb: 0.008 },
];

/** Mercados usados para chegar à odd alta sem incluir opções aleatórias. */
const HIGH_ODD_HINTS = [
  "evolução do jogo",
  "placar exato seco",
  "placar múltiplo exato",
  "margem de vitória",
  "aposta montada",
];

function isHighOdd(market: string) {
  const m = market.toLowerCase();
  return HIGH_ODD_HINTS.some((h) => m.includes(h));
}


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
  picks: { market: string; selection: string; prob: number; odd: number; score?: number; elite?: boolean }[] | null;
}

function indication(p: NonNullable<TicketRow["picks"]>[number]): number {
  const score = Number(p.score);
  return Number.isFinite(score) ? score / 100 : p.prob;
}

/**
 * Para cada jogo escolhe primeiro um mercado indicado que sozinho já alcance
 * odd 5. Só combina 2 ou 3 mercados quando isso for realmente necessário.
 */
function fixtureLegs(r: TicketRow): MultipleLeg[] {
  const picks = (r.picks ?? [])
    .filter(
      (p) =>
        Number.isFinite(p?.prob) &&
        Number.isFinite(p?.odd) &&
        p.odd > 1.08 &&
        p.prob > 0.08 &&
        p.elite !== false &&
        isHighOdd(p.market),
    )
    .sort((a, b) => indication(b) - indication(a) || b.prob - a.prob)
    .slice(0, 8);
  if (!picks.length) return [];

  const base = {
    fixtureId: Number(r.fixture_id),
    home: r.home,
    away: r.away,
    homeLogo: r.home_logo,
    awayLogo: r.away_logo,
    league: r.league,
    kickoff: r.kickoff,
  };

  const combos: MultipleLeg[] = [];
  const push = (parts: LegPart[]) => {
    const odd = parts.reduce((s, p) => s * p.odd, 1);
    const prob = parts.reduce((s, p) => s * p.prob, 1);
    if (odd < MIN_LEG_ODD || odd > MAX_LEG_ODD) return;
    combos.push({
      ...base,
      market: parts.map((p) => p.market).join(" + "),
      selection: parts.map((p) => p.selection).join(" + "),
      prob,
      odd: Number(odd.toFixed(2)),
      parts,
    });
  };

  const norm = (p: (typeof picks)[number]): LegPart => ({
    market: p.market,
    selection: p.selection,
    prob: p.prob,
    odd: p.odd,
    score: Number.isFinite(Number(p.score)) ? Number(p.score) : undefined,
  });

  for (let i = 0; i < picks.length; i++) {
    const a = norm(picks[i]!);
    push([a]);
    for (let j = i + 1; j < picks.length; j++) {
      const b = norm(picks[j]!);
      if (b.market === a.market) continue;
      push([a, b]);
      for (let k = j + 1; k < picks.length; k++) {
        const c = norm(picks[k]!);
        if (c.market === a.market || c.market === b.market) continue;
        push([a, b, c]);
      }
    }
  }

  // A indicação do motor vem antes da odd: um mercado único bem indicado ganha
  // de uma mistura desnecessária. Depois, prioriza chance e menos seleções.
  const comboIndication = (leg: MultipleLeg) => {
    const parts = leg.parts ?? [];
    if (!parts.length) return 0;
    return Math.min(...parts.map((p) => p.score != null ? p.score / 100 : p.prob));
  };
  combos.sort(
    (x, y) =>
      comboIndication(y) - comboIndication(x) ||
      (x.parts?.length ?? 1) - (y.parts?.length ?? 1) ||
      y.prob - x.prob ||
      x.odd - y.odd,
  );
  // guarda a melhor opção de cada faixa de odd (5-7, 7-10, 10-14)
  const bands: [number, number][] = [
    [MIN_LEG_ODD, 7],
    [7, 12],
    [12, MAX_LEG_ODD],
  ];
  const out: MultipleLeg[] = [];
  for (const [lo, hi] of bands) {
    const pick = combos.find((c) => c.odd >= lo && c.odd < hi);
    if (pick) out.push(pick);
  }
  return out;
}

/** Opções por jogo (uma por faixa de odd), ordenadas pela chance de acerto. */
function candidateLegs(rows: TicketRow[]): MultipleLeg[] {
  const out: MultipleLeg[] = [];
  for (const r of rows) out.push(...fixtureLegs(r));
  return out.sort((a, b) => b.prob - a.prob);
}


/** Escolhe N jogos distintos garantindo odd total >= alvo com a maior probabilidade. */
function bestCombo(pool: MultipleLeg[], target: number, games: number, minProb: number): MultipleLeg[] | null {
  const ok = pool.filter((l) => l.prob >= minProb);
  // mistura os mais prováveis com os de odd mais alta, para alcançar o alvo do nível
  const byOdd = [...ok].sort((a, b) => b.odd - a.odd).slice(0, 60);
  const cands = [...new Set([...ok.slice(0, 120), ...byOdd])];
  if (cands.length < games) return null;


  /** alvo proporcional à quantidade de pernas já escolhidas */
  const cost = (legs: MultipleLeg[]) => {
    const odd = legs.reduce((s, l) => s * l.odd, 1);
    const prob = legs.reduce((s, l) => s * l.prob, 1);
    const partial = Math.pow(target, legs.length / games);
    const d = Math.log(odd) - Math.log(partial);
    // ficar abaixo do alvo pesa mais que passar dele
    const dist = d < 0 ? -d * 6 : d * 4;
    return dist - prob * 3;
  };

  let beam: MultipleLeg[][] = [...cands].sort((a, b) => cost([a]) - cost([b])).slice(0, 60).map((l) => [l]);
  for (let depth = 1; depth < games; depth++) {
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


  const full = beam.filter((l) => l.length === games);
  if (!full.length) return null;
  full.sort((a, b) => cost(a) - cost(b));
  return full[0] ?? null;
}

function buildTickets(rows: TicketRow[]): PopularMultiple[] {
  const pool = candidateLegs(rows);
  const tickets: PopularMultiple[] = [];
  const usedFixtures = new Set<number>();

  for (const lv of LEVELS) {
    const available = pool.filter((l) => !usedFixtures.has(l.fixtureId));
    const legs = bestCombo(
      available.length >= lv.games ? available : pool,
      lv.target,
      lv.games,
      lv.minProb,
    );
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
      legs: [...legs].sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
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
    .select("fixture_id, status, picks, home_logo, away_logo")
    .in("fixture_id", ids);

  const graded = new Map<number, { market: string; selection: string; status?: string }[]>();
  const logos = new Map<number, { home: string | null; away: string | null }>();
  for (const r of data ?? []) {
    const row = r as unknown as {
      fixture_id: number;
      status: string;
      picks: TicketRow["picks"];
      home_logo: string | null;
      away_logo: string | null;
    };
    logos.set(Number(row.fixture_id), { home: row.home_logo, away: row.away_logo });
    if (row.status !== "graded") continue;
    graded.set(
      Number(row.fixture_id),
      (row.picks ?? []) as unknown as { market: string; selection: string; status?: string }[],
    );
  }


  for (const t of snapshot.tickets) {
    for (const leg of t.legs) {
      const lg = logos.get(leg.fixtureId);
      if (lg) {
        if (!leg.homeLogo) leg.homeLogo = lg.home;
        if (!leg.awayLogo) leg.awayLogo = lg.away;
      }
      const picks = graded.get(leg.fixtureId);
      if (!picks) {

        leg.status = null;
        continue;
      }
      const parts = leg.parts?.length
        ? leg.parts
        : [{ market: leg.market, selection: leg.selection, prob: leg.prob, odd: leg.odd } as LegPart];
      const states: (string | null)[] = parts.map((part) => {
        const hit = picks.find((p) => p.market === part.market && p.selection === part.selection);
        part.status = (hit?.status as LegPart["status"]) ?? null;
        return part.status ?? null;
      });
      if (leg.parts?.length) leg.parts = parts;
      leg.status = states.some((s) => s === "red")
        ? "red"
        : states.every((s) => s === "green")
          ? "green"
          : null;

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
