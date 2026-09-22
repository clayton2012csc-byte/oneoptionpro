/**
 * Módulo 4 — Painel de Bilhetes Automáticos (11 mercados).
 * Carga inicial controlada (lotes espaçados) com barra de progresso 0% → 100%
 * e, depois, atualização incremental apenas dos novos jogos.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, CheckCircle2, XCircle, MinusCircle, Loader2, Radar, BarChart3, AlertTriangle } from "lucide-react";
import {
  listAutoTickets,
  runAutoTickets,
  marketAccuracy,
  gradeAutoTickets,
  type AutoTicketRow,
} from "@/lib/auto-tickets.functions";
import { isRiskyMarket, marketRisk, getHideRisky, setHideRisky, RISK_THRESHOLD } from "@/lib/market-risk";
import { FixtureLink } from "@/components/FixtureLink";

const BATCH_MS = 25_000; // espaçamento entre lotes na carga inicial
const IDLE_MS = 5 * 60_000; // varredura incremental depois de completo

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function StatusIcon({ status }: { status?: string }) {
  if (status === "green") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "red") return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "void") return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-amber-400/80" />;
}

function RiskBadge({ market }: { market: string }) {
  const acc = marketRisk(market);
  if (acc == null || !isRiskyMarket(market)) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide bg-red-500/15 text-red-300 border border-red-500/30">
      <AlertTriangle className="h-3 w-3" />
      Alta variância · {pct(acc)} histórico
    </span>
  );
}

function TicketCard({ row, hideRisky }: { row: AutoTicketRow; hideRisky: boolean }) {
  const [open, setOpen] = useState(false);
  const kickoff = new Date(row.kickoff);
  const graded = row.status === "graded";
  const snap = row.result_snapshot;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-3 text-left"
      >
        <div className="flex -space-x-2 shrink-0">
          {row.home_logo && <img src={row.home_logo} alt={row.home} className="h-7 w-7 rounded-full bg-background/80" loading="lazy" />}
          {row.away_logo && <img src={row.away_logo} alt={row.away} className="h-7 w-7 rounded-full bg-background/80" loading="lazy" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold truncate">{row.home} <span className="text-muted-foreground">x</span> {row.away}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {row.league} · {kickoff.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        {graded ? (
          <div className="text-right shrink-0">
            <div className="text-[12px] font-black text-emerald-400">{row.greens}G · <span className="text-red-400">{row.reds}R</span></div>
            <div className="text-[10px] text-muted-foreground">{row.accuracy != null ? pct(Number(row.accuracy)) : "—"}</div>
          </div>
        ) : (
          <div className="text-right shrink-0 max-w-[130px]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-400 leading-tight">
              Aguardando início do jogo
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {kickoff.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        )}

        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <div className="px-3 pb-2 -mt-2">
        <FixtureLink
          fixtureId={row.fixture_id}
          className="inline-flex rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
        >
          Abrir jogo
        </FixtureLink>
      </div>


      {snap && (
        <div className="px-3 pb-2 -mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-black text-sky-300">
            FT {snap.home_score} - {snap.away_score}
            {snap.ht_home_score != null && snap.ht_away_score != null
              ? ` · HT ${snap.ht_home_score} - ${snap.ht_away_score}`
              : ""}
          </span>
          {snap.total_corners != null ? (
            <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-black text-amber-300">
              Escanteios: {snap.total_corners}
            </span>
          ) : null}
          {snap.total_cards != null ? (
            <span className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-[11px] font-black text-fuchsia-300">
              Cartões: {snap.total_cards}
            </span>
          ) : null}
          {snap.total_corners == null && snap.total_cards == null ? (
            <span className="rounded-lg border border-border/60 bg-muted/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Sem scout oficial
            </span>
          ) : null}
          <span className="text-[10px] text-muted-foreground truncate">{snap.reason}</span>
        </div>
      )}

      {row.meta?.headline && (
        <div className="px-3 pb-2 -mt-1">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5 text-[11px] text-emerald-200/90">
            <span className="font-black uppercase tracking-wide text-emerald-400 mr-1">Leitura:</span>
            {row.meta.headline}
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-border/50 divide-y divide-border/40">
          {!(row.picks ?? []).some((p) => p.market === "Placar Exato Seco") && (
            <div className="px-3 py-2">
              <span className="inline-flex items-start gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-200">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                Placar Exato omitido: probabilidade inferior ao limiar de segurança (14%). Os demais mercados seguem válidos.
              </span>
            </div>
          )}
          {(row.picks ?? []).filter((p) => !(hideRisky && isRiskyMarket(p.market))).map((p, i) => (

            <div key={i} className="flex items-center gap-2 px-3 py-2">
              <StatusIcon status={p.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.market}</span>
                  <RiskBadge market={p.market} />
                  {p.market === "Placar Exato Seco" && (
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      <AlertTriangle className="h-3 w-3" />
                      Alta volatilidade · odd elevada · {pct(p.prob)}
                    </span>
                  )}
                </div>

                <div className="text-[12px] font-semibold truncate">{p.selection}</div>
                {p.market === "Placar Exato Seco" && (
                  <div className="mt-0.5 text-[10px] font-bold text-amber-300/90">
                    Odd mínima recomendada: @6.00
                    {p.odd < 6 ? " · odd atual abaixo do mínimo, evitar" : ""}
                  </div>
                )}
                {p.market === "Placar Exato Seco" && (() => {
                  const alt = (row.picks ?? []).find((x) => x.market === "Placar Múltiplo Exato");
                  return alt ? (
                    <div className="mt-0.5 text-[10px] text-amber-200/80">
                      Cluster de proteção (3 placares): {alt.selection} · {pct(alt.prob)}
                    </div>
                  ) : null;
                })()}


                {p.status && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                        p.status === "green"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : p.status === "red"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      {p.status === "green" ? "Green" : p.status === "red" ? "Red" : "Anulado / sem dados"}
                    </span>
                    {p.evidence && <span className="text-[10px] text-muted-foreground">{p.evidence}</span>}
                  </div>
                )}
                {p.status === "red" && snap && (
                  <div className="mt-0.5 text-[10px] text-red-300/80">
                    Apostou “{p.selection}” · resultado real: {snap.home_score}-{snap.away_score}
                    {snap.ht_home_score != null && snap.ht_away_score != null ? ` (HT ${snap.ht_home_score}-${snap.ht_away_score})` : ""}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12px] font-black">{pct(p.prob)}</div>
                <div className="text-[10px] text-muted-foreground">@{p.odd?.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  otimo: { label: "Indo muito bem", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  bom: { label: "Indo bem", cls: "bg-emerald-500/10 text-emerald-200 border-emerald-500/20" },
  atencao: { label: "Atenção", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  ruim: { label: "Indo mal", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  "sem-dados": { label: "Sem amostra", cls: "bg-white/5 text-muted-foreground border-white/10" },
};

function MarketRanking() {
  const load = useServerFn(marketAccuracy);
  const q = useQuery({ queryKey: ["market-accuracy"], queryFn: () => load(), staleTime: 60_000 });
  const rows = q.data?.rows ?? [];
  const updatedAt = q.data?.updatedAt ?? null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-emerald-400" />
        <h3 className="text-[14px] font-black tracking-tight">Ranking dos Mercados</h3>
        {q.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Os 11 mercados dos bilhetes automáticos, ordenados pelo acerto após a conferência automática.
        {updatedAt ? ` Último registro salvo: ${new Date(updatedAt).toLocaleString("pt-BR")}.` : ""}
      </p>

      {!q.isLoading && rows.length === 0 && (
        <div className="text-[12px] text-muted-foreground mt-3">Ainda não há bilhetes conferidos para ranquear.</div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-semibold py-1">Mercado</th>
                <th className="text-right font-semibold py-1">Apostas</th>
                <th className="text-right font-semibold py-1">G</th>
                <th className="text-right font-semibold py-1">R</th>
                <th className="text-right font-semibold py-1">Acerto</th>
                <th className="text-right font-semibold py-1">14 dias</th>
                <th className="text-right font-semibold py-1">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r) => {
                const v = VERDICT[r.verdict] ?? VERDICT["sem-dados"]!;
                return (
                  <tr key={r.market}>
                    <td className="py-1.5 pr-2 font-semibold truncate max-w-[170px]">
                      {r.market}
                      {r.greens + r.reds >= 20 && r.accuracy < RISK_THRESHOLD ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-red-500/15 px-1 py-0.5 text-[8px] font-black uppercase text-red-300">
                          <AlertTriangle className="h-2.5 w-2.5" /> Risco crítico
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r.total}</td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-400">{r.greens}</td>
                    <td className="py-1.5 text-right tabular-nums text-red-400">{r.reds}</td>
                    <td
                      className={`py-1.5 text-right font-black tabular-nums ${
                        r.accuracy >= 0.6 ? "text-emerald-400" : r.accuracy >= 0.45 ? "text-amber-400" : "text-red-400"
                      }`}
                    >
                      {r.greens + r.reds ? pct(r.accuracy) : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.recentGreens + r.recentReds ? pct(r.recentAccuracy) : "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${v.cls}`}
                      >
                        {v.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AutoTicketsPanel() {
  const list = useServerFn(listAutoTickets);
  const run = useServerFn(runAutoTickets);
  const grade = useServerFn(gradeAutoTickets);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [grading, setGrading] = useState(false);
  const [gradeNote, setGradeNote] = useState<string | null>(null);
  const [hideRisky, setHide] = useState(false);
  const [note, setNote] = useState("Preparando carga das próximas 24h…");
  const busy = useRef(false);

  useEffect(() => setHide(getHideRisky()), []);

  const toggleRisky = () => {
    setHide((v) => {
      setHideRisky(!v);
      return !v;
    });
  };

  const runGrading = async () => {
    if (grading) return;
    setGrading(true);
    try {
      const r = await grade({ data: { limit: 400 } });
      setGradeNote(`${r.graded} bilhete(s) conferidos · ${r.backlog} na fila`);
      if (r.graded > 0) void q.refetch();
    } catch (e) {
      setGradeNote(`Falha na conferência: ${(e as Error).message}`);
    } finally {
      setGrading(false);
    }
  };

  const q = useQuery({
    queryKey: ["auto-tickets"],
    queryFn: () => list(),
    staleTime: 30_000,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled || busy.current) return;
      busy.current = true;
      setRunning(true);
      try {
        const r = await run({ data: { limit: 5 } });
        if (cancelled) return;
        setProgress(Math.max(0, Math.min(100, r.progress ?? 0)));
        const complete = (r.processed ?? 0) === 0 && (r.progress ?? 0) >= 100;
        setNote(
          complete
            ? "Carga completa. Monitorando novos jogos automaticamente."
            : `Carregando previsões… ${r.done ?? 0}/${r.total ?? 0} jogos salvos`,
        );
        if ((r.processed ?? 0) > 0 || (r.graded ?? 0) > 0) void q.refetch();
        timer = setTimeout(tick, complete ? IDLE_MS : BATCH_MS);
      } catch {
        if (!cancelled) timer = setTimeout(tick, IDLE_MS);
      } finally {
        busy.current = false;
        if (!cancelled) setRunning(false);
      }
    };

    timer = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = q.data ?? [];
  const gradedRows = rows.filter((r) => r.status === "graded");
  const totalGreens = gradedRows.reduce((s, r) => s + (r.greens ?? 0), 0);
  const totalReds = gradedRows.reduce((s, r) => s + (r.reds ?? 0), 0);
  const acc = totalGreens + totalReds ? totalGreens / (totalGreens + totalReds) : 0;

  return (
    <div className="px-3 pb-10 space-y-3">
      <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent p-4">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-emerald-400" />
          <h2 className="text-[15px] font-black tracking-tight">Bilhetes Automáticos · 11 Mercados</h2>
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />}
        </div>
        <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
          A IA gera 1 seleção ideal por mercado para cada jogo das próximas 24h, salva tudo no banco e confere Green/Red
          depois do apito final. A carga é feita em lotes espaçados para não estourar a API.
        </p>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
            <span className="text-muted-foreground">{note}</span>
            <span className="text-emerald-400">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-xl bg-background/40 p-2 text-center">
            <div className="text-[16px] font-black">{rows.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Bilhetes</div>
          </div>
          <div className="rounded-xl bg-background/40 p-2 text-center">
            <div className="text-[16px] font-black text-emerald-400">{totalGreens}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Greens</div>
          </div>
          <div className="rounded-xl bg-background/40 p-2 text-center">
            <div className="text-[16px] font-black">{gradedRows.length ? pct(acc) : "—"}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Assertividade</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void runGrading()}
            disabled={grading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-300 disabled:opacity-60"
          >
            {grading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Conferir encerrados
          </button>
          <button
            onClick={toggleRisky}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-black uppercase tracking-wide ${
              hideRisky
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-border/60 bg-background/40 text-muted-foreground"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {hideRisky ? "Mercados < 20% ocultos" : "Ocultar mercados < 20%"}
          </button>
          {gradeNote && <span className="text-[11px] text-muted-foreground">{gradeNote}</span>}
        </div>
      </div>

      <MarketRanking />

      {q.isLoading && <div className="text-[12px] text-muted-foreground px-1">Carregando bilhetes…</div>}
      {!q.isLoading && rows.length === 0 && (
        <div className="text-[12px] text-muted-foreground px-1">
          Nenhum bilhete salvo ainda — a carga inicial está em andamento.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <TicketCard key={r.id} row={r} hideRisky={hideRisky} />
        ))}
      </div>
    </div>
  );
}
