/**
 * Auditoria read-only da plataforma — conferência de conflitos e status.
 * Acesso apenas ao Supabase (triagem_records, auto_tickets, ai_predictions).
 * Zero custo de API-Football. Usada pelo Assistente (tool-calling) e pelo
 * painel Triagem (aba Auditoria).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const PAGE = 1000;

async function fetchAll(tbl: "triagem_records", select: string, apply?: (q: any) => any): Promise<any[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as { from: (t: string) => any };
  const out: any[] = [];
  for (let from = 0; from < 20_000; from += PAGE) {
    let q: any = db.from(tbl).select(select).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

async function fetchAllTickets(select: string, apply?: (q: any) => any): Promise<any[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: any[] = [];
  for (let from = 0; from < 20_000; from += PAGE) {
    let q: any = supabaseAdmin.from("auto_tickets").select(select).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

export interface AuditoriaResumo {
  auto_tickets: Record<string, number>;
  triagem: Record<string, number>;
  ai_predictions_48h: number;
  cobertura_24h: {
    fixtures: number;
    mercados_publicados: number;
    bilhetes_pending: number;
    bilhetes_skipped: number;
  };
}

export interface AuditoriaConflito {
  fixture_id: number;
  tipo: "triagem" | "auto_tickets";
  mercado: string;
  lados: string[];
  match_name?: string;
}

export interface AuditoriaCompleta {
  timestamp: string;
  resumo: AuditoriaResumo;
  conflitos: AuditoriaConflito[];
  conflitos_por_tipo: Record<"triagem" | "auto_tickets", number>;
}

const OPOSTOS_TRIAGEM: Array<[string, string]> = [
  ["under_1_5", "over_1_5"],
  ["ambas_sim", "ambas_nao"],
];

/** Grupo 1X2 (inclui empates) — mais de um palpite do grupo no mesmo jogo = conflito. */
const GRUPO_1X2 = ["casa_vence", "empate_com_gol", "empate_sem_gols", "visitante_ganha"];

/**
 * Auditoria completa: status das tabelas + conflitos (triagem e auto_tickets)
 * + cobertura das próximas 24h. Tudo apenas leitura via Supabase.
 */
