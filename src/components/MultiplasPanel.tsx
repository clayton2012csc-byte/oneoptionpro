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
  Ticket,
  CalendarClock,
  Plus,
  Check,
} from "lucide-react";
import {
  popularMultiples,
  rebuildPopularMultiples,
  type PopularMultiple,
} from "@/lib/multiplas.functions";
import { makeSlipId, useBetSlip } from "@/lib/bet-slip";

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
  const items = useBetSlip((s) => s.items);
  const toggleItem = useBetSlip((s) => s.toggleItem);
  const setOpen = useBetSlip((s) => s.setOpen);

  const addLeg = (leg: PopularMultiple["legs"][number]) => {
    const id = makeSlipId(leg.fixtureId, leg.market, leg.selection);
    toggleItem({
      id,
      fixtureId: leg.fixtureId,
      home: leg.home,
      away: leg.away,
      league: leg.league ?? undefined,
      time: leg.kickoff,
      market: leg.market,
      selection: leg.selection,
      prob: leg.prob,
      odd: leg.odd,
      type: "ia",
    });
  };

  const addTicket = () => {
    for (const leg of t.legs) {
      const id = makeSlipId(leg.fixtureId, leg.market, leg.selection);
      if (!items.some((item) => item.id === id)) addLeg(leg);
    }
    setOpen(true);
  };

  return (
    <article className={`group relative overflow-hidden rounded-2xl border shadow-xl shadow-background/30 ${ui.cls}`}>
      <div className="absolute inset-0 -z-10 bg-card/80 backdrop-blur-xl" />
      <div className="border-b border-white/5 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-background/50 ${ui.text}`}>
            <Icon className="h-4 w-4" />
          </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div>
              <div className={`text-[9px] font-black uppercase tracking-widest ${ui.text}`}>Múltipla popular</div>
              <h3 className="text-[15px] font-black tracking-tight">{ui.title}</h3>
            </div>
            <span
              className={`ml-auto rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-wide ${
                t.status === "green"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : t.status === "red"
                    ? "border-red-500/40 bg-red-500/15 text-red-300"
                    : "border-white/10 bg-white/5 text-muted-foreground"
              }`}
            >
              {t.status === "green" ? "Green" : t.status === "red" ? "Red" : "Em aberto"}
            </span>
          </div>
        </div>
      </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Odd combinada</div>
            <div className={`text-2xl font-black tabular-nums ${ui.text}`}>@{t.totalOdd.toFixed(2)}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Confiança conjunta</div>
            <div className="text-sm font-black tabular-nums text-foreground">{pct(t.prob)}</div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-white/5">
        {t.legs.map((l, i) => (
          <button
            key={`${l.fixtureId}-${i}`}
            type="button"
            onClick={() => addLeg(l)}
            className="w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
            aria-label={`Adicionar ${l.selection} ao bilhete`}
          >
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-14 shrink-0 items-center justify-center">
                {l.homeLogo ? <img src={l.homeLogo} alt="" className="absolute left-0 h-8 w-8 object-contain drop-shadow-md" loading="lazy" /> : null}
                {l.awayLogo ? <img src={l.awayLogo} alt="" className="absolute right-0 h-8 w-8 object-contain drop-shadow-md" loading="lazy" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-black">
                  {l.home} <span className="text-muted-foreground">×</span> {l.away}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-muted-foreground">
                  <CalendarClock className="h-3 w-3" />
                  <span className="truncate">{l.league ? `${l.league} · ` : ""}{hora(l.kickoff)}</span>
                </div>
              </div>
              <div className="shrink-0">
                {l.status === "green" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : l.status === "red" ? (
                  <XCircle className="h-4 w-4 text-red-400" />
                ) : items.some((item) => item.id === makeSlipId(l.fixtureId, l.market, l.selection)) ? (
                  <Check className={`h-4 w-4 ${ui.text}`} />
                ) : (
                  <Plus className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/5 bg-background/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[8px] font-black uppercase tracking-widest text-muted-foreground">{l.market}</div>
                <div className="truncate text-[11px] font-bold text-foreground">{l.selection}</div>
              </div>
              <span className="text-[10px] font-black tabular-nums text-emerald-400">{pct(l.prob)}</span>
              <span className={`text-[11px] font-black tabular-nums ${ui.text}`}>@{l.odd.toFixed(2)}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-white/5 p-3">
        <button
          type="button"
          onClick={addTicket}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 text-[10px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Ticket className="h-4 w-4" />
          Montar este bilhete
        </button>
      </div>
    </article>
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
    <section className="px-3 pb-10 space-y-4">
      <div className="rounded-2xl border border-primary/20 bg-card/70 p-4 shadow-xl shadow-background/30 backdrop-blur-xl">
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
           Três combinações diárias montadas somente com os mercados analisados na aba Previsões.
           Toque em uma seleção ou monte o bilhete completo.
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

      <div className="grid gap-4 lg:grid-cols-3">
        {tickets.map((t) => (
          <TicketCard key={t.level} t={t} />
        ))}
      </div>
    </section>
  );
}
