import { useEffect, useState } from "react";
import { Ticket, X, Trash2, Layers, FileDown, Share2, Sparkles, FlaskConical } from "lucide-react";
import { useBetSlip, groupSlip, slipOdds, fairOdd } from "@/lib/bet-slip";
import { useDemoAccount, brl } from "@/lib/demo-account";
import { printFechamento, shareFechamento, type ExportTicket } from "@/lib/fechamento-export";
import { toast } from "sonner";

export function BetSlipDrawer() {
  const items = useBetSlip((s) => s.items);
  const open = useBetSlip((s) => s.open);
  const setOpen = useBetSlip((s) => s.setOpen);
  const removeItem = useBetSlip((s) => s.removeItem);
  const clear = useBetSlip((s) => s.clear);
  const demoMode = useDemoAccount((s) => s.mode);
  const demoStake = useDemoAccount((s) => s.stake);
  const placeBets = useDemoAccount((s) => s.placeBets);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const groups = groupSlip(items);
  const { perGroup, total } = slipOdds(groups);
  const created = groups.filter((g) => g.isCreated).length;

  const handlePdf = () => {
    const tickets: ExportTicket[] = groups.map((g, i) => ({
      market: `B${i + 1}`,
      label: g.isCreated ? `Aposta Criada · ${g.home} x ${g.away}` : `Simples · ${g.home} x ${g.away}`,
      picks: g.items.map((it) => ({
        home: it.home,
        away: it.away,
        league: it.league,
        time: it.time,
        pick: `${it.market}: ${it.selection}`,
        p: it.prob,
        odd: it.odd ?? fairOdd(it.prob),
        tag: it.market,
      })),
    }));
    printFechamento({
      name: "Bilhete OneOption",
      date: new Date().toLocaleDateString("pt-BR"),
      tickets,
      justification: `Bilhete montado manualmente com ${items.length} seleções em ${groups.length} partidas (${created} apostas criadas). Odd combinada estimada: ${total.toFixed(2)}.`,
    });
  };

  const handleDemoBet = () => {
    const placed = placeBets(
      items.map((it) => ({
        source: "Bilhete",
        fixtureId: it.fixtureId,
        home: it.home,
        away: it.away,
        league: it.league,
        kickoff: it.time,
        market: it.market,
        selection: it.selection,
        odd: it.odd ?? fairOdd(it.prob),
        prob: it.prob,
      })),
    );
    if (!placed) {
      toast.error("Nada novo para apostar (ou saldo demo insuficiente)");
      return;
    }
    toast.success(`${placed} aposta(s) de ${brl(demoStake)} registradas na conta demo`);
  };

  const handleShare = async () => {
    const tickets: ExportTicket[] = groups.map((g, i) => ({
      market: `B${i + 1}`,
      label: g.isCreated ? "Aposta Criada" : "Simples",
      picks: g.items.map((it) => ({
        home: it.home,
        away: it.away,
        league: it.league,
        time: it.time,
        pick: `${it.market}: ${it.selection}`,
        p: it.prob,
        odd: it.odd ?? fairOdd(it.prob),
      })),
    }));
    const r = await shareFechamento({ name: "Bilhete OneOption", tickets });
    if (r === "copied") toast.success("Bilhete copiado para a área de transferência");
    if (r === "failed") toast.error("Não foi possível compartilhar");
  };

  return (
    <>
      {/* Botão flutuante */}
      {items.length > 0 && !open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-[60] bottom-24 md:bottom-6 right-4 h-14 pl-4 pr-5 rounded-full bg-primary text-primary-foreground shadow-[0_10px_40px_-10px_hsl(var(--primary)/0.8)] flex items-center gap-2 font-black uppercase tracking-widest text-[11px] active:scale-95 transition"
          aria-label="Abrir bilhete"
        >
          <Ticket className="w-5 h-5" />
          Bilhete
          <span className="ml-1 min-w-6 h-6 px-1.5 rounded-full bg-background/25 flex items-center justify-center text-xs font-black tabular">
            {items.length}
          </span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex pointer-events-none">
          <button
            aria-label="Fechar bilhete"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40 pointer-events-auto animate-in fade-in duration-200"
          />
          <div className="pointer-events-auto relative mt-auto sm:mt-0 ml-auto w-full sm:w-[400px] max-h-[72vh] sm:max-h-none sm:h-full bg-background border border-white/10 sm:border-y-0 sm:border-r-0 rounded-t-3xl sm:rounded-none flex flex-col shadow-2xl animate-in slide-in-from-bottom sm:slide-in-from-right duration-300">

            <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-primary" />
                <span className="text-xs font-black uppercase tracking-widest">
                  Bilhete · {items.length} seleções
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {groups.length === 0 && (
                <div className="text-center py-16 space-y-3">
                  <Sparkles className="w-8 h-8 text-primary/50 mx-auto" />
                  <p className="text-sm text-muted-foreground max-w-[240px] mx-auto">
                    Toque nos cards de previsão de um jogo para adicionar mercados ao seu bilhete.
                  </p>
                </div>
              )}

              {groups.map((g, gi) => (
                <div
                  key={g.fixtureId}
                  className={`rounded-3xl border p-3 ${
                    g.isCreated ? "border-primary/30 bg-primary/5" : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-[9px] font-black uppercase tracking-widest text-primary flex items-center gap-1">
                        {g.isCreated ? (
                          <>
                            <Layers className="w-3 h-3" /> Aposta Criada
                          </>
                        ) : (
                          "Seleção simples"
                        )}
                      </div>
                      <div className="text-xs font-black truncate">
                        {g.home} × {g.away}
                      </div>
                      {g.league && (
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider truncate">
                          {g.league}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[8px] text-muted-foreground uppercase font-black">Odd</div>
                      <div className="text-sm font-black text-primary tabular">
                        {perGroup[gi].toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {g.items.map((it) => (
                      <div
                        key={it.id}
                        className="flex items-center gap-2 rounded-2xl bg-black/40 border border-white/5 px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground truncate">
                            {it.market}
                          </div>
                          <div className="text-[11px] font-bold truncate">{it.selection}</div>
                        </div>
                        {typeof it.prob === "number" && (
                          <span className="text-[10px] font-black text-emerald-400 tabular">
                            {Math.round(it.prob * 100)}%
                          </span>
                        )}
                        <span className="text-[10px] font-black text-primary tabular">
                          @{(it.odd ?? fairOdd(it.prob)).toFixed(2)}
                        </span>
                        <button
                          onClick={() => removeItem(it.id)}
                          aria-label="Remover seleção"
                          className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-destructive/20 hover:border-destructive/40 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {groups.length > 0 && (
              <div className="border-t border-white/10 p-3 space-y-3 bg-background/95">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  <span>
                    {groups.length} partida(s) · {created} aposta(s) criada(s)
                  </span>
                  <span className="text-primary text-sm tabular">Odd {total.toFixed(2)}</span>
                </div>
                {demoMode === "demo" && (
                  <button
                    onClick={handleDemoBet}
                    className="w-full h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 hover:bg-emerald-500/25 active:scale-95 transition"
                  >
                    <FlaskConical className="w-3.5 h-3.5" /> Apostar na demo ·{" "}
                    {brl(items.length * demoStake)}
                  </button>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={clear}
                    className="h-11 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1 hover:bg-destructive/15 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Limpar
                  </button>
                  <button
                    onClick={handleShare}
                    className="h-11 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1 hover:bg-white/10 transition"
                  >
                    <Share2 className="w-3.5 h-3.5" /> Enviar
                  </button>
                  <button
                    onClick={handlePdf}
                    className="h-11 rounded-2xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1 active:scale-95 transition"
                  >
                    <FileDown className="w-3.5 h-3.5" /> PDF
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
