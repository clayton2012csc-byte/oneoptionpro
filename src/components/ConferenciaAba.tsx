/** Painel de conferência reutilizável: mostra se a aba está indo bem ou mal. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronDown, ClipboardCheck, RefreshCw, XCircle } from "lucide-react";
import { getConferenciaAba } from "@/lib/conferencia.functions";
import { FixtureLink } from "@/components/FixtureLink";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function ConferenciaAba({ titulo, markets }: { titulo: string; markets?: string[] }) {
  const fetchConf = useServerFn(getConferenciaAba);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["conferencia-aba", titulo, markets ?? []],
    queryFn: () => fetchConf({ data: { dias: 7, markets } }),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  const d = q.data;
  const total = (d?.greens ?? 0) + (d?.reds ?? 0);
  const tone = !total
    ? "text-muted-foreground"
    : d!.acerto >= 0.65
      ? "text-emerald-300"
      : d!.acerto >= 0.5
        ? "text-amber-300"
        : "text-red-300";
  const veredito = !total ? "Sem jogos conferidos ainda" : d!.acerto >= 0.65 ? "Indo bem" : d!.acerto >= 0.5 ? "Na média" : "Indo mal";

  return (
    <div className="mx-3 mb-4 glass rounded-2xl border border-white/10">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        <ClipboardCheck className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-wider">Conferência · {titulo}</div>
          <div className="text-[11px] text-muted-foreground">
            Últimos 7 dias · {d?.greens ?? 0} greens · {d?.reds ?? 0} reds
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-black tabular-nums ${tone}`}>{total ? pct(d!.acerto) : "—"}</div>
          <div className={`text-[9px] font-black uppercase ${tone}`}>{veredito}</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-white/10 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Só leitura dos resultados já conferidos · sem custo de API</span>
            <button onClick={() => q.refetch()} className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground">
              <RefreshCw className={`h-3 w-3 ${q.isFetching ? "animate-spin" : ""}`} /> Reconferir
            </button>
          </div>
          {!!d?.porDia.length && (
            <div className="grid grid-cols-7 gap-1">
              {d.porDia.map((x) => {
                const t = x.greens + x.reds;
                const a = t ? x.greens / t : 0;
                return (
                  <div key={x.dia} className="rounded-lg bg-white/5 p-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">{x.dia.slice(8, 10)}/{x.dia.slice(5, 7)}</div>
                    <div className={`text-[11px] font-black ${a >= 0.65 ? "text-emerald-300" : a >= 0.5 ? "text-amber-300" : "text-red-300"}`}>{pct(a)}</div>
                    <div className="text-[9px] text-muted-foreground">{x.greens}/{t}</div>
                  </div>
                );
              })}
            </div>
          )}
          {!!d?.mercados.length && (
            <div className="space-y-1">
              {d.mercados.map((m) => (
                <div key={m.market} className="flex items-center gap-2 text-[11px]">
                  <span className="flex-1 truncate font-semibold">{m.market}</span>
                  <span className="text-muted-foreground tabular-nums">{m.greens}G · {m.reds}R</span>
                  <span className={`w-14 text-right font-black tabular-nums ${m.acerto >= 0.65 ? "text-emerald-300" : m.acerto >= 0.5 ? "text-amber-300" : "text-red-300"}`}>{pct(m.acerto)}</span>
                </div>
              ))}
            </div>
          )}
          {!!d?.recentes.length && (
            <div className="divide-y divide-white/5 rounded-xl bg-white/[0.02]">
              {d.recentes.map((r, i) => (
                <div key={`${r.fixtureId}-${i}`} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                  {r.status === "green" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      <FixtureLink fixtureId={r.fixtureId}>{r.jogo}</FixtureLink>
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {r.market}: {r.selection}
                      {r.placar ? ` · final ${r.placar}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!total && !q.isLoading && (
            <p className="text-[11px] text-muted-foreground">Os resultados aparecem aqui assim que os jogos terminam e são conferidos.</p>
          )}
        </div>
      )}
    </div>
  );
}
