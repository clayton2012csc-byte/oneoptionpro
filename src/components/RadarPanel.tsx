import { useLiveScanner, LiveOpportunity } from "@/lib/live-scanner";
import { X, Zap, Target, ArrowRight, ShieldCheck, Trash2 } from "lucide-react";
import { setActiveSection } from "@/lib/active-section";
import { toggleFixture } from "@/lib/pinned-sections";
import { toast } from "sonner";
import { FixtureLink } from "@/components/FixtureLink";

export function RadarPanel({ onClose, isTab = false }: { onClose?: () => void; isTab?: boolean }) {
  const { foundOpportunities, clearOpportunities, lastScanAt } = useLiveScanner();

  const handleCreateTicket = (opp: LiveOpportunity) => {
    toggleFixture("bingao", opp.fixtureId);
    setActiveSection("bingao");
    if (onClose) onClose();
    toast.success("Jogo enviado para o Bingão IA", {
      description: `${opp.fixture.teams.home.name} x ${opp.fixture.teams.away.name} pronto para fechamento.`
    });
  };

  return (
    <div className={`w-full ${!isTab ? 'sm:w-[400px] max-h-[80vh]' : 'h-full'} bg-neutral-950 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col`}>
      <div className="p-6 bg-gradient-to-br from-primary/20 to-transparent border-b border-white/5 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-black text-white leading-tight uppercase tracking-tight flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary animate-pulse" />
            Radar OneOption
          </h3>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mt-1">
            Sinais em Tempo Real {lastScanAt && `• ${lastScanAt.toLocaleTimeString()}`}
          </p>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {foundOpportunities.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center px-6">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-dashed border-white/10 flex items-center justify-center mb-4">
              <Target className="w-8 h-8 text-white/20" />
            </div>
            <h4 className="text-sm font-bold text-white mb-1 uppercase tracking-tight">Nenhum sinal no momento</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              O radar está monitorando os jogos ao vivo em busca de padrões Under 1.5 rigorosos.
            </p>
          </div>
        ) : (
          foundOpportunities.map((opp) => (
            <div 
              key={opp.fixtureId} 
              className="p-4 rounded-3xl bg-white/5 border border-white/10 hover:border-primary/40 transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <Target className="w-12 h-12 text-primary" />
              </div>

              <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-1">
                    {opp.fixture.league.name}
                  </div>
                  <div className="text-sm font-black text-white leading-tight truncate">
                    {opp.fixture.teams.home.name} x {opp.fixture.teams.away.name}
                  </div>
                </div>
                <div className="text-right ml-3">
                  <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Status</div>
                  <div className="text-xs font-black text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20">
                    {opp.fixture.fixture.status.elapsed}' {opp.fixture.goals.home}-{opp.fixture.goals.away}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-2 rounded-2xl bg-black/40 border border-white/5">
                  <div className="text-[8px] font-bold text-muted-foreground uppercase mb-0.5">Prob. U1.5</div>
                  <div className="text-xs font-black text-white">{Math.round(opp.pUnder15 * 100)}%</div>
                </div>
                <div className="p-2 rounded-2xl bg-black/40 border border-white/5">
                  <div className="text-[8px] font-bold text-muted-foreground uppercase mb-0.5">λ Total</div>
                  <div className="text-xs font-black text-white">{opp.expectedGoals.toFixed(2)}</div>
                </div>
              </div>

              <button 
                onClick={() => handleCreateTicket(opp)}
                className="w-full py-2.5 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                BILHETE  RADAR
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {foundOpportunities.length > 0 && (
        <div className="p-4 bg-black/40 border-t border-white/5">
          <button 
            onClick={clearOpportunities}
            className="w-full py-2 text-[9px] font-black text-muted-foreground uppercase tracking-widest flex items-center justify-center gap-2 hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Limpar Histórico de Sinais
          </button>
        </div>
      )}
    </div>
  );
}
