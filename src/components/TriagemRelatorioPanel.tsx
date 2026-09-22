/**
 * Relatório de Mercados da Triagem — tabela com Mercado | Publicados | Acurácia |
 * Nota média | 90+ | Observação. A Observação é gerada automaticamente a partir
 * dos dados reais (acurácia, nota média e faixa 90+), apontando quando a nota
 * engana, quando a acurácia é alta e se o crivo precisa de revisão.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Table2 } from "lucide-react";
import { getTriagemEvolucao } from "@/lib/triagem.functions";
import { TRIAGEM_LABEL, type TriagemMarket } from "@/lib/triagem-engine";
import type { TriagemEvolucaoMarket } from "@/lib/triagem.server";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** Observação automática por mercado, em pt-BR, com base nos dados reais. */
function buildObservacao(m: TriagemEvolucaoMarket): string {
  const n = m.greens + m.reds;
  const acc = Math.round(m.accuracy * 100);
  const hi = Math.round((m.highAcc ?? 0) * 100);
  const avg = Math.round(m.avgScore ?? 0);

  if (m.volume === 0) return "Sem publicações no período";
  if (n === 0) return `Volume baixo, sem conclusão (${m.volume} publicados, 0 conferidos)`;
  if (n < 10) return `Amostra pequena (${n} conferidos), sem conclusão`;
  if (avg >= 85 && acc < 35)
    return `Nota média ${avg} vs acerto ${acc}% — nota engana`;
  if (acc >= 70) {
    if ((m.highN ?? 0) >= 10)
      return `Acurácia alta (${acc}%) · nota coerente (90+ = ${hi}%)`;
    return `Acurácia alta (${acc}%) — subir volume para validar`;
  }
  if ((m.highN ?? 0) >= 10 && m.highAcc >= m.accuracy + 0.1)
    return `90+ (${hi}%) supera a geral (${acc}%) — nota filtra`;
  if ((m.highN ?? 0) >= 10)
    return `90+ (${hi}%) ≈ geral (${acc}%) — nota não discrimina`;
  if (acc < 50) return `Acurácia baixa (${acc}%) — revisar crivo/teto do mercado`;
  return `Acurácia ${acc}% em ${n} conferidos`;
}

export function TriagemRelatorioPanel() {
  const fetchEvo = useServerFn(getTriagemEvolucao);
  const q = useQuery({
    queryKey: ["triagem", "evolucao", 60],
    queryFn: () => fetchEvo({ data: { days: 60 } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const evo = q.data;
  const markets = evo?.markets ?? [];
  const rows = [...markets].sort((a, b) => {
    const na = a.greens + a.reds;
    const nb = b.greens + b.reds;
    return (nb ? b.accuracy : -1) - (na ? a.accuracy : -1);
  });
  const totalPublished = evo?.totalPublished ?? 0;
  const totalGraded = rows.reduce((acc, m) => acc + m.greens + m.reds, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Table2 className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Relatório de mercados · últimos 60 dias
        </span>
        <span className="ml-auto text-[10px] font-bold tabular-nums text-muted-foreground">
          {totalPublished} publicados · {totalGraded} conferidos
        </span>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando relatório…</p>}
      {q.error && <p className="text-sm text-destructive">Erro: {(q.error as Error).message}</p>}

      {!q.isLoading && evo && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Sem avaliações registradas neste período. Rode{" "}
          <code>supabase/triagem-certificacao.sql</code> no banco e aguarde a varredura.
        </p>
      )}

      {rows.length > 0 && (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-white/10">
                    Mercado
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-white/10 text-right">
                    Publicados
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-white/10 text-right">
                    Acurácia
                  </th>
                  <th className="hidden md:table-cell px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-white/10 text-right">
                    Nota média
                  </th>
                  <th className="hidden md:table-cell px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-white/10 text-right">
                    90+
                  </th>
                  <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-white/10">
                    Observação
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const n = m.greens + m.reds;
                  const highN = m.highN ?? 0;
                  const accTone =
                    n === 0
                      ? "text-muted-foreground"
                      : m.accuracy >= 0.9
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : m.accuracy >= 0.8
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-amber-500/15 text-amber-300 border-amber-500/30";
                  return (
                    <tr
                      key={m.market}
                      className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="text-[11px] font-bold truncate">
                          {TRIAGEM_LABEL[m.market as TriagemMarket] ?? m.market}
                        </div>
                        <div className="text-[9px] text-muted-foreground tabular-nums">
                          crivo ≥ {m.minScore}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] font-bold tabular-nums text-right">
                        {m.volume}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {n === 0 ? (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-black tabular-nums ${accTone}`}
                          >
                            {pct(m.accuracy)}
                          </span>
                        )}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-[11px] font-bold tabular-nums text-right">
                        {m.volume ? String(Math.round(m.avgScore ?? 0)) : "—"}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-[11px] font-bold tabular-nums text-right">
                        {highN >= 5 ? `${Math.round((m.highAcc ?? 0) * 100)}% · n${highN}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-muted-foreground min-w-[220px]">
                        {buildObservacao(m)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Acurácia = verdes ÷ conferidos (verde + vermelho). "90+" mostra a acurácia apenas dos
        registros com nota ≥ 90 quando há amostra suficiente. Mercados com nota mínima 95 no
        crivo exigem um padrão mais alto para serem publicados.
      </p>
    </div>
  );
}