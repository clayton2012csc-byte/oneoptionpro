import { useMarketFilter } from "@/lib/market-filter";
import { useSelectedFixture } from "@/lib/selected-fixture";
import { pctFmt } from "@/lib/own-prediction";
import { BrainCircuit, Sparkles } from "lucide-react";
import { memo, useMemo } from "react";

const EXACT_MARKET = "Placar Exato Seco";

const MARKET_LABEL: Record<string, string> = {
  "Resultado 1X2": "1X2",
  "Intervalo / Final": "HT/FT",
  "Evolução do Jogo": "Evolução",
  "Margem de Vitória": "Margem",
  "Placar Múltiplo Exato": "Placar Múlt.",
  "Aposta Montada": "Combo",
};

const pct = (p: number) => pctFmt(p);

/** Extrai a linha numérica do texto da seleção (ex.: "Mais de 9.5 escanteios" -> "9.5"). */
function line(selection: string): string {
  const m = selection.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : "";
}

const side = (selection: string) => (selection.includes("Menos") ? "MENOS" : "MAIS");

/** Selo legível: sempre diz o lado (MAIS/MENOS), a linha e o que é. */
function shortLabel(market: string, selection: string): string {
  if (market === "Gols Dinâmico") {
    const ht = selection.includes("1º tempo") ? " 1ºT" : "";
    return `${side(selection)} ${line(selection)} GOLS${ht}`;
  }
  if (market === "Ambas Marcam") return selection.includes("Não") ? "AMBAS MARCAM: NÃO" : "AMBAS MARCAM: SIM";
  if (market === "Escanteios") return `${side(selection)} ${line(selection)} ESCANTEIOS`;
  if (market === "Cartões") return `${side(selection)} ${line(selection)} CARTÕES`;
  return MARKET_LABEL[market] ?? market;
}

function AiPickBadgesInner({ fixtureId }: { fixtureId: number }) {
  const { market, predictions, persistedPredictions } = useMarketFilter();
  const isSelected = useSelectedFixture() === fixtureId;

  const view = useMemo(() => {
    if (market !== "none") return null;
    const saved = predictions.find((p) => p.fixtureId === fixtureId);
    const persisted = persistedPredictions.find((p) => p.fixtureId === fixtureId);
    const src = saved?.picks?.length ? saved : persisted;
    const list = src?.picks;
    if (!list || list.length === 0) return null;
    return { picks: list, ctx: src?.pillarContext };
  }, [market, predictions, persistedPredictions, fixtureId]);

  if (!view) return null;
  const { picks, ctx } = view;

  const ctxLine = (() => {
    const parts: string[] = [];
    if (ctx?.referee) parts.push(`Juiz: ${ctx.referee}`);
    if (ctx?.homeL10) parts.push(ctx.homeL10);
    if (ctx?.awayL10) parts.push(ctx.awayL10);
    return parts.join(" · ");
  })();

  return (
    <div className="absolute top-16 right-0 flex flex-col items-end gap-1.5 z-20 pointer-events-none">
      {picks.map((o, idx) => {
        const isExact = o.market === EXACT_MARKET;
        const highlight = isExact || isSelected;
        const showScore = typeof o.score === "number";
        return (
          <div
            key={isExact ? EXACT_MARKET : `${o.market}-${idx}`}
            className={`backdrop-blur-md border-l border-b border-t px-3 py-1 rounded-l-xl flex items-center gap-2 shadow-2xl transition-all duration-300 transform group-hover:translate-x-0 translate-x-1 ${
              highlight
                ? "bg-blue-600 text-white border-blue-600 shadow-[0_0_16px_rgba(234,88,12,0.4)]"
                : "bg-black/60 border-white/10 text-primary"
            }`}
          >
            <div className="flex flex-col items-end leading-none">
              <span className={`text-[7px] font-black uppercase tracking-[0.15em] ${highlight ? "text-white/70" : "text-primary/70"}`}>
                {isExact ? `IA INDICADO • PLACAR EXATO` : shortLabel(o.market, o.selection)}
              </span>
              <span className={`text-[11px] font-black tabular mt-0.5 ${highlight ? "text-white" : "text-white"}`}>
                {isExact ? `${o.selection} · ${pct(o.prob)}` : pct(o.prob)}
                {showScore ? (
                  <span
                    title={`Confiança 5 Pilares · mín. ${o.score}%`}
                    className={`ml-1.5 px-1 rounded text-[8px] font-black align-middle ${
                      o.elite ? "bg-emerald-400 text-black" : "bg-white/20 text-white/80"
                    }`}
                  >
                    ★{o.score}
                  </span>
                ) : null}
              </span>
            </div>
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${highlight ? "bg-white/20" : "bg-primary/20"}`}>
              {isExact ? <Sparkles className="w-3.5 h-3.5" /> : <BrainCircuit className="w-3.5 h-3.5" />}
            </div>
          </div>
        );
      })}
      {ctxLine ? (
        <div className="max-w-[220px] text-right text-[8px] leading-tight text-white/70 bg-black/50 border border-white/10 rounded px-1.5 py-0.5">
          {ctxLine}
        </div>
      ) : null}
    </div>
  );
}

export const AiPickBadges = memo(AiPickBadgesInner, (a, b) => a.fixtureId === b.fixtureId);