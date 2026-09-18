/**
 * Certificação da Triagem — auditoria jogo a jogo.
 * Mostra TODOS os 9 mercados avaliados por jogo: nota, passou/falhou
 * e o motivo (crivo + probabilidade vs teto do mercado).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, ClipboardCheck, RefreshCw } from "lucide-react";
import { getTriagemCertificacao } from "@/lib/triagem.functions";
import { TRIAGEM_LABEL, type TriagemMarket } from "@/lib/triagem-engine";

function fmtKickoff(k: string | null) {
  if (!k) return "—";
  return new Date(k).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EvalBadge({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black text-emerald-300">
      PUBLICADO
    </span>
  ) : (
    <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
      reprovado
    </span>
  );
}

function ScoreBadge({ score, passed }: { score: number; passed: boolean }) {
  if (!passed) {
    return (
      <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
        {score}
      </span>
    );
  }
  const tone =
    score >= 90
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : score >= 80
        ? "bg-primary/15 text-primary border-primary/30"
        : "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-black tabular-nums ${tone}`}>
      {score}
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
  if (status === "green")
    return <span className="text-[10px] font-bold text-emerald-400">● verde</span>;
  if (status === "red")
    return <span className="text-[10px] font-bold text-red-400">● vermelho</span>;
  if (status === "pending")
    return <span className="text-[10px] font-bold text-amber-400/80">○ aberto</span>;
  return null;
}

export function TriagemCertificacaoPanel() {
  const fetchCert = useServerFn(getTriagemCertificacao);
  const q = useQuery({
    queryKey: ["triagem", "certificacao"],
    queryFn: () => fetchCert({ data: {} }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const [open, setOpen] = useState<number | null>(null);

  const fixtures = q.data?.fixtures ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Certificação · todo jogo analisado com seus 9 mercados
        </span>
        <button
          onClick={() => q.refetch()}
          className="ml-auto w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-primary"
          title="Atualizar certificação"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando certificação…</p>}
      {q.error && <p className="text-sm text-destructive">Erro: {(q.error as Error).message}</p>}

      {!q.isLoading && q.data && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1">
            Jogos analisados: <b>{q.data.total}</b>
          </span>
          <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1">
            Taxa de roteamento: <b>{Math.round((q.data.routingRate ?? 0) * 100)}%</b> entraram em ≥
            1 mercado
          </span>
        </div>
      )}

      {!q.isLoading && fixtures.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum jogo analisado ainda. Rode <code>supabase/triagem-certificacao.sql</code> no banco
          e aguarde a próxima varredura automática.
        </p>
      )}

      <div className="space-y-2">
        {fixtures.map((f) => {
          const isOpen = open === f.fixture_id;
          return (
            <div
              key={f.fixture_id}
              className="glass rounded-2xl border border-white/10 overflow-hidden"
            >
              <button
                onClick={() => setOpen(isOpen ? null : f.fixture_id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold truncate">{f.match_name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {f.league ? `${f.league} · ` : ""}
                    {fmtKickoff(f.kickoff)}
                  </div>
                </div>
                <span className="rounded-md border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[10px] font-black text-primary tabular-nums">
                  {f.published}/9
                </span>
              </button>

              {isOpen && (
                <div className="divide-y divide-white/5">
                  {f.evals.map((e) => (
                    <div key={e.market_type} className="flex items-start gap-2 px-3 py-2">
                      <EvalBadge passed={e.passed} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px] font-semibold">
                            {TRIAGEM_LABEL[e.market_type as TriagemMarket] ?? e.market_type}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            → {e.predicted_value}
                          </span>
                          <StatusTag status={e.status} />
                          {e.result_score ? (
                            <span className="text-[10px] text-muted-foreground">
                              · final {e.result_score}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 space-y-0.5 text-[10px] text-muted-foreground">
                          {Array.isArray(e.reason) &&
                            e.reason.map((r, i) => <div key={i}>· {r}</div>)}
                          <div className="text-muted-foreground/70">
                            Prob. {(e.probability * 100).toFixed(1)}% · teto do mercado{" "}
                            {(e.ceiling * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>
                      <ScoreBadge score={e.score_confidence} passed={e.passed} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
