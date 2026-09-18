/**
 * Múltiplas Populares — 3 bilhetes do dia (Segura ~5x, Equilibrada ~50x, Ousada ~600x),
 * no máximo 4 jogos por bilhete e 1 mercado por jogo.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Layers,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Scale,
  Flame,
} from "lucide-react";
import {
  popularMultiples,
  rebuildPopularMultiples,
  type PopularMultiple,
} from "@/lib/multiplas.functions";

const LEVEL_UI: Record<
  string,
  { title: string; hint: string; cls: string; text: string; Icon: typeof ShieldCheck }
> = {
  baixa: {
    title: "Nível Baixo",
    hint: "Combinação mais segura, odd total perto de 5x",
    cls: "border-emerald-500/30 bg-emerald-500/5",
    text: "text-emerald-400",
    Icon: ShieldCheck,
  },
  media: {
    title: "Nível Médio",
    hint: "Equilíbrio entre risco e retorno, odd total perto de 50x",
    cls: "border-amber-500/30 bg-amber-500/5",
    text: "text-amber-400",
    Icon: Scale,
  },
  alta: {
    title: "Nível Alto",
    hint: "Bilhete ousado, odd total perto de 600x",
    cls: "border-primary/40 bg-primary/5",
    text: "text-primary",
    Icon: Flame,
  },
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function hora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TicketCard({ t }: { t: PopularMultiple }) {
  const ui = LEVEL_UI[t.level] ?? LEVEL_UI["media"]!;
  const { Icon } = ui;
  return (
    <div className={`rounded-2xl border p-4 ${ui.cls}`}>
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 ${ui.text}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-black tracking-tight">{ui.title}</h3>
            <span className={`text-[11px] font-black ${ui.text}`}>@{t.totalOdd.toFixed(2)}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                t.status === "green"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : t.status === "red"
                    ? "border-red-500/40 bg-red-500/15 text-red-300"
                    : "border-white/10 bg-white/5 text-muted-foreground"
              }`}
            >
              {t.status === "green" ? "Bilhete verde" : t.status === "red" ? "Bilhete vermelho" : "Em aberto"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {ui.hint} · {t.legs.length} jogo(s) · chance conjunta {pct(t.prob)}
          </p>
        </div>
      </div>

      <div className="mt-3 divide-y divide-border/40 rounded-xl border border-border/50 bg-background/40">
        {t.legs.map((l, i) => (
          <div key={`${l.fixtureId}-${i}`} className="flex items-center gap-2 px-3 py-2">
            {l.status === "green" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : l.status === "red" ? (
              <XCircle className="h-4 w-4 shrink-0 text-red-400" />
            ) : (
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold truncate">
                {l.home} <span className="text-muted-foreground">x</span> {l.away}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {l.league ? `${l.league} · ` : ""}
                {hora(l.kickoff)}
              </div>
              <div className="text-[11px] font-semibold text-foreground/90 truncate">
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground mr-1">
                  {l.market}
                </span>
                {l.selection}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[12px] font-black">{pct(l.prob)}</div>
              <div className="text-[10px] text-muted-foreground">@{l.odd.toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MultiplasPanel() {
  const load = useServerFn(popularMultiples);
  const rebuild = useServerFn(rebuildPopularMultiples);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["multiplas-populares"],
    queryFn: () => load(),
    staleTime: 60_000,
  });

  const tickets = q.data?.tickets ?? [];

  const remontar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rebuild();
      await q.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 pb-10 space-y-3">
      <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent p-4">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h2 className="text-[15px] font-black tracking-tight">Múltiplas Populares</h2>
          {(q.isFetching || busy) && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <button
            onClick={() => void remontar()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-primary disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            Remontar
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
          Todo dia a IA monta 3 bilhetes múltiplos com os melhores palpites já analisados: um mais
          seguro (~5x), um equilibrado (~50x) e um ousado (~600x). Cada bilhete tem no máximo 4 jogos
          e 1 mercado por jogo, sempre na combinação com maior chance de acerto.
        </p>
        {q.data?.builtAt && tickets.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Montado em {new Date(q.data.builtAt).toLocaleString("pt-BR")}.
          </p>
        )}
      </div>

      {q.isLoading && <div className="text-[12px] text-muted-foreground px-1">Montando bilhetes…</div>}
      {!q.isLoading && tickets.length === 0 && (
        <div className="text-[12px] text-muted-foreground px-1">
          Ainda não há palpites suficientes para hoje. Assim que a análise dos jogos terminar, os 3
          bilhetes aparecem aqui.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {tickets.map((t) => (
          <TicketCard key={t.level} t={t} />
        ))}
      </div>
    </div>
  );
}
