/**
 * Conferência por aba — lê apenas os bilhetes já conferidos em `auto_tickets`
 * (status "graded"). Zero chamadas à API-Football.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type PickLite = { market: string; selection: string; status?: string; odd?: number };

export interface ConferenciaAba {
  dias: number;
  greens: number;
  reds: number;
  voids: number;
  acerto: number;
  mercados: { market: string; greens: number; reds: number; acerto: number }[];
  porDia: { dia: string; greens: number; reds: number }[];
  recentes: {
    fixtureId: number;
    jogo: string;
    placar: string | null;
    market: string;
    selection: string;
    status: "green" | "red" | "void";
    kickoff: string;
  }[];
}

const spDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export async function conferenciaAba(dias: number, markets?: string[]): Promise<ConferenciaAba> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - dias * 86_400_000).toISOString();
  const rows: any[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await (supabaseAdmin as any)
      .from("auto_tickets")
      .select("fixture_id, home, away, kickoff, picks, result_snapshot")
      .eq("status", "graded")
      .gte("kickoff", since)
      .order("kickoff", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const set = markets?.length ? new Set(markets) : null;
  const byMarket = new Map<string, { g: number; r: number }>();
  const byDay = new Map<string, { g: number; r: number }>();
  const recentes: ConferenciaAba["recentes"] = [];
  let greens = 0;
  let reds = 0;
  let voids = 0;

  for (const row of rows) {
    const snap = (row.result_snapshot ?? {}) as { home_score?: number; away_score?: number };
    const placar = snap.home_score != null ? `${snap.home_score}-${snap.away_score}` : null;
    for (const p of (Array.isArray(row.picks) ? row.picks : []) as PickLite[]) {
      if (set && !set.has(p.market)) continue;
      if (p.status !== "green" && p.status !== "red" && p.status !== "void") continue;
      if (p.status === "void") {
        voids++;
        continue;
      }
      const ok = p.status === "green";
      ok ? greens++ : reds++;
      const m = byMarket.get(p.market) ?? { g: 0, r: 0 };
      ok ? m.g++ : m.r++;
      byMarket.set(p.market, m);
      const d = spDay(row.kickoff);
      const dd = byDay.get(d) ?? { g: 0, r: 0 };
      ok ? dd.g++ : dd.r++;
      byDay.set(d, dd);
      if (recentes.length < 20) {
        recentes.push({
          fixtureId: Number(row.fixture_id),
          jogo: `${row.home} x ${row.away}`,
          placar,
          market: p.market,
          selection: p.selection,
          status: p.status,
          kickoff: row.kickoff,
        });
      }
    }
  }

  const acc = (g: number, r: number) => (g + r ? g / (g + r) : 0);
  return {
    dias,
    greens,
    reds,
    voids,
    acerto: acc(greens, reds),
    mercados: [...byMarket.entries()]
      .map(([market, v]) => ({ market, greens: v.g, reds: v.r, acerto: acc(v.g, v.r) }))
      .sort((a, b) => b.greens + b.reds - (a.greens + a.reds)),
    porDia: [...byDay.entries()]
      .map(([dia, v]) => ({ dia, greens: v.g, reds: v.r }))
      .sort((a, b) => (a.dia < b.dia ? 1 : -1))
      .slice(0, 7),
    recentes,
  };
}

/** Resultado de palpites avulsos (conta demo) a partir dos bilhetes conferidos. */
export async function resolverPalpites(
  items: { fixtureId: number; market: string; selection: string }[],
): Promise<Record<string, "green" | "red" | "void">> {
  const ids = [...new Set(items.map((i) => Number(i.fixtureId)).filter(Boolean))].slice(0, 300);
  if (!ids.length) return {};
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("auto_tickets")
    .select("fixture_id, picks")
    .eq("status", "graded")
    .in("fixture_id", ids);
  const out: Record<string, "green" | "red" | "void"> = {};
  for (const row of data ?? []) {
    for (const p of (Array.isArray(row.picks) ? row.picks : []) as PickLite[]) {
      if (p.status === "green" || p.status === "red" || p.status === "void") {
        out[`${row.fixture_id}|${p.market}|${p.selection}`] = p.status;
      }
    }
  }
  return out;
}
