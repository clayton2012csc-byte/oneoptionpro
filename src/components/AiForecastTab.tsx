/**
 * Aba "Previsão de IA" — inspirada no layout do Uniscore.
 * Heatmap de placares, palpites de escanteios/cartões e gráficos de gols.
 */
import { useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMatchPreview, getFixtureStatistics, type ApiFixture } from "@/lib/api-football.functions";
import { computeOwnPrediction, poissonCdf, pctFmt } from "@/lib/own-prediction";
import { buildMasterPrediction } from "@/lib/master-engine";
import { ShimmerSummary } from "@/components/Shimmer";
import { AiCommentary } from "@/components/AiCommentary";
import { saveMatchPrediction } from "@/lib/match-predictions";
import { useBetSlip, makeSlipId, fairOdd, type BetSlipItem } from "@/lib/bet-slip";
import { Check, Plus } from "lucide-react";
import { buildExtraMarkets, type MarketBlock } from "@/lib/extra-markets";

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[2rem] glass border border-white/5 p-5 shadow-2xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 blur-[40px] -mr-12 -mt-12 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">{title}</div>
        {hint && <div className="text-[10px] font-bold text-primary/60 bg-primary/10 px-2 py-0.5 rounded-full">{hint}</div>}
      </div>
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}

/** Uma única aposta destacada por mercado (clicável → entra no bilhete). */
function SinglePick({
  label,
  p,
  status = "none",
  note,
  slip,
}: {
  label: string;
  p: number;
  status?: "none" | "green" | "red";
  note?: string;
  slip?: Omit<BetSlipItem, "id" | "prob"> ;
}) {
  const items = useBetSlip((s) => s.items);
  const toggleItem = useBetSlip((s) => s.toggleItem);
  const id = slip ? makeSlipId(slip.fixtureId, slip.market, slip.selection) : "";
  const selected = !!id && items.some((i) => i.id === id);

  const onClick = () => {
    if (!slip) return;
    toggleItem({ ...slip, id, prob: p, odd: fairOdd(p), type: "ia" });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!slip}
      aria-pressed={selected}
      className={`w-full relative rounded-2xl px-4 py-4 text-center border transition-all duration-300 shadow-lg ${slip ? "cursor-pointer hover:scale-[1.02] active:scale-[0.99]" : ""} ${
        selected
          ? "bg-primary/15 border-primary ring-2 ring-primary/40"
          : status === "green"
            ? "bg-emerald-500/10 border-emerald-500/40 shadow-emerald-900/10"
            : status === "red"
              ? "bg-destructive/10 border-destructive/40 shadow-destructive-900/10"
              : "bg-white/5 border-white/10 shadow-black/20"
      }`}
    >
      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</div>
      <div
        className={`text-2xl font-black tabular drop-shadow-sm ${
          status === "green" ? "text-emerald-400" : status === "red" ? "text-destructive" : "text-primary"
        }`}
      >
        {pctFmt(p)}
      </div>
      {note && <div className="text-[9px] font-bold text-primary/80 uppercase tracking-tighter mt-1">{note}</div>}
      {slip && (
        <div className="mt-2 flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-widest text-primary/80">
          {selected ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {selected ? "No bilhete" : "Adicionar"}
        </div>
      )}
      {status !== "none" && (
        <div
          className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shadow-lg ${
            status === "green" ? "bg-emerald-500 text-white" : "bg-destructive text-white"
          }`}
        >
          {status === "green" ? "✓" : "✕"}
        </div>
      )}
    </button>
  );
}

/** Lista de opções clicáveis de um mercado (padrão Betano). */
function MarketOptions({
  block,
  slipBase,
}: {
  block: MarketBlock;
  slipBase: { fixtureId: number; home: string; away: string; league?: string; time?: string };
}) {
  const items = useBetSlip((s) => s.items);
  const toggleItem = useBetSlip((s) => s.toggleItem);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {block.options.map((o) => {
        const id = makeSlipId(slipBase.fixtureId, block.market, o.selection);
        const selected = items.some((i) => i.id === id);
        return (
          <button
            key={o.selection}
            type="button"
            onClick={() =>
              toggleItem({
                id,
                ...slipBase,
                market: block.market,
                selection: o.selection,
                prob: o.p,
                odd: fairOdd(o.p),
                type: "ia",
              })
            }
            aria-pressed={selected}
            className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${
              selected
                ? "bg-primary/15 border-primary ring-1 ring-primary/40"
                : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            <span className="flex-1 min-w-0 text-[11px] font-bold leading-tight">{o.selection}</span>
            <span className="shrink-0 text-right">
              <span className="block text-[11px] font-black tabular text-primary">{pctFmt(o.p)}</span>
              <span className="block text-[9px] font-black tabular text-muted-foreground">
                @{fairOdd(o.p).toFixed(2)}
              </span>
            </span>
            {selected ? (
              <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
            ) : (
              <Plus className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
            )}
          </button>
        );
      })}
    </div>
  );
}


export function AiForecastTab({ fixture }: { fixture: ApiFixture }) {
  const slipItems = useBetSlip((s) => s.items);
  const toggleSlip = useBetSlip((s) => s.toggleItem);
  const fn = useServerFn(getMatchPreview);
  const q = useQuery({
    queryKey: ["preview", fixture.fixture.id],
    queryFn: () => fn({ data: { homeId: fixture.teams.home.id, awayId: fixture.teams.away.id, last: 5 } }),
    staleTime: 45 * 60_000,
  });

  const pred = useMemo(() => (q.data ? computeOwnPrediction(q.data.home, q.data.away) : null), [q.data]);

  // PIPELINE MASTER — todas as etapas encadeadas (1X2 → placar → gols → HT/FT → BTTS)
  const master = useMemo(() => (pred?.ready ? buildMasterPrediction(pred) : null), [pred]);

  const corners = useMemo(() => {
    if (!q.data) return null;
    const { home, away } = q.data;
    const cH = Math.max(0.5, (home.cornersForAvg + away.cornersAgainstAvg) / 2);
    const cA = Math.max(0.5, (away.cornersForAvg + home.cornersAgainstAvg) / 2);
    const total = cH + cA;
    return {
      home: cH,
      away: cA,
      total,
      over95: 1 - poissonCdf(total, 9),
      estimated: home.cornersEstimated || away.cornersEstimated,
    };
  }, [q.data]);

  const cards = useMemo(() => {
    if (!q.data) return null;
    const total = Math.max(0.5, q.data.home.cardsAvg + q.data.away.cardsAvg);
    return {
      home: q.data.home.cardsAvg,
      away: q.data.away.cardsAvg,
      total,
      over45: 1 - poissonCdf(total, 4),
    };
  }, [q.data]);

  const fnStats = useServerFn(getFixtureStatistics);
  const isFinished = fixture.fixture.status.short === "FT" || fixture.fixture.status.short === "AET" || fixture.fixture.status.short === "PEN";

  const statsQ = useQuery({
    queryKey: ["fixture-stats", fixture.fixture.id],
    queryFn: () => fnStats({ data: { id: fixture.fixture.id } }),
    enabled: isFinished,
    staleTime: 10 * 60_000,
  });

  const results = useMemo(() => {
    if (!isFinished) return null;
    const goalsH = fixture.goals.home ?? 0;
    const goalsA = fixture.goals.away ?? 0;
    const totalGoals = goalsH + goalsA;

    let actualCorners: number | null = null;
    let actualCards: number | null = null;

    if (statsQ.data && statsQ.data.length >= 2) {
      const getVal = (stats: any[], type: string) => {
        const s = stats.find((x) => x.type === type);
        if (!s || s.value == null) return 0;
        return typeof s.value === "string" ? parseInt(s.value) || 0 : s.value;
      };

      const c1 = getVal(statsQ.data[0].statistics, "Corner Kicks");
      const c2 = getVal(statsQ.data[1].statistics, "Corner Kicks");
      actualCorners = c1 + c2;

      const y1 = getVal(statsQ.data[0].statistics, "Yellow Cards");
      const r1 = getVal(statsQ.data[0].statistics, "Red Cards");
      const y2 = getVal(statsQ.data[1].statistics, "Yellow Cards");
      const r2 = getVal(statsQ.data[1].statistics, "Red Cards");
      actualCards = y1 + r1 + y2 + r2;
    }

    return {
      goalsH,
      goalsA,
      totalGoals,
      corners: actualCorners,
      cards: actualCards,
      btts: goalsH > 0 && goalsA > 0,
      winner: goalsH > goalsA ? "home" : goalsH < goalsA ? "away" : "draw",
    };
  }, [isFinished, fixture.goals, statsQ.data]);

  // ---- Persistência Automática para Auditoria ----
  const hasSaved = useRef(false);

  useEffect(() => {
    if (pred && pred.ready && !hasSaved.current) {
      hasSaved.current = true;
      const features = {
        home: fixture.teams.home.name,
        away: fixture.teams.away.name,
        time: fixture.fixture.date,
        lambdaHome: pred.lambdaHome,
        lambdaAway: pred.lambdaAway,
        expectedGoals: pred.expectedGoals,
        pBTTS: pred.pBTTS,
        pOver15: pred.pOver15
      };

      // Pipeline mestre: 1X2 vencedor → placar filtrado → BTTS coerente
      const m = buildMasterPrediction(pred);
      const bttsYesValue = m.btts.pick === "SIM";
      const scoreH = m.exactScore.h;
      const scoreA = m.exactScore.a;
      const scoreP = m.exactScore.p;

      // Salva os mercados principais para o painel de assertividade
      const marketsToSave = [
        { market: "1X2", p: m.trend.winner === "home" ? pred.pHome : m.trend.winner === "away" ? pred.pAway : pred.pDraw, score: 0, meta: { pHome: pred.pHome, pDraw: pred.pDraw, pAway: pred.pAway, label: m.trend.label } },
        { market: "U1.5", p: 1 - pred.pOver15, score: 0, meta: {} },
        { market: "BTTS", p: bttsYesValue ? pred.pBTTS : 1 - pred.pBTTS, score: 0, meta: { pBTTS: pred.pBTTS } },
        { market: "SCORE", p: scoreP, score: 0, meta: { predictedScore: `${scoreH}-${scoreA}` } }
      ];

      marketsToSave.forEach(m => {
        saveMatchPrediction({
          fixtureId: fixture.fixture.id,
          market: m.market,
          probability: m.p,
          score: m.score,
          features: { ...features, ...m.meta, label: m.market }
        }).catch(err => console.error(`Erro ao salvar previsão ${m.market}:`, err));
      });
    }
  }, [pred, fixture.fixture.id, fixture.teams.home.name, fixture.teams.away.name, fixture.fixture.date]);

  // Se estiver carregando, mostra Shimmer imediatamente
  if (q.isLoading) return <ShimmerSummary />;

  // Se não houver dados de previsão, mostra mensagem amigável
  if (!pred || !pred.ready || !master) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Sem histórico suficiente para a previsão.</p>;
  }

  // A partir daqui, pred.ready é true. Constantes alinhadas ao PIPELINE MASTER.
  const goalsOver15 = master.goals.side === "over";
  const goalsP = master.goals.p;
  const goalsLabel = master.goals.line;
  const goalsSelection = master.goals.selection;
  const goalsStatus: "none" | "green" | "red" = results
    ? (goalsOver15 ? (results.totalGoals > 1.5 ? "green" : "red") : (results.totalGoals < 1.5 ? "green" : "red"))
    : "none";

  const bttsYes = master.btts.pick === "SIM";
  const bttsStatus: "none" | "green" | "red" = results ? (results.btts === bttsYes ? "green" : "red") : "none";

  const hasCorners = !!corners;
  const cornersOver = (hasCorners) ? corners.over95 >= 0.5 : false;
  const cornersP = (hasCorners) ? (cornersOver ? corners.over95 : 1 - corners.over95) : 0;
  const cornersStatus: "none" | "green" | "red" =
    (results?.corners != null && hasCorners) ? ((results.corners > 9.5) === cornersOver ? "green" : "red") : "none";

  const hasCards = !!cards;
  const cardsOver = (hasCards) ? cards.over45 >= 0.5 : false;
  const cardsP = (hasCards) ? (cardsOver ? cards.over45 : 1 - cards.over45) : 0;
  const cardsStatus: "none" | "green" | "red" =
    (results?.cards != null && hasCards) ? ((results.cards > 4.5) === cardsOver ? "green" : "red") : "none";

  // Placar exato — filtrado pela tendência 1X2 (pipeline mestre)
  const bestScoreH = master.exactScore.h;
  const bestScoreA = master.exactScore.a;
  const bestScoreP = master.exactScore.p;
  
  const scoreStatus: "none" | "green" | "red" = results
    ? results.goalsH === bestScoreH && results.goalsA === bestScoreA
      ? "green"
      : "red"
    : "none";


  const extraBlocks = buildExtraMarkets(
    pred,
    fixture.teams.home.name,
    fixture.teams.away.name,
    hasCorners ? corners.over95 : undefined,
  );

  const slipBase = {
    fixtureId: fixture.fixture.id,
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    league: fixture.league?.name,
    time: fixture.fixture.date,
  };

  // A partir daqui, pred e ready são garantidos
  return (
    <div className="space-y-4">
      <AiCommentary
        kind="match"
        title="Leitura tática da IA"
        buildContext={() => {
          const commentaryLines = [
            `Jogo: ${fixture.teams.home.name} x ${fixture.teams.away.name}`,
            `Tendência: ${master.trend.label} (casa ${pctFmt(pred.pHome)}, empate ${pctFmt(pred.pDraw)}, fora ${pctFmt(pred.pAway)})`,
            `Placar coerente: ${master.exactScore.label} ${pctFmt(master.exactScore.p)}`,
            `Gols esperados: ${pred.lambdaHome} x ${pred.lambdaAway} (total ${pred.expectedGoals.toFixed(2)})`,
            `Linha de gols: ${master.goals.line} ${pctFmt(master.goals.p)} · BTTS ${master.btts.selection}`,
            `HT/FT principal: ${master.htFt.primary}`,
            `Over 1.5 ${pctFmt(pred.pOver15)}, Over 2.5 ${pctFmt(pred.pOver25)}, Under 2.5 ${pctFmt(pred.pUnder25)}, BTTS ${pctFmt(pred.pBTTS)}`,
            `Placares mais prováveis: ${master.exactScores.map((s) => `${s.label} ${pctFmt(s.p)}`).join(", ")}`,
          ];

          if (corners) {
            commentaryLines.push(
              `Escanteios: média ${corners.total.toFixed(1)} (${corners.home.toFixed(1)} x ${corners.away.toFixed(1)}), Mais 9.5 ${pctFmt(corners.over95)}${corners.estimated ? " (estimado)" : ""}`
            );
          }

          if (cards) {
            commentaryLines.push(`Cartões: média ${cards.total.toFixed(2)}, Mais 4.5 ${pctFmt(cards.over45)}`);
          }

          return commentaryLines.join("\n");
        }}
      />

      {master.problems.length > 0 && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/40 px-3 py-2.5">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">Coerência de previsões · ajustes automáticos</div>
          <ul className="space-y-0.5">
            {master.problems.map((p, i) => (
              <li key={i} className="text-[10px] text-amber-200/80 leading-snug">· {p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Grid Responsiva: 1 coluna no celular, 2 colunas no PC */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card title="Resultado Final (1X2)" hint="Modelo Poisson + Dixon-Coles">
            <div className="grid grid-cols-3 gap-2 py-2">
              {[
                { id: "home", logo: fixture.teams.home.logo, name: fixture.teams.home.name, p: pred.pHome },
                { id: "draw", logo: null, name: "Empate", p: pred.pDraw },
                { id: "away", logo: fixture.teams.away.logo, name: fixture.teams.away.name, p: pred.pAway },
              ].map((o) => {
                const isSelected = (o.id === "home" && pred.pHome > pred.pDraw && pred.pHome > pred.pAway) ||
                                 (o.id === "draw" && pred.pDraw > pred.pHome && pred.pDraw > pred.pAway) ||
                                 (o.id === "away" && pred.pAway > pred.pHome && pred.pAway > pred.pDraw);

                let status: "none" | "green" | "red" = "none";
                if (results && isSelected) {
                  status = results.winner === o.id ? "green" : "red";
                }

                const slipId = makeSlipId(fixture.fixture.id, "Resultado Final", o.name);
                const inSlip = slipItems.some((i) => i.id === slipId);

                return (
                  <button
                    type="button"
                    key={o.name}
                    onClick={() => {
                      toggleSlip({ id: slipId, ...slipBase, market: "Resultado Final", selection: o.name, prob: o.p, odd: fairOdd(o.p), type: "ia" });
                    }}
                    className={`flex flex-col items-center gap-2 relative rounded-2xl p-2 border transition active:scale-95 ${inSlip ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-transparent hover:bg-white/5"}`}
                  >
                    <div className={`w-16 h-16 rounded-full border flex items-center justify-center transition hover:scale-105 ${
                      isSelected
                        ? status === "green"
                          ? "bg-emerald-500/20 border-emerald-500/40"
                          : status === "red"
                            ? "bg-destructive/20 border-destructive/40"
                            : "bg-primary/10 border-primary/40"
                        : "bg-white/5 border-white/10 opacity-50"
                    }`}>
                      {o.logo ? (
                        <img src={o.logo} alt="" className="w-10 h-10 object-contain" />
                      ) : (
                        <span className="text-xl font-black opacity-40">X</span>
                      )}
                    </div>
                    <div className="flex flex-col items-center">
                      <div className={`text-lg font-black tabular leading-none ${isSelected ? (status === "green" ? "text-emerald-400" : status === "red" ? "text-destructive" : "text-primary") : ""}`}>
                        {pctFmt(o.p)}
                      </div>
                      <div className="text-[10px] text-muted-foreground text-center truncate w-full mt-1 uppercase tracking-tight">
                        {o.name}
                      </div>
                    </div>
                    {status !== "none" && (
                      <div className={`absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-lg ${status === "green" ? "bg-emerald-500 text-white" : "bg-destructive text-white"}`}>
                        {status === "green" ? "✓" : "✕"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Mercado Principal (Gols)" hint={`Média Esperada: ${pred.expectedGoals.toFixed(2)}`}>
            <SinglePick
              label={goalsLabel}
              p={goalsP}
              status={goalsStatus}
              note={goalsOver15 ? (master.goals.consistent ? "Tendência de gols — alinhada ao placar" : "Linha ajustada à tendência") : "Foco Under 1.5 para Bingão"}
              slip={{ ...slipBase, market: "Gols", selection: goalsSelection }}
            />
          </Card>

          <Card title="Probabilidade de Ambas Marcam">
            <SinglePick
              label={"Ambas marcam · " + (bttsYes ? "Sim" : "Não")}
              p={master.btts.p}
              status={bttsStatus}
              slip={{ ...slipBase, market: "Ambas Marcam", selection: bttsYes ? "Sim" : "Não" }}
            />
          </Card>

          {hasCorners && (
            <Card title="Palpites de escanteios" hint={corners.estimated ? "estimado" : undefined}>
              <SinglePick
                label={cornersOver ? "Mais 9.5" : "Menos 9.5"}
                p={cornersP}
                status={cornersStatus}
                note={results?.corners != null ? `Total real ${results.corners}` : `Média total ${corners.total.toFixed(1)}`}
                slip={{ ...slipBase, market: "Escanteios", selection: cornersOver ? "Mais de 9.5" : "Menos de 9.5" }}
              />
            </Card>
          )}

        </div>

        <div className="space-y-4">
          <Card title="Placar exato" hint={`λ ${pred.lambdaHome} × ${pred.lambdaAway}`}>
            <SinglePick
              label={`${bestScoreH} - ${bestScoreA}`}
              p={bestScoreP}
              status={scoreStatus}
              note={results ? `Placar real ${results.goalsH} - ${results.goalsA}` : undefined}
              slip={{ ...slipBase, market: "Placar Exato", selection: `${bestScoreH} - ${bestScoreA}` }}
            />
          </Card>

          <Card title="Intervalo / Final" hint="Coerente com a tendência">
            <div className="grid grid-cols-3 gap-2 pt-1">
              {master.htFt.list.slice(0, 9).map((h) => (
                <div
                  key={h.label}
                  className={`rounded-xl border px-2 py-2.5 text-center transition hover:bg-white/10 ${
                    h.label === master.htFt.primary
                      ? "bg-primary/15 border-primary/50 ring-1 ring-primary/40"
                      : "bg-white/5 border-white/10"
                  }`}
                >
                  <div className={`text-[11px] font-black tabular uppercase ${h.label === master.htFt.primary ? "text-primary" : ""}`}>{h.label}</div>
                  <div className="text-[10px] text-primary tabular font-bold mt-0.5">{pctFmt(h.p)}</div>
                </div>
              ))}
            </div>
          </Card>

          {hasCards && (
            <Card title="Palpites de cartões">
              <SinglePick
                label={cardsOver ? "Mais 4.5" : "Menos 4.5"}
                p={cardsP}
                status={cardsStatus}
                note={results?.cards != null ? `Cartões reais ${results.cards}` : `Média total ${cards.total.toFixed(2)}`}
                slip={{ ...slipBase, market: "Cartões", selection: cardsOver ? "Mais de 4.5" : "Menos de 4.5" }}
              />
            </Card>
          )}

        </div>
      </div>

      {extraBlocks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {extraBlocks.map((b) => (
            <Card key={b.market} title={b.market} hint={b.hint}>
              <MarketOptions block={b} slipBase={slipBase} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}