export async function auditoriaCompleta(): Promise<AuditoriaCompleta> {
  const [triRow, ticketsRow, ai48] = await Promise.all([
    fetchAll("triagem_records", "fixture_id, market_type, status, passed, kickoff, match_name"),
    fetchAllTickets("fixture_id, kickoff, status, picks, home, away"),
    (async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from("ai_predictions")
        .select("*", { count: "exact", head: true })
        .eq("market", "scan_snapshot")
        .gte("created_at", since);
      return count ?? 0;
    })(),
  ]);

  const triagem = triRow ?? [];
  const tickets = ticketsRow ?? [];

  // ── resumo ────────────────────────────────────────────────────────────────
  const resumoAuto: Record<string, number> = {};
  for (const t of tickets) resumoAuto[t.status] = (resumoAuto[t.status] ?? 0) + 1;

  const resumoTriagem: Record<string, number> = {};
  for (const r of triagem) resumoTriagem[r.status] = (resumoTriagem[r.status] ?? 0) + 1;

  // ── conflitos na triagem ──────────────────────────────────────────────────
  const publicado = new Map<
    number,
    { markets: Map<string, string>; match_name: string }
  >();
  for (const r of triagem) {
    if (!(r.passed && (r.status === "pending" || r.status === "green"))) continue;
    let g = publicado.get(Number(r.fixture_id));
    if (!g) {
      g = { markets: new Map(), match_name: r.match_name ?? "" };
      publicado.set(Number(r.fixture_id), g);
    }
    g.markets.set(r.market_type, r.market_type);
  }

  const conflitos: AuditoriaConflito[] = [];
  for (const [fid, g] of publicado) {
    const mkt = g.markets;
    for (const [a, b] of OPOSTOS_TRIAGEM) {
      if (mkt.has(a) && mkt.has(b)) {
        conflitos.push({ fixture_id: fid, tipo: "triagem", mercado: `${a} × ${b}`, lados: [a, b], match_name: g.match_name });
      }
    }
    const doGrupo = GRUPO_1X2.filter((m) => mkt.has(m));
    if (doGrupo.length > 1) {
      conflitos.push({ fixture_id: fid, tipo: "triagem", mercado: `resultado_1x2 (${doGrupo.length} palpites)`, lados: doGrupo, match_name: g.match_name });
    }
  }

  // ── conflitos em auto_tickets (picks jsonb) ──────────────────────────────
  for (const t of tickets) {
    const picks: Array<{ market?: string; selection?: string; rule?: { t?: string; side?: string; yes?: boolean; pick?: string } }> =
      t.picks ?? [];
    if (!Array.isArray(picks) || picks.length < 2) continue;

    const totals: string[] = [];
    const btts: boolean[] = [];
    const resultado: string[] = [];
    for (const p of picks) {
      const rt = p.rule?.t;
      if (rt === "totals" || rt === "ht_totals") {
        if (p.rule?.side) totals.push(p.rule.side);
      } else if (rt === "btts") {
        btts.push(Boolean(p.rule?.yes));
      } else if (rt === "1x2") {
        if (p.rule?.pick) resultado.push(p.rule.pick);
      }
    }

    const unTotals = [...new Set(totals)];
    if (unTotals.length > 1) {
      conflitos.push({ fixture_id: Number(t.fixture_id), tipo: "auto_tickets", mercado: "gols_dinamico", lados: unTotals, match_name: t.home && t.away ? `${t.home} × ${t.away}` : undefined });
    }
    if (new Set(btts).size > 1) {
      conflitos.push({ fixture_id: Number(t.fixture_id), tipo: "auto_tickets", mercado: "ambas_marcam", lados: btts.map((y) => (y ? "sim" : "nao")), match_name: t.home && t.away ? `${t.home} × ${t.away}` : undefined });
    }
    const unResult = [...new Set(resultado)];
    if (unResult.length > 1) {
      conflitos.push({ fixture_id: Number(t.fixture_id), tipo: "auto_tickets", mercado: "resultado_1x2", lados: unResult, match_name: t.home && t.away ? `${t.home} × ${t.away}` : undefined });
    }
  }

  // ── cobertura próximas 24h ────────────────────────────────────────────────
  const now = new Date();
  const end24 = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const coberturaFixtures = new Set<number>();
  const coberturaMercadosPublicados = new Map<number, number>();
  let bilhetesPending = 0;
  let bilhetesSkipped = 0;

  for (const r of triagem) {
    if (!r.kickoff) continue;
    const ko = new Date(r.kickoff);
    if (ko < now || ko > new Date(end24)) continue;
    if (!(r.passed && r.status === "pending")) continue;
    coberturaFixtures.add(Number(r.fixture_id));
    coberturaMercadosPublicados.set(Number(r.fixture_id), (coberturaMercadosPublicados.get(Number(r.fixture_id)) ?? 0) + 1);
  }
  for (const t of tickets) {
    if (!t.kickoff) continue;
    const ko = new Date(t.kickoff);
    if (ko < now || ko > new Date(end24)) continue;
    coberturaFixtures.add(Number(t.fixture_id));
    if (t.status === "pending") bilhetesPending++;
    else if (t.status === "skipped") bilhetesSkipped++;
  }

  const conflitosTriagem = conflitos.filter((c) => c.tipo === "triagem");
  const conflitosTickets = conflitos.filter((c) => c.tipo === "auto_tickets");

  return {
    timestamp: new Date().toISOString(),
    resumo: {
      auto_tickets: resumoAuto,
      triagem: resumoTriagem,
      ai_predictions_48h: ai48,
      cobertura_24h: {
        fixtures: coberturaFixtures.size,
        mercados_publicados: [...coberturaMercadosPublicados.values()].reduce((a, b) => a + b, 0),
        bilhetes_pending: bilhetesPending,
        bilhetes_skipped: bilhetesSkipped,
      },
    },
    conflitos,
    conflitos_por_tipo: { triagem: conflitosTriagem.length, auto_tickets: conflitosTickets.length },
  };
}