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

function TicketCard({ t, onCheck, checking }: { t: PopularMultiple; onCheck: () => void; checking: boolean }) {
  const ui = LEVEL_UI[t.level] ?? LEVEL_UI["media"]!;
  const { Icon } = ui;
  const items = useBetSlip((s) => s.items);
  const toggleItem = useBetSlip((s) => s.toggleItem);
  const setOpen = useBetSlip((s) => s.setOpen);

  const legParts = (leg: PopularMultiple["legs"][number]) =>
    leg.parts?.length
      ? leg.parts
      : [{ market: leg.market, selection: leg.selection, prob: leg.prob, odd: leg.odd }];

  const addLeg = (leg: PopularMultiple["legs"][number]) => {
    for (const part of legParts(leg)) {
      const id = makeSlipId(leg.fixtureId, part.market, part.selection);
      if (items.some((item) => item.id === id)) continue;
      toggleItem({
        id,
        fixtureId: leg.fixtureId,
        home: leg.home,
        away: leg.away,
        league: leg.league ?? undefined,
        time: leg.kickoff,
        market: part.market,
        selection: part.selection,
        prob: part.prob,
        odd: part.odd,
        type: "ia",
      });
    }
  };

  const legInSlip = (leg: PopularMultiple["legs"][number]) =>
    legParts(leg).every((p) => items.some((i) => i.id === makeSlipId(leg.fixtureId, p.market, p.selection)));

  const addTicket = () => {
    for (const leg of t.legs) addLeg(leg);
    setOpen(true);
  };


  return (
    <article
      className={`group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 p-5 shadow-lg shadow-background/30 transition-all duration-300 hover:border-primary/30 ${ui.cls}`}
    >
      <div className="absolute inset-0 -z-10 bg-card/80 backdrop-blur-xl" />
      <div className="absolute inset-x-0 top-0 -z-10 h-px bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100" />

      {/* Top Bar: nível & status */}
      <div className="relative z-10 flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className={`flex h-6 w-6 items-center justify-center rounded-lg border border-white/5 bg-black/40 shadow-inner ${ui.text}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase leading-none tracking-widest text-white/80">
              {ui.title}
            </span>
            <span className="mt-0.5 text-[8px] font-bold uppercase tracking-tighter text-muted-foreground/50">
              Múltipla popular
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-1 ${
              t.status === "green"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : t.status === "red"
                  ? "border-red-500/40 bg-red-500/15 text-red-300"
                  : "border-white/5 bg-black/60 text-white/40"
            }`}
          >
            <span className="text-[10px] font-black uppercase tracking-widest">
              {t.status === "green" ? "Green" : t.status === "red" ? "Red" : "Em aberto"}
            </span>
          </div>
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            title="Conferir resultado agora"
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
            Conferir
          </button>
        </div>
      </div>


      {/* Odd combinada */}
      <div className="relative z-10 flex items-end justify-between gap-4 rounded-2xl border border-white/5 bg-black/30 px-4 py-3">
        <div>
          <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Odd combinada</div>
          <div className={`text-3xl font-black leading-none tabular ${ui.text}`}>@{t.totalOdd.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">Confiança</div>
          <div className="text-lg font-black leading-none tabular text-white/90">{pct(t.prob)}</div>
        </div>
      </div>

      {/* Pernas do bilhete, no padrão dos cards de jogo */}
      <div className="relative z-10 flex flex-col gap-2">
        {t.legs.map((l, i) => (
          <button
            key={`${l.fixtureId}-${i}`}
            type="button"
            onClick={() => addLeg(l)}
            className="group/leg relative overflow-hidden rounded-2xl border border-white/5 bg-black/25 px-3 py-3 text-left transition-all hover:border-primary/30 hover:bg-black/40"
            aria-label={`Adicionar ${l.selection} ao bilhete`}
          >
            <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden opacity-[0.16]">
              {l.homeLogo ? <img src={l.homeLogo} alt="" className="absolute -left-6 h-28 w-28 object-contain brightness-125" /> : null}
              {l.awayLogo ? <img src={l.awayLogo} alt="" className="absolute -right-6 h-28 w-28 object-contain brightness-125" /> : null}
            </div>

            <div className="relative z-10 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/5 bg-black/40 shadow-xl">
                {l.homeLogo ? <img src={l.homeLogo} alt="" className="h-7 w-7 object-contain drop-shadow-md" loading="lazy" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-black leading-tight tracking-tight text-white">
                  {l.home} <span className="text-muted-foreground">×</span> {l.away}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  <CalendarClock className="h-3 w-3" />
                  <span className="truncate">{l.league ? `${l.league} · ` : ""}{hora(l.kickoff)}</span>
                </div>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/5 bg-black/40 shadow-xl">
                {l.awayLogo ? <img src={l.awayLogo} alt="" className="h-7 w-7 object-contain drop-shadow-md" loading="lazy" /> : null}
              </div>
            </div>

            <div className="relative z-10 mt-3 space-y-1.5">
              {legParts(l).map((p, pi) => (
                <div
                  key={`${p.market}-${pi}`}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">
                      {p.market}
                    </div>
                    <div className="truncate text-[12px] font-black text-foreground">{p.selection}</div>
                  </div>
                  <span className="text-[11px] font-black tabular text-emerald-400">{pct(p.prob)}</span>
                  <span className={`text-[12px] font-black tabular ${ui.text}`}>@{p.odd.toFixed(2)}</span>
                  <span className="shrink-0">
                    {p.status === "green" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : p.status === "red" ? (
                      <XCircle className="h-4 w-4 text-red-400" />
                    ) : items.some((item) => item.id === makeSlipId(l.fixtureId, p.market, p.selection)) ? (
                      <Check className={`h-4 w-4 ${ui.text}`} />
                    ) : (
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/30 px-3 py-1.5">
                <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">
                  Odd do jogo {legInSlip(l) ? "· no bilhete" : ""}
                </span>
                <span className={`text-[12px] font-black tabular ${ui.text}`}>@{l.odd.toFixed(2)}</span>
              </div>
            </div>

          </button>
        ))}
      </div>

      <div className="relative z-10 mt-1 border-t border-white/5 pt-4">
        <button
          type="button"
          onClick={addTicket}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 text-[11px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
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
           O robô escolhe o mercado mais indicado de cada jogo. Só combina Evolução, Placar Exato,
           Placar Múltiplo, Margem de Vitória ou Aposta Montada quando precisar alcançar odd 5.
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
          <TicketCard key={t.level} t={t} onCheck={() => void q.refetch()} checking={q.isFetching} />
        ))}
      </div>
    </section>
  );
}
