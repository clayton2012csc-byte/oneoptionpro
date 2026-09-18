/**
 * Painel da Triagem — 9 mercados isolados, cada um com sua própria
 * assertividade e sua própria lista de jogos triados.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, Clock, Filter } from "lucide-react";
import { getTriagemBoard } from "@/lib/triagem.functions";
import { TRIAGEM_LABEL, type TriagemMarket } from "@/lib/triagem-engine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TriagemCertificacaoPanel } from "@/components/TriagemCertificacaoPanel";
import { TriagemEvolucaoPanel } from "@/components/TriagemEvolucaoPanel";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function ScoreBadge({ score }: { score: number }) {
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

function StatusDot({ status }: { status: string }) {
  if (status === "green") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (status === "red") return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-amber-400/80 shrink-0" />;
}

export function TriagemPanel() {
  const fetchBoard = useServerFn(getTriagemBoard);
  const q = useQuery({
    queryKey: ["triagem", "board"],
    queryFn: () => fetchBoard({}),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const markets = q.data?.markets ?? [];

  return (
    <div className="px-3 pb-10 pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Filter className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-black uppercase tracking-wider">Triagem · filtro de elite</h2>
        <span className="text-[11px] text-muted-foreground">
          só entra quem passa no crivo do mercado (nota ≥ 75)
        </span>
      </div>

      <Tabs defaultValue="publicados" className="mb-4">
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value="publicados">Publicados</TabsTrigger>
          <TabsTrigger value="certificacao">Certificação</TabsTrigger>
          <TabsTrigger value="evolucao">Evolução Diária</TabsTrigger>
        </TabsList>
        <TabsContent value="publicados">
          {q.isLoading && <p className="text-sm text-muted-foreground">Carregando triagem…</p>}
          {q.error && (
            <p className="text-sm text-destructive">Erro: {(q.error as Error).message}</p>
          )}

          {!q.isLoading && markets.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum registro ainda. Rode <code>supabase/triagem.sql</code> no banco e aguarde a
              próxima varredura automática.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {markets.map((m) => {
              const n = m.greens + m.reds;
              return (
                <div
                  key={m.market}
                  className="glass rounded-2xl border border-white/10 overflow-hidden"
                >
                  <div className="px-3 py-2.5 border-b border-white/10">
                    <div className="text-[12px] font-black truncate">
                      {TRIAGEM_LABEL[m.market as TriagemMarket] ?? m.market}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      Assertividade: {n ? pct(m.accuracy) : "—"} | {m.greens} Greens - {m.reds} Reds
                      {m.pending ? ` · ${m.pending} em aberto` : ""}
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                    {m.items.length === 0 && (
                      <div className="px-3 py-3 text-[11px] text-muted-foreground">
                        Nenhum jogo passou neste filtro.
                      </div>
                    )}
                    {m.items.map((it) => (
                      <div key={it.id} className="flex items-center gap-2 px-3 py-2">
                        <StatusDot status={it.status} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold truncate">{it.match_name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {it.predicted_value}
                            {it.result_score ? ` · final ${it.result_score}` : ""}
                            {it.kickoff
                              ? ` · ${new Date(it.kickoff).toLocaleString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : ""}
                          </div>
                        </div>
                        <ScoreBadge score={it.score_confidence} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="certificacao">
          <TriagemCertificacaoPanel />
        </TabsContent>
        <TabsContent value="evolucao">
          <TriagemEvolucaoPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
